import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as deno from '@okikio/runtime/deno/worker';
import * as bun from './bun/worker.ts';
import { Protocol } from './node/fixtures/protocol.ts';

/** Each suite uses its real host Worker implementation; plain Node is covered by its own native adapter suite. */
const isDeno = 'Deno' in globalThis;
const isBun = 'Bun' in globalThis;
const open = isDeno ? deno.open : bun.open;
const module = new URL('./fixtures/web-thread.ts', import.meta.url);

describe('native module Worker adapter', { skip: !isDeno && !isBun }, () => {
	it('retains notices, reverse calls and transferred bytes', async () => {
		await using ctx = context.create({ id: 'web-native' });
		const notices: number[] = [];
		await using thread = open(ctx, {
			module,
			protocol: Protocol,
			notice: (value) => {
				notices.push(value);
			},
			call: (value) => value * 2,
		});
		expect(await thread.request(ctx, { mode: 'echo', value: 4 })).toBe(8);
		expect(notices).toEqual([4]);
		const bytes = new Uint8Array([8, 9]).buffer;
		const result = await thread.request(ctx, { mode: 'transfer', value: 0, bytes }, { transfer: [bytes] });
		expect(bytes.byteLength).toBe(0);
		expect([...new Uint8Array(result as ArrayBuffer)]).toEqual([8, 9]);
	});

	it('waits for cooperative remote cleanup before cancellation releases work', async () => {
		await using ctx = context.create({ id: 'web-native-cleanup' });
		await using request = context.child(ctx);
		let announce!: () => void;
		const started = new Promise<void>((resolve) => {
			announce = resolve;
		});
		const flag = new SharedArrayBuffer(4);
		await using thread = open(ctx, { module, protocol: Protocol, notice: announce });
		const result = thread.request(request, { mode: 'wait', value: 1, flag }).catch((error: unknown) => error);
		await started;
		context.cancel(request, 'cancel');
		expect(await result).toBeInstanceOf(context.ContextCancelledError);
		expect(Atomics.load(new Int32Array(flag), 0)).toBe(1);
	});
});
