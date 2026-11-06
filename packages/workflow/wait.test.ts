import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schemaCore from '@okikio/schema';
import * as workflow from './mod.ts';

const Approved = workflow.signal({ id: 'wait.approved', value: schemaCore.string() });
const until = '2030-01-01T00:00:00Z';

/** Read the request without running a timer or connecting an event inbox. */
function instruction(operation: workflow.WorkflowOperation<unknown>): workflow.WorkflowInstruction {
	const step = operation[Symbol.iterator]().next();
	if (step.done) throw new Error('Expected a wait instruction.');
	return step.value;
}

describe('unified wait', () => {
	it('keeps the saved instruction format for events and both timer forms', () => {
		expect(instruction(workflow.wait({ event: Approved, key: 'approval', until })))
			.toEqual(instruction(workflow.waitForEvent(Approved, { key: 'approval', until })));
		expect(instruction(workflow.wait({ duration: 'PT1S', key: 'pause', annotations: { reason: 'rate' } })))
			.toEqual(instruction(workflow.sleep('PT1S', { key: 'pause', annotations: { reason: 'rate' } })));
		expect(instruction(workflow.wait({ until, key: 'expiry' })))
			.toEqual(instruction(workflow.sleepUntil(until, { key: 'expiry' })));
	});
	it('returns an Instant from either timer form and accepts recorded string results', () => {
		const absolute = workflow.wait({ until })[Symbol.iterator]();
		expect(absolute.next().value).toMatchObject({ type: 'sleep-until' });
		const result = absolute.next(workflow.success(until));
		expect(result.done).toBe(true);
		expect(result.value).toBeInstanceOf(Temporal.Instant);
		expect(result.value?.toString()).toBe(Temporal.Instant.from(until).toString());
		const relative = workflow.wait({ duration: { seconds: 1 } })[Symbol.iterator]();
		expect(relative.next().value).toMatchObject({ type: 'sleep' });
		const instant = Temporal.Instant.from(until);
		expect(relative.next(workflow.success(instant))).toEqual({ done: true, value: instant });
	});
	it('delegates timers and events through ordinary generators without hiding instructions', () => {
		function* approval() {
			yield* workflow.wait({ until, key: 'opening' });
			return yield* workflow.wait({ event: Approved, key: 'approval', until });
		}
		function* program() {
			return yield* approval();
		}
		const run = program();
		expect(run.next().value).toMatchObject({ type: 'sleep-until', key: 'opening' });
		expect(run.next(workflow.success(until)).value).toMatchObject({ type: 'wait-event', eventKey: 'approval' });
		expect(run.next(workflow.success({ type: 'received', value: 'yes' }))).toEqual({
			done: true,
			value: { type: 'received', value: 'yes' },
		});
	});
	it('returns event timeout as data and preserves cancellation through timer delegation', () => {
		const event = workflow.wait({ event: Approved, key: 'approval', until })[Symbol.iterator]();
		event.next();
		expect(event.next(workflow.success({ type: 'timeout' }))).toEqual({ done: true, value: { type: 'timeout' } });
		const timer = workflow.wait({ until })[Symbol.iterator]();
		timer.next();
		expect(() => timer.next({ type: 'cancelled', reason: 'shutdown' })).toThrow(workflow.CancelledError);
	});
	it('rejects ambiguous or incomplete options before a request is yielded', () => {
		// These calls also verify the public TypeScript boundary. JavaScript callers get runtime checks.
		// @ts-expect-error Event addresses require a key.
		expect(() => workflow.wait({ event: Approved })).toThrow(TypeError);
		// @ts-expect-error A timer cannot have both forms.
		expect(() => workflow.wait({ duration: 'PT1S', until })).toThrow(TypeError);
		// @ts-expect-error Event waits use an absolute deadline, not a duration.
		expect(() => workflow.wait({ event: Approved, key: 'approval', duration: 'PT1S' })).toThrow(TypeError);
		// @ts-expect-error Empty waits have no meaning.
		expect(() => workflow.wait({})).toThrow(TypeError);
		expect(() => workflow.wait({ duration: '-PT1S' })).toThrow(RangeError);
		expect(() => workflow.wait({ until: 'tomorrow' })).toThrow(RangeError);
		expect(() => workflow.wait({ event: Approved, key: ' ' })).toThrow(TypeError);
	});
	it('keeps defer for cleanup and retains the deprecated custom host signature', () => {
		expect(() => workflow.defer(workflow.wait({ duration: 'PT1S' }))).toThrow(TypeError);
		expect(() => workflow.defer(workflow.wait({ until }))).toThrow(TypeError);
		expect(instruction(workflow.wait(Approved, { match: 'yes' }, { key: 'custom' }))).toMatchObject({
			type: 'wait',
			signal: Approved,
			input: { match: 'yes' },
			key: 'custom',
		});
	});
});
