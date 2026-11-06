/** Own real thread/process fixtures for cancellation tests and benchmark oracles. @module */
import process from 'node:process';
import * as context from '@okikio/context';
import * as worker from '@okikio/activity/worker';
import * as child from '@okikio/activity/process';
import * as threads from '@okikio/runtime/node/worker';
import * as processes from '@okikio/runtime/node/process';
import { attempt, Engine, Work } from './provider-cleanup.ts';
import type { EngineProvider } from '@okikio/workflow';

/** Start exactly one physical host. The returned provider owns and joins its host at disposal. */
export async function open(ctx: context.Context, kind: 'worker' | 'process') {
	return kind === 'worker'
		? await worker.create({
			ctx,
			engine: Engine,
			activities: [Work],
			maximum: 1,
			module: new URL('./provider-cleanup-thread.ts', import.meta.url),
			create: (module) => threads.create(module),
			shutdownMs: 100,
		})
		: await child.create({
			ctx,
			engine: Engine,
			activities: [Work],
			maximum: 1,
			adapter: processes.create(),
			start: {
				command: process.execPath,
				arguments: [
					...(typeof Deno === 'undefined' ? [] : ['run', '-A']),
					new URL('./provider-cleanup-process.ts', import.meta.url).pathname,
				],
				stderr: { type: 'capture', maximumBytes: 8192 },
				shutdown: { graceMs: 100, forceMs: 100 },
			},
		});
}

/** Cancel only after the actual activity has called the original parent heartbeat authority. */
export async function cancel(owner: context.Context, provider: EngineProvider, mode: string) {
	await using ctx = context.child(owner);
	const ready = Promise.withResolvers<void>();
	const result = provider.run(ctx, attempt(ctx, mode), {
		async heartbeat() {
			ready.resolve();
		},
	});
	await ready.promise;
	context.cancel(ctx, 'caller stopped');
	return await result;
}
