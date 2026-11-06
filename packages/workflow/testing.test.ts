import { it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as workflow from './mod.ts';
import * as testing from './testing.ts';
import * as replay from './replay/check.ts';
import { ReplayError } from './history.ts';
const Definition = workflow.define({
	id: 'fixture.work',
	version: '1',
	input: schema.string(),
	result: schema.string(),
});
const Live = workflow.implement(Definition, function* (ctx) {
	yield* workflow.sleep('PT1S');
	return ctx.input;
});
const limits = { maximumEntries: 100, maximumBytes: 100000 };
it('records and replays through the real scheduler without repeating external commands', async () => {
	await using ctx = context.create({ id: 'fixture-owner' });
	let commands = 0;
	const recorded = await testing.run(Live, {
		...limits,
		ctx,
		runId: 'fixture-run',
		input: 'hello',
		scheduler: {
			async command() {
				commands++;
				return workflow.success(Temporal.Instant.from('2026-01-01T00:00:00Z'));
			},
		},
	});
	expect(recorded.value).toBe('hello');
	expect(commands).toBe(1);
	const archive = await testing.encode(recorded.fixture, limits);
	const fixture = await testing.decode(archive, limits);
	expect(Object.isFrozen(fixture.history.entries[0]?.completion)).toBe(true);
	const checked = await replay.check(Live, fixture, { ...limits, ctx });
	expect(checked).toEqual({ value: 'hello', matched: 1, opaqueControls: [] });
	expect(commands).toBe(1);
	const changed = workflow.implement(Definition, function* (ctx) {
		yield* workflow.sleep('PT2S');
		return ctx.input;
	});
	await expect(replay.check(changed, fixture, { ...limits, ctx })).rejects.toBeInstanceOf(ReplayError);
	// deno-lint-ignore require-yield -- A zero-instruction workflow still uses the generator contract.
	const empty = workflow.implement(Definition, function* (ctx) {
		return ctx.input;
	});
	await expect(replay.check(empty, fixture, { ...limits, ctx })).rejects.toMatchObject({
		code: 'extra',
		path: fixture.history.entries[0]!.path,
	});
	await expect(replay.check(Live, { ...fixture, history: { ...fixture.history, entries: [] } }, { ...limits, ctx }))
		.rejects.toMatchObject({ code: 'missing' });
	const newer = workflow.define({ id: Definition.id, version: '2', input: schema.string(), result: schema.string() });
	await expect(replay.check(
		// deno-lint-ignore require-yield -- A version fixture can return without yielding an instruction.
		workflow.implement(newer, function* (ctx) {
			return ctx.input;
		}),
		fixture,
		{ ...limits, ctx },
	)).rejects.toMatchObject({ code: 'definition' });
	const broken = JSON.parse(archive);
	broken.data = broken.data.replace('hello', 'other');
	await expect(testing.decode(JSON.stringify(broken), limits)).rejects.toThrow('integrity');
	await expect(testing.decode(archive, { ...limits, maximumBytes: 10 })).rejects.toBeInstanceOf(RangeError);
	expect(() =>
		testing.freeze({
			...fixture,
			history: { ...fixture.history, entries: [...fixture.history.entries, ...fixture.history.entries] },
		}, limits)
	).toThrow('Duplicate');
});
it('reports saved control boundaries as opaque and keeps nested effects unexecuted during replay', async () => {
	await using ctx = context.create({ id: 'fixture-control' });
	let commands = 0;
	const live = workflow.implement(Definition, function* (ctx) {
		yield* workflow.parallel({ left: workflow.sleep('PT1S'), right: workflow.sleep('PT2S') });
		return ctx.input;
	});
	const recorded = await testing.run(live, {
		...limits,
		ctx,
		runId: 'control-run',
		input: 'parallel',
		scheduler: {
			async command() {
				commands++;
				return workflow.success(Temporal.Instant.from('2026-01-01T00:00:00Z'));
			},
		},
	});
	expect(commands).toBe(2);
	const checked = await replay.check(live, recorded.fixture, { ...limits, ctx });
	expect(checked.opaqueControls).toHaveLength(1);
	expect(commands).toBe(2);
});

it('preserves undefined input with an explicit archive marker', async () => {
	await using ctx = context.create({ id: 'fixture-undefined' });
	const Definition = workflow.define({
		id: 'fixture.undefined',
		version: '1',
		input: schema.optional(schema.string()),
		result: schema.boolean(),
	});
	const Live = workflow.implement(Definition, function* (ctx) {
		yield* workflow.sleep('PT1S');
		return ctx.input === undefined;
	});
	let commands = 0;
	const recorded = await testing.run(Live, {
		...limits,
		ctx,
		input: undefined,
		runId: 'undefined-run',
		scheduler: {
			async command() {
				commands++;
				return workflow.success(Temporal.Instant.from('2026-01-01T00:00:00Z'));
			},
		},
	});
	expect(recorded.fixture.input).toEqual({ kind: 'undefined' });
	expect(commands).toBe(1);
	const fixture = await testing.decode(await testing.encode(recorded.fixture, limits), limits);
	expect((await replay.check(Live, fixture, { ...limits, ctx })).value).toBe(true);
	expect(commands).toBe(1);
});
