import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schemaCore from '@okikio/schema';
import * as context from '@okikio/context';
import * as workflow from './mod.ts';

const Approved = workflow.signal({ id: 'import.approved', value: schemaCore.string() });
const Work = workflow.define({
	id: 'import.wait',
	version: '1',
	input: schemaCore.object({}),
	result: schemaCore.unknown(),
});

describe('named workflow events', () => {
	it('retains early delivery, detects changed duplicates, and supplies the waiting workflow', async () => {
		using inbox = workflow.events();
		await inbox.send('run', Approved, 'yes', { key: 'approval' });
		await inbox.send('run', Approved, 'yes', { key: 'approval' });
		await expect(inbox.send('run', Approved, 'no', { key: 'approval' })).rejects.toMatchObject({
			code: 'event_conflict',
		});
		await using owner = context.create({ id: 'owner' });
		await using ctx = await workflow.context({ definition: Work, input: {}, runId: 'run', ctx: owner });
		await using scheduler = workflow.scheduler({ events: inbox });
		const implementation = workflow.implement(Work, function* () {
			return yield* workflow.wait({ event: Approved, key: 'approval' });
		});
		expect(await workflow.run({ ctx, implementation, scheduler })).toEqual({ type: 'received', value: 'yes' });
	});
	it('waits for later delivery and releases a cancelled waiter', async () => {
		using inbox = workflow.events();
		await using owner = context.create({ id: 'owner' });
		await using ctx = await workflow.context({ definition: Work, input: {}, runId: 'run', ctx: owner });
		const command = workflow.wait({ event: Approved, key: 'approval' })[Symbol.iterator]().next()
			.value as workflow.WorkflowEventCommand;
		const waiting = inbox.wait(ctx, command, '0');
		await inbox.send('run', Approved, 'yes', { key: 'approval' });
		expect(await waiting).toEqual({ type: 'received', value: 'yes' });
		const other = inbox.wait(ctx, { ...command, eventKey: 'other' }, '1');
		context.cancel(owner, new Error('cancelled'));
		await expect(other).rejects.toThrow('cancelled');
	});
	it('distinguishes an undefined event from timeout and rejects a second consumer', async () => {
		using inbox = workflow.events();
		const Empty = workflow.signal({ id: 'import.empty', value: schemaCore.literal(undefined) });
		await using owner = context.create({ id: 'owner' });
		await using ctx = await workflow.context({ definition: Work, input: {}, runId: 'run', ctx: owner });
		await inbox.send('run', Empty, undefined, { key: 'empty' });
		const command = workflow.wait({ event: Empty, key: 'empty' })[Symbol.iterator]().next()
			.value as workflow.WorkflowEventCommand;
		expect(await inbox.wait(ctx, command, '0')).toEqual({ type: 'received', value: undefined });
		await expect(inbox.wait(ctx, command, '1')).rejects.toMatchObject({ code: 'event_wait_conflict' });
	});
	it('releases a waiting subscription when its local inbox closes', async () => {
		using inbox = workflow.events();
		await using owner = context.create({ id: 'owner' });
		await using ctx = await workflow.context({ definition: Work, input: {}, runId: 'run', ctx: owner });
		const command = workflow.wait({ event: Approved, key: 'approval' })[Symbol.iterator]().next()
			.value as workflow.WorkflowEventCommand;
		const waiting = inbox.wait(ctx, command, '0');
		inbox.close();
		await expect(waiting).rejects.toMatchObject({ code: 'events_closed' });
	});
	it('releases deadline timers after delivery, timeout, cancellation, and close', async () => {
		const time = new context.TestClock();
		let timers = 0;
		const clock: context.Clock = {
			now: () => time.now(),
			sleep(milliseconds, signal) {
				timers++;
				return time.sleep(milliseconds, signal).finally(() => {
					timers--;
				});
			},
		};
		using inbox = workflow.events({ clock });
		await using owner = context.create({ id: 'owner' });
		await using ctx = await workflow.context({ definition: Work, input: {}, runId: 'run', ctx: owner });
		const command = (key: string) =>
			workflow.wait({ event: Approved, key, until: time.now().add({ seconds: 1 }).toString() })[Symbol.iterator]()
				.next().value as workflow.WorkflowEventCommand;
		const delivered = inbox.wait(ctx, command('delivery'), '0');
		expect(timers).toBe(1);
		await inbox.send('run', Approved, 'yes', { key: 'delivery' });
		expect(await delivered).toEqual({ type: 'received', value: 'yes' });
		expect(timers).toBe(0);
		const expired = inbox.wait(ctx, command('timeout'), '1');
		time.advance({ seconds: 1 });
		expect(await expired).toEqual({ type: 'timeout' });
		expect(timers).toBe(0);
		const cancelled = inbox.wait(ctx, command('cancel'), '2');
		context.cancel(owner, new Error('cancelled'));
		await expect(cancelled).rejects.toThrow('cancelled');
		expect(timers).toBe(0);
		await using fresh = context.create({ id: 'fresh' });
		await using next = await workflow.context({ definition: Work, input: {}, runId: 'next', ctx: fresh });
		const closed = inbox.wait(next, command('close'), '0');
		inbox.close();
		await expect(closed).rejects.toMatchObject({ code: 'events_closed' });
		expect(timers).toBe(0);
	});
	it('keeps parallel waits separate without installing a timer for indefinite waits', async () => {
		using inbox = workflow.events({
			clock: {
				now: context.SystemClock.now,
				sleep() {
					throw new Error('An indefinite wait must not install a timer.');
				},
			},
		});
		await using owner = context.create({ id: 'owner' });
		await using ctx = await workflow.context({ definition: Work, input: {}, runId: 'run', ctx: owner });
		const command = (key: string) =>
			workflow.wait({ event: Approved, key })[Symbol.iterator]().next().value as workflow.WorkflowEventCommand;
		let secondFinished = false;
		const first = inbox.wait(ctx, command('first'), '0');
		const second = inbox.wait(ctx, command('second'), '1').then((value) => {
			secondFinished = true;
			return value;
		});
		await inbox.send('other-run', Approved, 'unrelated', { key: 'second' });
		await inbox.send('run', Approved, 'first value', { key: 'first' });
		expect(await first).toEqual({ type: 'received', value: 'first value' });
		expect(secondFinished).toBe(false);
		await inbox.send('run', Approved, 'second value', { key: 'second' });
		expect(await second).toEqual({ type: 'received', value: 'second value' });
	});
	it('returns timeout, bounds retained keys, and includes the deadline in replay identity', async () => {
		using inbox = workflow.events({ capacity: 1 });
		await using owner = context.create({ id: 'owner' });
		await using ctx = await workflow.context({ definition: Work, input: {}, runId: 'run', ctx: owner });
		const first = workflow.wait({ event: Approved, key: 'approval', until: '2000-01-01T00:00:00Z' });
		const command = first[Symbol.iterator]().next().value as workflow.WorkflowEventCommand;
		expect(await inbox.wait(ctx, command, '0')).toEqual({ type: 'timeout' });
		await expect(inbox.send('run', Approved, 'late', { key: 'approval' })).rejects.toMatchObject({
			code: 'event_closed',
		});
		await expect(inbox.send('run', Approved, 'yes', { key: 'next' })).rejects.toMatchObject({ code: 'event_capacity' });
		const second = workflow.wait({ event: Approved, key: 'approval', until: '2001-01-01T00:00:00Z' })
			[Symbol.iterator]().next().value as workflow.WorkflowEventCommand;
		expect((await workflow.identify(command, '0')).fingerprint).not.toBe(
			(await workflow.identify(second, '0')).fingerprint,
		);
	});
});
