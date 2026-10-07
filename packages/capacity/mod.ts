/**
 * Reserve several scarce resources together. Separate counters can admit half of a request and leave work holding a browser while it waits forever for an upload slot.
 *
 * Use admission for local concurrency, then add units and constraints to describe relationships such as threads per core. Reservations are atomic and waiting requests keep FIFO fairness. An impossible request fails before queueing. The caller must release each lease and cancel waits when it no longer needs work. These counters govern one process; a cluster needs an authoritative distributed adapter.
 *
 * @example
 * ```ts
 * import * as capacity from '@okikio/capacity';
 * const host = capacity.create({ browsers: 2, uploads: 4 });
 * const lease = await capacity.acquire(host, { browsers: 1, uploads: 3 });
 * try {
 *   console.log(JSON.stringify(capacity.available(host)));
 * } finally {
 *   lease.release();
 * }
 * console.log(JSON.stringify(capacity.available(host)));
 * ```
 *
 * @module
 */
export { acquire, available, create, snapshot } from './admission.ts';
export { assert, CapacityExceededError, check, compose, constraint, define, field, unit } from './standard.ts';
export type {
	Admission,
	AdmissionCancellation,
	AdmissionLease,
	AdmissionLimits,
	AdmissionRequest,
	AdmissionSnapshot,
	CapacityConstraint,
	CapacityDefinition,
	CapacityField,
	CapacityFields,
	CapacityStatusType,
	CapacityUnit,
	CapacityValues,
	CheckResult,
	ConstraintResult,
	MergeFields,
} from './standard.ts';
