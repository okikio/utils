import { it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as local from '@okikio/activity/local';
import * as worker from '@okikio/activity/worker';
import * as process from '@okikio/activity/process';
import * as runtime from '@okikio/runtime/deno/process';
import * as failure from '@okikio/result/failure';
import type { ActivityAttemptType, EngineProvider } from '@okikio/workflow';
import { Engine, Live, Rejected, Work } from '#fixtures/provider-contract.ts';
/** Keep logical job and fenced attempt identities distinct across the same provider-neutral corpus. */
function attempt(ctx: context.Context, input: string): ActivityAttemptType {
	return {
		jobId: crypto.randomUUID(),
		claimId: crypto.randomUUID(),
		attempt: 1,
		activityId: Work.id,
		activityVersion: Work.version,
		engineId: Engine.id,
		registrationId: 'registration',
		hostId: 'host',
		generation: 1,
		origin: {
			workflowId: 'native.corpus',
			workflowVersion: '1',
			runId: 'run',
			instructionPath: '0',
			instructionFingerprint: 'fingerprint',
		},
		context: context.snapshot(ctx),
		input,
		admitted: true,
	};
}
/** Uses each actual provider boundary; no imitation transport supplies results or cancellation receipts. */
async function verify(provider: EngineProvider, owner: context.Context): Promise<void> {
	let heartbeats = 0;
	const control = {
		async heartbeat() {
			heartbeats++;
		},
	};
	expect(await provider.run(owner, attempt(owner, 'hello'), control)).toEqual({ type: 'success', value: 'HELLO' });
	expect(heartbeats).toBe(1);
	const denied = await provider.run(owner, attempt(owner, 'failure'), control);
	expect(denied.type).toBe('failure');
	if (denied.type !== 'failure') throw new Error('Expected declared failure.');
	expect(failure.is(denied.failure, Rejected)).toBe(true);
	expect((await provider.run(owner, attempt(owner, 'fault'), control)).type).toBe('fault');
	await using cancelled = context.child(owner);
	context.cancel(cancelled, 'before-dispatch');
	let outcome: Awaited<ReturnType<EngineProvider['run']>> | undefined;
	let rejected = false;
	try {
		outcome = await provider.run(cancelled, attempt(cancelled, 'unused'), control);
	} catch (error) {
		rejected = true;
		expect(error === cancelled.signal.reason || error instanceof context.ContextCancelledError).toBe(true);
	}
	if (!rejected) expect(outcome?.type).toBe('cancelled');
	expect(heartbeats).toBe(1);
}
it('preserves the shared corpus across local, actual module Worker and actual child process providers', async () => {
	await using ctx = context.create({ id: 'native-provider' });
	await using resources = resource.create(resource.implementations(), { ctx, host: {} });
	await verify(local.create({ engine: Engine, implementations: [Live], resources }), ctx);
	await using thread = await worker.create({
		ctx,
		engine: Engine,
		activities: [Work],
		module: new URL('./fixtures/provider-thread.ts', import.meta.url),
		maximum: 1,
		shutdownMs: 100,
	});
	await verify(thread, ctx);
	await using child = await process.create({
		ctx,
		engine: Engine,
		activities: [Work],
		adapter: runtime.create(),
		maximum: 1,
		maximumFrameBytes: 8192,
		start: {
			command: Deno.execPath(),
			arguments: ['run', '-A', new URL('./fixtures/provider-process.ts', import.meta.url).pathname],
			cwd: new URL('../', import.meta.url),
			stderr: { type: 'capture', maximumBytes: 8192 },
			shutdown: { graceMs: 100, forceMs: 100 },
		},
	});
	await verify(child, ctx);
});

it(
	'runs B on the same actual host while A waits, for both Worker and child process providers',
	{ timeout: 20_000 },
	async () => {
		await using ctx = context.create({ id: 'native-sharing' });
		await using thread = await worker.create({
			ctx,
			engine: Engine,
			activities: [Work],
			maximum: 1,
			concurrency: 2,
			module: new URL('./fixtures/provider-thread.ts', import.meta.url),
			shutdownMs: 100,
		});
		await using child = await process.create({
			ctx,
			engine: Engine,
			activities: [Work],
			maximum: 1,
			concurrency: 2,
			adapter: runtime.create(),
			maximumFrameBytes: 8192,
			start: {
				command: Deno.execPath(),
				arguments: ['run', '-A', new URL('./fixtures/provider-process.ts', import.meta.url).pathname],
				cwd: new URL('../', import.meta.url),
				stderr: { type: 'capture', maximumBytes: 8192 },
				shutdown: { graceMs: 100, forceMs: 100 },
			},
		});
		for (const provider of [thread, child]) {
			const entered = Promise.withResolvers<string>();
			const release = Promise.withResolvers<void>();
			let settled = false;
			const a = provider.run(ctx, attempt(ctx, 'hold'), {
				async heartbeat(value) {
					entered.resolve((value as { host: string }).host);
					await release.promise;
				},
			}).finally(() => {
				settled = true;
			});
			try {
				const host = await entered.promise;
				const b = await provider.run(ctx, attempt(ctx, 'host'), { async heartbeat() {} });
				expect(b).toEqual({ type: 'success', value: host });
				expect(settled).toBe(false);
				expect(provider.stats().leased).toBe(1);
				await using cancelled = context.child(ctx);
				const ready = Promise.withResolvers<void>();
				const stopping = provider.run(cancelled, attempt(cancelled, 'cancel'), {
					async heartbeat() {
						ready.resolve();
					},
				});
				await ready.promise;
				context.cancel(cancelled, 'cancel one shared attempt');
				expect((await stopping).type).toBe('cancelled');
				expect(await provider.run(ctx, attempt(ctx, 'host'), { async heartbeat() {} })).toEqual({
					type: 'success',
					value: host,
				});
				expect(settled).toBe(false);
			} finally {
				release.resolve();
				await a;
			}
		}
	},
);

it(
	'fences affected attempts after forced shared Worker and process loss, then creates fresh hosts',
	{ timeout: 20000 },
	async () => {
		await using ctx = context.create({ id: 'native-shared-loss' });
		await using thread = await worker.create({
			ctx,
			engine: Engine,
			activities: [Work],
			maximum: 1,
			concurrency: 2,
			module: new URL('./fixtures/provider-thread.ts', import.meta.url),
			shutdownMs: 25,
		});
		await using child = await process.create({
			ctx,
			engine: Engine,
			activities: [Work],
			maximum: 1,
			concurrency: 2,
			adapter: runtime.create(),
			maximumFrameBytes: 8192,
			start: {
				command: Deno.execPath(),
				arguments: ['run', '-A', new URL('./fixtures/provider-process.ts', import.meta.url).pathname],
				cwd: new URL('../', import.meta.url),
				stderr: { type: 'capture', maximumBytes: 8192 },
				shutdown: { graceMs: 100, forceMs: 100 },
			},
		});
		for (const provider of [thread, child]) {
			await using cancelled = context.child(ctx);
			const stuck = Promise.withResolvers<string>();
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const a = provider.run(cancelled, attempt(cancelled, 'stuck'), {
				async heartbeat(value) {
					stuck.resolve((value as { host: string }).host);
				},
			});
			const old = await stuck.promise;
			const b = provider.run(ctx, attempt(ctx, 'hold'), {
				async heartbeat() {
					entered.resolve();
					await release.promise;
				},
			});
			try {
				await entered.promise;
				context.cancel(cancelled, 'stop stuck request');
				expect((await a).type).toBe('cancelled');
				expect((await b).type).toBe('lost');
				const next = await provider.run(ctx, attempt(ctx, 'host'), { async heartbeat() {} });
				expect(next.type).toBe('success');
				if (next.type === 'success') expect(next.value).not.toBe(old);
			} finally {
				release.resolve();
				await Promise.allSettled([a, b]);
			}
		}
	},
);
