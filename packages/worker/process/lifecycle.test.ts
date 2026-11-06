import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as context from '@okikio/context';
import * as process from './mod.ts';
import type { Adapter, StatusType } from './types.ts';

/** Control child exit and signal failure independently without a scheduler or OS timing assumption. */
function child() {
	const exit = Promise.withResolvers<StatusType>();
	const signal = Promise.withResolvers<void>();
	let denied: Error | undefined;
	const adapter: Adapter = {
		trees: ['direct-child'],
		signal: 'SIGTERM',
		forceSignal: 'SIGKILL',
		spawn: async () => ({
			pid: 42,
			status: exit.promise,
			stdout: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(8));
					controller.close();
				},
			}),
			kill() {
				signal.resolve();
				if (denied) throw denied;
			},
			isGone: () => false,
		}),
	};
	return {
		adapter,
		exit,
		signal: signal.promise,
		deny(error: Error) {
			denied = error;
		},
	};
}

describe('process ownership', () => {
	it('shares stop with synchronous observers and joins every disposal until native exit', async () => {
		await using ctx = context.create({ id: 'reentrant-process-stop' });
		const fake = child();
		const handle = await process.start(ctx, fake.adapter, { command: 'fixture' });
		let nested: Promise<void> | undefined;
		let stoppingEvents = 0;
		using _observation = handle.events.subscribe((event) => {
			if (event.type !== 'stopping') return;
			stoppingEvents++;
			if (stoppingEvents === 1) nested = handle.stop('observer');
		});
		const stopping = handle.stop('owner');
		expect(nested).toBe(stopping);
		expect(stoppingEvents).toBe(1);
		const disposal = handle[Symbol.asyncDispose]();
		expect(handle[Symbol.asyncDispose]()).toBe(disposal);
		let finished = false;
		void disposal.then(() => {
			finished = true;
		});
		try {
			await fake.signal;
			expect(finished).toBe(false);
		} finally {
			fake.exit.resolve({ code: 0, success: true });
			await Promise.all([stopping, disposal]);
		}
		expect(ctx.signal.aborted).toBe(false);
	});
	it('reports output failure through wait while disposal still joins child termination', async () => {
		await using ctx = context.create({ id: 'process-output-failure' });
		const fake = child();
		const handle = await process.start(ctx, fake.adapter, {
			command: 'fixture',
			stdout: { type: 'capture', maximumBytes: 1 },
			shutdown: { graceMs: 1_000, forceMs: 1_000 },
		});
		await fake.signal;
		fake.exit.resolve({ code: 0, success: true });
		await expect(handle.wait()).rejects.toBeInstanceOf(process.OutputLimitError);
		await handle[Symbol.asyncDispose]();
		await handle.stop();
	});

	it('accepts a denied direct-child signal only after status confirms natural exit', async () => {
		await using ctx = context.create({ id: 'process-denied-signal' });
		const fake = child();
		const denied = new Error('signal denied');
		fake.deny(denied);
		const handle = await process.start(ctx, fake.adapter, { command: 'fixture' });
		const stopping = handle.stop();
		await fake.signal;
		fake.exit.resolve({ code: 0, success: true });
		await stopping;
		expect((await handle.wait()).success).toBe(true);
		await handle[Symbol.asyncDispose]();
	});

	it('surfaces a denied signal while the process is still unconfirmed', async () => {
		await using ctx = context.create({ id: 'process-unconfirmed' });
		const fake = child();
		const denied = new Error('signal denied');
		fake.deny(denied);
		const handle = await process.start(ctx, fake.adapter, {
			command: 'fixture',
			shutdown: { graceMs: 0, forceMs: 0 },
		});
		await expect(handle.stop()).rejects.toBe(denied);
		fake.exit.resolve({ code: 0, success: true });
		await handle.wait();
		// A failed stop remains a failed stop; disposal must not report success.
		await expect(handle[Symbol.asyncDispose]()).rejects.toBe(denied);
	});
});

describe('denied process-group signals', () => {
	it('does not shorten graceful group shutdown when the wall clock jumps forward', async () => {
		await using ctx = context.create({ id: 'monotonic-process-stop', clock: new context.TestClock() });
		const signals: string[] = [];
		let probes = 0;
		const adapter: Adapter = {
			trees: ['posix-process-group'],
			signal: 'SIGTERM',
			forceSignal: 'SIGKILL',
			spawn: async () => ({
				pid: 42,
				status: Promise.resolve({ code: 0, success: true }),
				kill(signal) {
					signals.push(String(signal));
				},
				isGone: () => false,
				treeAlive: () => ++probes < 3,
			}),
		};
		const handle = await process.start(ctx, adapter, {
			command: 'fixture',
			tree: 'posix-process-group',
			shutdown: { graceMs: 1000, forceMs: 1000 },
		});
		await handle.wait();
		const now = Date.now;
		let wall = now();
		Date.now = () => wall += 10_000;
		try {
			await handle.stop();
			expect(signals).toEqual(['SIGTERM']);
		} finally {
			Date.now = now;
			await handle[Symbol.asyncDispose]();
		}
	});
	it('requires both leader settlement and group absence', async () => {
		for (const groupAlive of [true, false]) {
			await using ctx = context.create({ id: 'denied-group' });
			const denied = new Error('group signal denied');
			const adapter: Adapter = {
				trees: ['posix-process-group'],
				signal: 'SIGTERM',
				forceSignal: 'SIGKILL',
				spawn: async () => ({
					pid: 42,
					status: Promise.resolve({ code: 0, success: true }),
					kill() {
						throw denied;
					},
					isGone: () => false,
					treeAlive: () => groupAlive,
				}),
			};
			const handle = await process.start(ctx, adapter, {
				command: 'fixture',
				tree: 'posix-process-group',
				shutdown: { graceMs: 1, forceMs: 1 },
			});
			await handle.wait();
			if (groupAlive) {
				await expect(handle.stop()).rejects.toBe(denied);
				await expect(handle[Symbol.asyncDispose]()).rejects.toBe(denied);
			} else {
				await handle.stop();
				await handle[Symbol.asyncDispose]();
			}
		}
	});
});
