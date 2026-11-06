/** Actual local, module Worker and child-process calls. Requires the Deno host and owns every provider. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '#tools/bench/run.ts';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as local from '@okikio/activity/local';
import * as worker from '@okikio/activity/worker';
import * as process from '@okikio/activity/process';
import * as runtime from '@okikio/runtime/deno/process';
import type { ActivityAttemptType, EngineProvider } from '@okikio/workflow';
import { Engine, Live, Work } from '#fixtures/provider-contract.ts';
await using ctx = context.create({ id: 'native-provider-bench' });
await using resources = resource.create(resource.implementations(), { ctx, host: {} });
const origin = {
	workflowId: 'bench.provider',
	workflowVersion: '1',
	runId: 'run',
	instructionPath: '0',
	instructionFingerprint: 'fingerprint',
};
const control = { async heartbeat() {} };
const start = {
	command: Deno.execPath(),
	arguments: ['run', '-A', new URL('../tests/fixtures/provider-process.ts', import.meta.url).pathname],
	cwd: new URL('../', import.meta.url),
	stderr: { type: 'capture' as const, maximumBytes: 8192 },
	shutdown: { graceMs: 100, forceMs: 100 },
};
const module = new URL('../tests/fixtures/provider-thread.ts', import.meta.url);
await using thread = await worker.create({
	ctx,
	engine: Engine,
	activities: [Work],
	module,
	maximum: 1,
	shutdownMs: 100,
});
await using child = await process.create({
	ctx,
	engine: Engine,
	activities: [Work],
	adapter: runtime.create(),
	maximum: 1,
	maximumFrameBytes: 3_000_000,
	start,
});
const providers = {
	local: local.create({ engine: Engine, implementations: [Live], resources }),
	thread,
	process: child,
};
/** Every call gets distinct logical and claim identities; all paths validate the same exact contracts. */
async function call(provider: EngineProvider, input: string): Promise<void> {
	const attempt: ActivityAttemptType = {
		jobId: crypto.randomUUID(),
		claimId: crypto.randomUUID(),
		attempt: 1,
		activityId: Work.id,
		activityVersion: Work.version,
		engineId: Engine.id,
		registrationId: 'registration',
		hostId: 'host',
		generation: 1,
		origin,
		context: context.snapshot(ctx),
		input,
		admitted: true,
	};
	const result = await provider.run(ctx, attempt, control);
	if (result.type !== 'success' || result.value !== input.toUpperCase()) {
		throw new Error(`Native activity value oracle failed: ${result.type}, input bytes ${input.length}.`, {
			cause: result.type === 'fault' ? result.fault : undefined,
		});
	}
	do_not_optimize(result);
}
for (const bytes of [1024, 1048576]) {
	for (const count of bytes === 1024 ? [1, 8, 64] : [1, 8]) {
		const input = 'x'.repeat(bytes);
		for (const provider of Object.values(providers)) await call(provider, input);
		group(`warm native provider ${bytes} bytes, ${count} sequential calls`, () => {
			for (const [name, provider] of Object.entries(providers)) {
				bench(name, async () => {
					for (let index = 0; index < count; index++) await call(provider, input);
				});
			}
		});
	}
}
group('cold native provider, 1 KiB request and joined disposal', () => {
	bench('module Worker', async () => {
		await using provider = await worker.create({
			ctx,
			engine: Engine,
			activities: [Work],
			module,
			maximum: 1,
			shutdownMs: 100,
		});
		await call(provider, 'x'.repeat(1024));
	});
	bench('child process', async () => {
		await using provider = await process.create({
			ctx,
			engine: Engine,
			activities: [Work],
			adapter: runtime.create(),
			maximum: 1,
			maximumFrameBytes: 8192,
			start,
		});
		await call(provider, 'x'.repeat(1024));
	});
});
await run();
