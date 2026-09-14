import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as activityProcess from '@okikio/activity/process';
import * as context from '@okikio/context';
import type { EffectOccurrence } from '@okikio/effect';
import * as denoProcess from '@okikio/process/deno';
import * as schema from '@okikio/schema';
import * as workflow from '@okikio/workflow';
import * as dispatch from '@okikio/workflow/dispatch';
import { Attempted, Engine, Execute, ResultSchema } from './fixtures/process-activity.ts';

const AnySchema = Object.freeze({
	'~standard': Object.freeze({
		version: 1 as const,
		vendor: 'process-orchestration-scenario',
		validate(value: unknown) { return { value }; },
	}),
});

type ProcessResult = StandardSchemaV1.InferOutput<typeof ResultSchema>;
type ProcessOutput = Readonly<{
	readonly first: Readonly<{ readonly left: ProcessResult; readonly fragile: ProcessResult; readonly right: ProcessResult }>;
	readonly final: ProcessResult;
}>;
const OutputSchema = Object.freeze({
	'~standard': Object.freeze({
		version: 1 as const,
		vendor: 'process-orchestration-scenario',
		validate(value: unknown) { return { value: value as ProcessOutput }; },
	}),
} satisfies StandardSchemaV1<unknown, ProcessOutput>);

const Definition = workflow.define({
	id: 'scenario.process-orchestration.workflow',
	version: '1',
	input: AnySchema,
	result: OutputSchema,
	activities: [Execute],
});

const Implementation = workflow.implement(Definition, function* (): workflow.WorkflowProgram<ProcessOutput> {
	const first = yield* workflow.parallel({
		left: workflow.activity<ProcessResult, never>(Execute, { task: 'left', crashFirst: false }),
		fragile: workflow.activity<ProcessResult, never>(Execute, { task: 'fragile', crashFirst: true }),
		right: workflow.activity<ProcessResult, never>(Execute, { task: 'right', crashFirst: false }),
	});
	const final = yield* workflow.activity<ProcessResult, never>(Execute, {
		task: `final:${first.left.task}+${first.fragile.task}+${first.right.task}`,
		crashFirst: false,
	});
	return Object.freeze({ first, final });
});

test('parallel workflow fan-out survives a child-process crash and fans back in through a replacement host', async () => {
	await using parent = context.create({ id: 'scenario.process-orchestration.parent' });
	const observed: Array<Readonly<{ task: string; pid: number; attempt: number }>> = [];
	const emitter = Object.freeze({
		async emit(_ctx: context.Context, occurrence: EffectOccurrence) {
			if (occurrence.definition !== Attempted) throw new TypeError('Unexpected process effect.');
			observed.push(occurrence.value as { task: string; pid: number; attempt: number });
		},
	});
	const host = new URL('./fixtures/process-host.ts', import.meta.url);
	await using provider = await activityProcess.create({
		ctx: parent,
		engine: Engine,
		activities: [Execute],
		adapter: denoProcess.create(),
		start: {
			command: Deno.execPath(),
			arguments: ['run', '-A', host.pathname],
			cwd: new URL('../', import.meta.url),
			stderr: { type: 'capture', maximumBytes: 64 * 1024 },
			shutdown: { graceMs: 200, forceMs: 200 },
		},
		minimum: 2,
		maximum: 2,
		maximumIdle: 2,
		effect: emitter,
	});
		await using jobs = dispatch.memory();
		await using scheduler = workflow.scheduler({ activityDispatch: jobs, claimDuration: { seconds: 5 } });
		await using registration = await workflow.executor({
			dispatch: jobs,
			engine: Engine,
			hostId: 'process-pool',
			claimDuration: { seconds: 5 },
			capacity: 2,
		provider,
		});
	await using runCtx = await workflow.context({
		definition: Definition,
		runId: 'process-orchestration-run',
		input: Object.freeze({}),
		ctx: parent,
	});

	const output = await schema.parse(
		OutputSchema,
		await workflow.run<typeof Definition>({ ctx: runCtx, implementation: Implementation, scheduler }),
	);
	assert.equal(output.first.left.task, 'left');
	assert.equal(output.first.fragile.task, 'fragile');
	assert.equal(output.first.right.task, 'right');
	assert.equal(output.final.task, 'final:left+fragile+right');

	const fragile = observed.filter((entry) => entry.task === 'fragile');
	assert.deepEqual(fragile.map((entry) => entry.attempt), [1, 2]);
	assert.equal(fragile.length, 2);
	assert.notEqual(fragile[0]!.pid, fragile[1]!.pid, 'retry should run in a replacement child process');
	assert.equal(output.first.fragile.attempt, 2);
		assert.equal(provider.stats().leased, 0);
	});
