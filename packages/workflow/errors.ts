/** Preserve shared workflow failure identities across local interpretation, replay, and saved-work execution. @module */

import * as faultCore from '@okikio/result/fault';
import type { WorkflowInstruction } from './types.ts';

/** Unexpected fault reported by a workflow interpreter. */
export class FaultError extends Error {
	/** Unexpected diagnostic data projected for this boundary. */
	readonly fault: unknown;

	/** Keep the original defect as both diagnostic data and the error cause. */
	constructor(fault: unknown) {
		super(faultCore.message(fault), { cause: fault });
		this.name = 'FaultError';
		this.fault = fault;
	}
}

/** Cancellation reported by a workflow interpreter. */
export class CancelledError extends Error {
	/** Caller or runtime reason retained for cancellation or failure diagnostics. */
	readonly reason: unknown;

	/** Retain the exact cancellation reason, including an explicit undefined value. */
	constructor(reason: unknown) {
		super('Workflow instruction was cancelled.', reason === undefined ? undefined : { cause: reason });
		this.name = 'CancelledError';
		this.reason = reason;
	}
}

/** Terminal continue-as-new request surfaced by an interpreter. */
export class ContinueAsNewError extends Error {
	/** Input supplied to this validated operation or interpretation. */
	readonly input: unknown;

	/** Carry the replacement run input to the interpreter's terminal boundary. */
	constructor(input: unknown) {
		super('Workflow requested continue as new.');
		this.name = 'ContinueAsNewError';
		this.input = input;
	}
}

/** Lifecycle defect containing primary work and one or more cleanup failures. */
export class CleanupFailureError extends Error {
	/** Primary selected interpretation or source occurrence. */
	readonly primary: unknown;
	/** Failures encountered while releasing owned resources; successful work does not erase them. */
	readonly cleanupFailures: readonly unknown[];

	/** Preserve the primary failure and copy cleanup failures before callers can mutate them. */
	constructor(primary: unknown, cleanupFailures: readonly unknown[]) {
		super('Workflow work failed and one or more required cleanups also failed.', { cause: primary });
		this.name = 'CleanupFailureError';
		this.primary = primary;
		this.cleanupFailures = Object.freeze([...cleanupFailures]);
	}
}

/** Invalid workflow program behavior discovered while closing a generator. */
export class CleanupInstructionError extends Error {
	/** Serializable workflow instruction whose completion is owned by history and scheduling. */
	readonly instruction: WorkflowInstruction;

	/** Identify the instruction illegally yielded while closing a generator. */
	constructor(instruction: WorkflowInstruction) {
		super(
			'Workflow generator cleanup must not yield instructions. Register external cleanup with workflow.defer().',
		);
		this.name = 'CleanupInstructionError';
		this.instruction = instruction;
	}
}
