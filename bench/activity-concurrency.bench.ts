// @benchmark deno
/** Fixed eight-request arrival, one physical host, identical two-millisecond async work. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '#tools/bench/run.ts';
import * as context from '@okikio/context';
import * as worker from '@okikio/activity/worker';
import * as process from '@okikio/activity/process';
import * as runtime from '@okikio/runtime/deno/process';
import type { EngineProvider } from '@okikio/workflow';
import { Engine, Work } from '#fixtures/provider-contract.ts';

await using ctx = context.create({ id: 'concurrency-bench' });
await using owners = new AsyncDisposableStack();
/** Includes validation, correlation and cleanup in the timed path; excludes host startup. */
async function batch(provider: EngineProvider): Promise<void> {
	const results = await Promise.all(Array.from({ length: 8 }, () =>
		provider.run(ctx, {
			jobId: crypto.randomUUID(),
			claimId: crypto.randomUUID(),
			attempt: 1,
			activityId: Work.id,
			activityVersion: Work.version,
			engineId: Engine.id,
			registrationId: 'bench',
			hostId: 'bench',
			generation: 1,
			origin: {
				workflowId: 'bench',
				workflowVersion: '1',
				runId: 'bench',
				instructionPath: '0',
				instructionFingerprint: 'bench',
			},
			context: context.snapshot(ctx),
			input: 'delay',
			admitted: true,
		}, { async heartbeat() {} })));
	if (results.some((result) => result.type !== 'success' || result.value !== 'DELAY')) {
		throw new Error('Concurrent provider oracle failed.');
	}
	do_not_optimize(results);
}

for (const concurrency of [1, 4]) {
	const shared = owners.use(
		await worker.create({
			ctx,
			engine: Engine,
			activities: [Work],
			module: new URL('../tests/fixtures/provider-thread.ts', import.meta.url),
			maximum: 1,
			concurrency,
			maximumWaiting: 16,
			shutdownMs: 100,
		}),
	);
	const child = owners.use(
		await process.create({
			ctx,
			engine: Engine,
			activities: [Work],
			adapter: runtime.create(),
			maximum: 1,
			concurrency,
			maximumWaiting: 16,
			maximumFrameBytes: 8192,
			start: {
				command: Deno.execPath(),
				arguments: ['run', '-A', new URL('../tests/fixtures/provider-process.ts', import.meta.url).pathname],
				cwd: new URL('../', import.meta.url),
				stderr: { type: 'capture', maximumBytes: 8192 },
				shutdown: { graceMs: 100, forceMs: 100 },
			},
		}),
	);
	await batch(shared);
	await batch(child);
	group(`eight I/O attempts, one warm host, concurrency ${concurrency}`, () => {
		bench('Worker', () => batch(shared));
		bench('process', () => batch(child));
	});
}
await run();
