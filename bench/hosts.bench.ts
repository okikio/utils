/** Measure real host startup, owned cleanup and warm Worker requests. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as context from '@okikio/context';
import * as process from '@okikio/process';
import * as deno from '@okikio/process/deno';
import * as permissions from '@okikio/deno/permissions';
import * as worker from '@okikio/worker';
import { z } from 'zod';
import { run } from './run.ts';

const protocol = worker.protocol({ request: z.string(), response: z.string() });
const module = new URL('./fixtures/thread.ts', import.meta.url);
const decoder = new TextDecoder();
await using owner = context.create({ id: 'benchmark-hosts' });

/** Include construction, validated request and acknowledged disposal in each cold trial. */
async function coldWorker(): Promise<string> {
	await using thread = worker.open(owner, { module, protocol });
	return await thread.request(owner, 'ready');
}
/** Include child startup and output collection, with a bounded utility capture. */
async function child(): Promise<string> {
	const exit = await process.exec(owner, deno.create(), {
		command: Deno.execPath(),
		arguments: ['eval', 'console.log("READY")'],
		stdout: { type: 'capture', maximumBytes: 1024 },
		stderr: { type: 'discard' },
	});
	return decoder.decode(exit.stdout).trim();
}
/** The raw baseline has the same child and output; it has no context cancellation or capture bound. */
async function rawChild(): Promise<string> {
	const output = await new Deno.Command(Deno.execPath(), {
		args: ['eval', 'console.log("READY")'],
		stdout: 'piped',
		stderr: 'null',
	}).output();
	if (!output.success) throw new Error('Raw benchmark child failed.');
	return decoder.decode(output.stdout).trim();
}
const grants = { read: ['/tmp/a,b', '/tmp/c'], run: ['ffmpeg'] } as const;
deepStrictEqual(permissions.args(grants), ['--allow-read=/tmp/a,,b,/tmp/c', '--allow-run=ffmpeg']);
strictEqual(await coldWorker(), 'READY');
strictEqual(await child(), 'READY');
strictEqual(await rawChild(), 'READY');
await using warm = worker.open(owner, { module, protocol });
strictEqual(await warm.request(owner, 'ready'), 'READY');

group('host boundaries: startup and ownership', () => {
	bench('Worker cold startup + validated echo + cleanup', async () => do_not_optimize(await coldWorker())).gc('once');
	bench('Worker warm validated echo', async () => do_not_optimize(await warm.request(owner, 'ready')));
	bench('process owned child + bounded capture + cleanup', async () => do_not_optimize(await child())).gc('once');
	bench('Deno.Command child + unbounded capture baseline', async () => do_not_optimize(await rawChild())).gc('once');
	bench('Deno scoped permission argument encoding', () => do_not_optimize(permissions.args(grants)));
});
await run();
