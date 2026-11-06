/** Native host assembly shared by executable tests; no host is opened at import. */
import process from 'node:process';
import * as worker from '@okikio/activity/worker';
import * as child from '@okikio/activity/process';
import * as threads from '@okikio/runtime/node/worker';
import * as processes from '@okikio/runtime/node/process';
import type { Context } from '@okikio/context';
import * as workflow from '@okikio/workflow';
import { Child, ChildLive, Engine, Parent, ParentLive, Work } from './nested-contract.ts';

/** Exactly one physical target per provider; registration can pin that target without pool selection magic. */
export async function open(ctx: Context, kind: 'thread' | 'process', owner: string, concurrency = 2) {
	if (kind === 'thread') {
		return await worker.create({
			ctx,
			engine: Engine,
			activities: [Work],
			maximum: 1,
			concurrency,
			maximumWaiting: 16,
			shutdownMs: 1000,
			module: new URL(process.env.PLACEMENT_THREAD_MODULE ?? './nested-thread.ts', import.meta.url),
			create: (module, selected) =>
				threads.create(module, { env: { ...process.env, PLACEMENT_OWNER: owner }, name: selected.name }),
		});
	}
	return await child.create({
		ctx,
		engine: Engine,
		activities: [Work],
		maximum: 1,
		concurrency,
		maximumWaiting: 16,
		adapter: processes.create(),
		start: {
			command: process.execPath,
			arguments: [new URL(process.env.PLACEMENT_PROCESS_MODULE ?? './nested-process.ts', import.meta.url).pathname],
			env: { ...process.env, PLACEMENT_OWNER: owner },
			stderr: { type: 'capture', maximumBytes: 8192 },
			shutdown: { graceMs: 1000, forceMs: 1000 },
		},
	});
}

/** A custom local child host explicitly forwards inherited placement and borrows the same scheduler. */
export function scheduler(): workflow.Scheduler {
	const selected = workflow.scheduler({
		async command(ctx, command) {
			if (command.type !== 'child-workflow' || command.workflow !== Child) throw new Error('Unexpected command.');
			await using child = await workflow.context({
				definition: Child,
				input: command.input,
				runId: crypto.randomUUID(),
				ctx,
			});
			return workflow.success(
				await workflow.run({
					ctx: child,
					scheduler: selected,
					implementation: workflow.implement(Child, function* (ctx) {
						return yield* workflow.placement.scope(command.options.location!, ChildLive.program(ctx));
					}),
				}),
			);
		},
	});
	return selected;
}

/** Run one nested parent on the selected memory scheduler through its public API. */
export async function run(
	ctx: Context,
	scheduler: workflow.Scheduler,
	location: workflow.placement.SelectionType,
	input = 'value',
) {
	await using parent = await workflow.context({ definition: Parent, input, runId: crypto.randomUUID(), ctx });
	return await workflow.run({
		ctx: parent,
		scheduler,
		implementation: workflow.implement(Parent, function* (ctx) {
			return yield* workflow.placement.scope(location, ParentLive.program(ctx));
		}),
	});
}
