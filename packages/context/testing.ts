/** Bounded deterministic-clock controls. Clock-idle is not proof that all application promises have settled. @module */
import type { TestClock } from './mod.ts';
import type { Temporal } from '@okikio/duration/temporal';

/** Inspect a snapshot of scheduled sleep targets in increasing time order. */
export function pending(clock: TestClock): readonly Temporal.Instant[] {
	return clock.pending();
}

/**
 * Advance to scheduled targets, giving the caller's chosen number of microtask turns after each step.
 * Throws when maximumSteps is exhausted with sleepers still pending. An empty snapshot after the
 * configured turns means clock-idle only: native I/O or longer promise chains can schedule later work.
 */
export async function advanceUntilIdle(
	clock: TestClock,
	options: Readonly<{ readonly maximumSteps: number; readonly maximumMicrotasks: number }>,
): Promise<Readonly<{ readonly steps: number; readonly now: Temporal.Instant }>> {
	if (
		!Number.isSafeInteger(options.maximumSteps) || options.maximumSteps < 0 ||
		!Number.isSafeInteger(options.maximumMicrotasks) || options.maximumMicrotasks < 1
	) throw new RangeError('Clock steps must be non-negative and microtask turns must be positive safe integers.');
	let steps = 0;
	while (true) {
		for (let turn = 0; turn < options.maximumMicrotasks; turn++) await Promise.resolve();
		const target = clock.pending()[0];
		if (target === undefined) return Object.freeze({ steps, now: clock.now() });
		if (steps >= options.maximumSteps) throw new RangeError('Clock simulation exceeds maximumSteps.');
		clock.set(target);
		steps++;
	}
}
