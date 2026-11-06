/** Full production replay and bounded archive ownership; completed control programs remain opaque. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '#tools/bench/run.ts';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as workflow from '@okikio/workflow';
import * as testing from '@okikio/workflow/testing';
import * as replay from '@okikio/workflow/replay';
await using ctx = context.create({ id: 'fixture-bench' });
const Definition = workflow.define({
	id: 'fixture.benchmark',
	version: '1',
	input: schema.number(),
	result: schema.number(),
});
const Live = workflow.implement(Definition, function* (ctx) {
	for (let index = 0; index < ctx.input; index++) yield* workflow.sleep('PT1S');
	return ctx.input;
});
for (const count of [10, 1000]) {
	const limits = { maximumEntries: count, maximumBytes: count * 2000 };
	const recorded = await testing.run(Live, {
		...limits,
		ctx,
		input: count,
		runId: `fixture-${count}`,
		scheduler: {
			async command() {
				return workflow.success(Temporal.Instant.from('2026-01-01T00:00:00Z'));
			},
		},
	});
	const archive = await testing.encode(recorded.fixture, limits);
	const checked = await replay.check(Live, recorded.fixture, { ...limits, ctx });
	if (checked.matched !== count || checked.value !== count) throw new Error('Replay oracle failed.');
	group(`completed native history ${count}`, () => {
		bench(
			'production replay check',
			async () => do_not_optimize(await replay.check(Live, recorded.fixture, { ...limits, ctx })),
		);
		bench('bounded archive integrity import', async () => do_not_optimize(await testing.decode(archive, limits)));
		bench('bounded diagnostic copy', () => do_not_optimize(testing.freeze(recorded.fixture, limits)));
	});
}
await run();
