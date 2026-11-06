import { describe, it } from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { expect } from '@std/expect';
import { SuppressedError } from '@okikio/dispose';
import * as context from '@okikio/context';
import { WorkerStoppedError } from '@okikio/worker/thread';
import { open, scope } from './worker.ts';
import { Protocol } from './fixtures/protocol.ts';

/** This suite requires a real Node worker_threads host, not another host's compatibility implementation. */
const nativeNode = !('Deno' in globalThis) && !('Bun' in globalThis);
const module = new URL('./fixtures/thread.ts', import.meta.url);

describe('native Node thread adapter', { skip: !nativeNode }, () => {
	it('unwinds partial listener acquisition and preserves registration plus removal failures', () => {
		const { port1, port2 } = new MessageChannel();
		const on = port1.on;
		const off = port1.off;
		const setup = new Error('messageerror registration failed');
		const cleanup = new Error('messageerror removal failed');
		const removed: string[] = [];
		port1.on = function (event, listener) {
			on.call(this, event, listener);
			if (event === 'messageerror') throw setup;
			return this;
		};
		port1.off = function (event, listener) {
			removed.push(String(event));
			off.call(this, event, listener);
			if (event === 'messageerror') throw cleanup;
			return this;
		};
		try {
			let failure: unknown;
			try {
				scope(port1);
			} catch (error) {
				failure = error;
			}
			expect(failure).toBeInstanceOf(SuppressedError);
			expect((failure as SuppressedError).error).toBe(cleanup);
			expect((failure as SuppressedError).suppressed).toBe(setup);
			expect(removed).toEqual(['messageerror', 'message']);
			expect(port1.listenerCount('message')).toBe(0);
			expect(port1.listenerCount('messageerror')).toBe(0);
			expect(() => port1.postMessage('still borrowed')).not.toThrow();
		} finally {
			port1.on = on;
			port1.off = off;
			port1.close();
			port2.close();
		}
	});
	it('retains typed notices/reverse calls and transfers ArrayBuffer ownership', async () => {
		await using ctx = context.create({ id: 'native-node' });
		const notices: number[] = [];
		await using thread = open(ctx, {
			module,
			protocol: Protocol,
			thread: { execArgv: [] },
			notice: (value) => {
				notices.push(value);
			},
			call: (value) => value * 2,
		});
		expect(await thread.request(ctx, { mode: 'echo', value: 9 })).toBe(18);
		expect(notices).toEqual([9]);
		const bytes = new Uint8Array([1, 2, 3]).buffer;
		const pending = thread.request(ctx, { mode: 'transfer', value: 0, bytes }, { transfer: [bytes] });
		const result = await pending;
		expect(bytes.byteLength).toBe(0);
		expect(result).toBeInstanceOf(ArrayBuffer);
		expect([...new Uint8Array(result as ArrayBuffer)]).toEqual([1, 2, 3]);
	});

	it('preserves a native transfer error and releases only the borrowed port listeners', () => {
		const { port1, port2 } = new MessageChannel();
		const messageListeners = port1.listenerCount('message');
		const errorListeners = port1.listenerCount('messageerror');
		const original = port1.postMessage;
		let nativeError: unknown;
		port1.postMessage = new Proxy(original, {
			apply(target, receiver, args) {
				try {
					return Reflect.apply(target, receiver, args);
				} catch (error) {
					nativeError = error;
					throw error;
				}
			},
		});
		const bridge = scope(port1);
		try {
			let received: unknown;
			try {
				bridge.postMessage('invalid transfer', [{} as never]);
			} catch (error) {
				received = error;
			}
			expect(nativeError).toBeInstanceOf(Error);
			expect(received).toBe(nativeError);
			bridge[Symbol.dispose]();
			expect(port1.listenerCount('message')).toBe(messageListeners);
			expect(port1.listenerCount('messageerror')).toBe(errorListeners);
			expect(() => bridge.postMessage('closed bridge')).toThrow(ReferenceError);
			// The adapter borrows the port; it remains usable after its listeners close.
			expect(() => original.call(port1, 'still owned by the caller')).not.toThrow();
		} finally {
			bridge[Symbol.dispose]();
			port1.postMessage = original;
			port1.close();
			port2.close();
		}
	});

	it('rejects an unsupported transfer without detaching data or retaining request correlation', async () => {
		await using ctx = context.create({ id: 'native-invalid-transfer' });
		await using thread = open(ctx, { module, protocol: Protocol, thread: { execArgv: [] } });
		const bytes = new Uint8Array([4, 5, 6]).buffer;
		const failure = await thread.request(ctx, { mode: 'transfer', value: 0, bytes }, {
			id: 'retry-transfer',
			transfer: [bytes, {} as never],
		}).then(() => undefined, (error: unknown) => error);
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).name).toBe('DataCloneError');
		expect(bytes.byteLength).toBe(3);
		const response = await thread.request(ctx, { mode: 'transfer', value: 0, bytes }, {
			id: 'retry-transfer',
			transfer: [bytes],
		});
		expect(bytes.byteLength).toBe(0);
		expect([...new Uint8Array(response as ArrayBuffer)]).toEqual([4, 5, 6]);
		let stopped = false;
		using _observations = thread.events.subscribe((event) => {
			if (event.type === 'stopped') stopped = true;
		});
		await thread.stop();
		expect(stopped).toBe(true);
	});

	it('does not release a cancelled request before remote deferred cleanup completes', async () => {
		await using owner = context.create({ id: 'native-cleanup' });
		await using request = context.child(owner);
		const flag = new SharedArrayBuffer(4);
		let announce!: () => void;
		const started = new Promise<void>((resolve) => {
			announce = resolve;
		});
		await using thread = open(owner, { module, protocol: Protocol, thread: { execArgv: [] }, notice: announce });
		const result = thread.request(request, { mode: 'wait', value: 1, flag });
		const failure = result.catch((error: unknown) => error);
		await started;
		context.cancel(request, 'caller stopped');
		expect(await failure).toBeInstanceOf(context.ContextCancelledError);
		expect(Atomics.load(new Int32Array(flag), 0)).toBe(1);
	});

	it('joins native termination when an uncooperative request exceeds its cancellation grace', async () => {
		await using owner = context.create({ id: 'native-retirement' });
		await using request = context.child(owner);
		let announce!: () => void;
		const started = new Promise<void>((resolve) => {
			announce = resolve;
		});
		await using thread = open(owner, {
			module,
			protocol: Protocol,
			thread: { execArgv: [] },
			notice: announce,
			cancelMs: 20,
			shutdownMs: 20,
		});
		const result = thread.request(request, { mode: 'stubborn', value: 1 }).catch((error: unknown) => error);
		await started;
		context.cancel(request, 'stop stubborn work');
		expect(await result).toBeInstanceOf(WorkerStoppedError);
		await expect(thread.request(owner, { mode: 'echo', value: 1 })).rejects.toThrow();
	});

	it('rejects unexpected native exit without leaving a request waiting forever', async () => {
		await using owner = context.create({ id: 'native-crash' });
		await using thread = open(owner, { module, protocol: Protocol, thread: { execArgv: [] }, shutdownMs: 20 });
		await expect(thread.request(owner, { mode: 'crash', value: 0 })).rejects.toThrow();
	});
});
