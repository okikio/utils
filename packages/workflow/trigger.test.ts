import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as context from '@okikio/context';
import * as effect from '@okikio/capability/effect';
import * as resource from '@okikio/capability/resource';
import * as schema from '@okikio/schema';
import * as task from '@okikio/task';
import * as workflow from './mod.ts';

const TextSchema = schema.string();
const Local = engine.define({ id: 'trigger.local' });
const Work = activity.define({
	id: 'trigger.work',
	version: '1',
	input: TextSchema,
	result: TextSchema,
	placement: engine.require(Local),
});
const Child = workflow.define({ id: 'trigger.child', version: '1', input: TextSchema, result: TextSchema });
const Program = workflow.define({
	id: 'trigger.program',
	version: '1',
	input: TextSchema,
	result: TextSchema,
	activities: [Work],
	workflows: [Child],
});

describe('consumer requests and progress', () => {
	it('builds declared activity, child and background requests without starting work', async () => {
		await using owner = context.create({ id: 'trigger' });
		await using ctx = await workflow.context({ ctx: owner, definition: Program, input: 'input', runId: 'run' });
		const ordinary = ctx.trigger(Work, 'work')[Symbol.iterator]();
		expect(ordinary.next().value).toMatchObject({ type: 'activity', activity: Work, input: 'work' });
		expect(ordinary.next(workflow.success('done'))).toEqual({ done: true, value: 'done' });
		expect(ctx.trigger(Child, 'child')[Symbol.iterator]().next().value).toMatchObject({ type: 'child-workflow' });
		const background = ctx.trigger(Work, 'later', { background: true })[Symbol.iterator]();
		expect(background.next().value).toMatchObject({
			type: 'effect',
			effect: workflow.TriggerEffect,
			value: { definition: { kind: 'activity', id: Work.id }, input: 'later' },
		});
		expect(background.next(workflow.success(undefined))).toEqual({ done: true, value: undefined });
		const Other = workflow.define({ id: 'other', version: '1', input: TextSchema, result: TextSchema });
		// @ts-expect-error Undeclared work is rejected statically and at runtime.
		expect(() => ctx.trigger(Other, 'no')).toThrow('did not declare');
		// @ts-expect-error Definition input remains checked through ctx.trigger.
		ctx.trigger(Work, 42);
	});
	it('waits for background acceptance, validates input, and propagates rejection', async () => {
		await using owner = context.create({ id: 'background' });
		const implementation = workflow.implement(Program, function* (ctx) {
			yield* ctx.trigger(Work, ctx.input, { background: true });
			return 'accepted';
		});
		const entered = Promise.withResolvers<void>();
		const accepted = Promise.withResolvers<void>();
		await using scheduler = workflow.scheduler({
			effect: {
				async emit(_ctx, occurrence) {
					expect(occurrence.definition).toBe(workflow.TriggerEffect);
					entered.resolve();
					await accepted.promise;
				},
			},
		});
		await using ctx = await workflow.context({ ctx: owner, definition: Program, input: 'input', runId: 'background' });
		let finished = false;
		const running = workflow.run({ ctx, implementation, scheduler }).then((value) => {
			finished = true;
			return value;
		});
		await entered.promise;
		expect(finished).toBe(false);
		accepted.resolve();
		expect(await running).toBe('accepted');
		await using rejected = workflow.scheduler({
			effect: {
				async emit() {
					throw new Error('Queue full.');
				},
			},
		});
		await expect(workflow.run({ ctx, implementation, scheduler: rejected })).rejects.toThrow('Queue full.');
		let delivered = false;
		await using checked = workflow.scheduler({
			effect: {
				async emit() {
					delivered = true;
				},
			},
		});
		const invalid = workflow.implement(Program, function* (ctx) {
			yield* ctx.trigger(Work, 42 as never, { background: true });
			return 'invalid';
		});
		await expect(workflow.run({ ctx, implementation: invalid, scheduler: checked })).rejects.toThrow(
			'Expected a string.',
		);
		expect(delivered).toBe(false);
	});
	it('uses one event address by default and separates timers from events', () => {
		const Ready = workflow.signal('trigger.ready', TextSchema);
		expect(workflow.wait(Ready)[Symbol.iterator]().next().value).toMatchObject({
			type: 'wait-event',
			eventKey: 'default',
		});
		expect(workflow.wait(Ready, { key: 'round:2' })[Symbol.iterator]().next().value).toMatchObject({
			eventKey: 'round:2',
		});
		expect(workflow.sleep({ seconds: 2 })[Symbol.iterator]().next().value).toMatchObject({ type: 'sleep' });
		expect(workflow.sleep({ until: '2030-01-01T00:00:00Z' })[Symbol.iterator]().next().value).toMatchObject({
			type: 'sleep-until',
		});
	});
	it('reports standard progress without occurrence keys or mandatory observers', async () => {
		await using work = task.start(async (ctx) => {
			await effect.emit(ctx, task.ProgressEffect, {
				completed: 1,
				total: 2,
				message: 'Saved batch',
				data: { phase: 'rows' },
			});
			await effect.emit(ctx, task.ProgressEffect, { completed: 2, total: 2 });
			return 'done';
		});
		expect(await work.done).toBe('done');
		expect(work.progress?.value).toEqual({ completed: 2, total: 2 });
		expect(() => task.ProgressSchema.parse({ completed: -1 })).toThrow();
		expect(() => task.ProgressSchema.parse({ data: { amount: 1n } })).toThrow();
		for (
			const data of [new Date(), { value: undefined }, new Array(1), {
				get unsafe() {
					throw new Error('Getter ran.');
				},
			}]
		) {
			expect(() => task.ProgressSchema.parse({ data })).toThrow(TypeError);
		}
		expect(() => effect.define({ id: 'invalid.delivery', value: TextSchema, delivery: 'unknown' as never })).toThrow();
		const Business = effect.define({ id: 'business', value: TextSchema });
		await using owner = context.create({ id: 'business' });
		const ctx = effect.scope(owner, { effects: [Business], emitter: { async emit() {} } });
		await expect(effect.emit(ctx, Business, 'value')).rejects.toThrow('requires create options');
	});
	it('defines a typed resource without a second function call', async () => {
		const Store = resource.define<{ read(): string }>({ id: 'direct', description: 'Read text.' });
		await using owner = context.create({ id: 'resources' });
		await using resources = resource.create(
			resource.implementations(resource.implement(Store, { create: () => ({ read: () => 'text' }) })),
			{ ctx: owner, host: {} },
		);
		expect((await resources.get(owner, Store)).read()).toBe('text');
	});
});
