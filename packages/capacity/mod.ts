/**
 * Schema-first capacity definitions and atomic named admission.
 *
 * Import as a namespace so compact operations remain explicit at the call site:
 *
 * ```ts
 * import * as capacity from '@okikio/capacity';
 *
 * const slots = capacity.create({ browserContexts: 4, uploadParts: 8 });
 * await using lease = await capacity.acquire(slots, { browserContexts: 1 }, ctx);
 * ```
 *
 * `define()` and `check()` describe what valid capacity means. `create()` and
 * `acquire()` own local runtime admission. Durable work ownership remains the
 * job of `@okikio/queue`.
 *
 * @module
 */
export { create, available, snapshot, acquire } from './admission.ts';
export { CapacityExceededError, unit, field, constraint, define, compose, check, assert } from './standard.ts';
export type {
	MergeFields,
	CapacityUnit,
	CapacityField,
	CapacityFields,
	CapacityValues,
	CapacityConstraint,
	CapacityDefinition,
	CapacityStatusType,
	ConstraintResult,
	CheckResult,
	AdmissionLimits,
	AdmissionRequest,
	Admission,
	AdmissionCancellation,
	AdmissionSnapshot,
	AdmissionLease,
} from './standard.ts';
