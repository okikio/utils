/**
 * Input guards for durable workflow control state.
 *
 * These bounds apply to identifiers, admission counts, and temporary leases in
 * both Scheduler and dispatch owners. Keeping them here prevents local hosts
 * from accepting state that a durable adapter would need to reject later.
 *
 * @module
 */

import { MAX_ACTIVE_CHILDREN } from './scope.ts';
import type { WorkflowInstruction, WorkflowOperation } from './types.ts';

/**
 * Reject an empty or unbounded identifier before it becomes durable state.
 *
 * @internal
 */
export function id(value: string, label: string): void {
	if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) {
		throw new TypeError(`${label} id must contain 1 to 512 characters.`);
	}
}

/**
 * Return one positive safe integer used for capacity or protocol policy.
 *
 * @internal
 */
export function positive(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
	return value;
}

/**
 * Return one strictly positive duration used for temporary ownership.
 *
 * @internal
 */
export function duration(value: Temporal.Duration | Temporal.DurationLike | string, label: string): Temporal.Duration {
	const result = Temporal.Duration.from(value);
	if (result.sign <= 0) throw new TypeError(`${label} must be greater than zero.`);
	return result;
}

/**
 * Require an iterable operation before the interpreter asks it for a generator.
 *
 * @internal
 */
export function assertOperation(value: unknown): asserts value is WorkflowOperation<unknown, unknown> {
	if (
		typeof value !== 'object' || value === null ||
		typeof (value as WorkflowOperation<unknown, unknown>)[Symbol.iterator] !== 'function'
	) {
		throw new TypeError('Workflow operation must implement Symbol.iterator.');
	}
}

/**
 * Check the common instruction envelope before selecting its command reader.
 * Specific command payloads are validated by their owning readers.
 *
 * @internal
 */
export function assertInstruction(value: unknown): asserts value is WorkflowInstruction {
	if (typeof value !== 'object' || value === null) {
		throw new TypeError('Workflow program yielded a non-instruction value.');
	}
	const instruction = value as Partial<WorkflowInstruction>;
	if (instruction.category !== 'command' && instruction.category !== 'control') {
		throw new TypeError('Workflow instruction category must be command or control.');
	}
	if (typeof instruction.type !== 'string' || instruction.type.length === 0) {
		throw new TypeError('Workflow instruction type must be a non-empty string.');
	}
	if (!Number.isSafeInteger(instruction.version) || (instruction.version ?? 0) < 1) {
		throw new TypeError('Workflow instruction version must be a positive safe integer.');
	}
}

/**
 * Require the restricted identifier alphabet used in workflow paths and bindings.
 *
 * @internal
 */
export function assertIdentifier(value: string, label: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) throw new TypeError(`Invalid ${label} id ${JSON.stringify(value)}.`);
}

/**
 * Bound a caller-supplied instruction key before retaining it in replay identity.
 *
 * @internal
 */
export function assertStableKey(value: string): void {
	if (value.trim().length === 0) throw new TypeError('Workflow instruction keys must not be empty.');
	if (value.length > 512) throw new TypeError('Workflow instruction keys must not exceed 512 characters.');
}

/**
 * Bound branch fan-out by the same limit enforced when a live scope admits children.
 *
 * @internal
 */
export function boundedConcurrency(value: number, label: string): number {
	const concurrency = positive(value, label);
	if (concurrency > MAX_ACTIVE_CHILDREN) {
		throw new RangeError(`${label} cannot exceed ${MAX_ACTIVE_CHILDREN}.`);
	}
	return concurrency;
}
