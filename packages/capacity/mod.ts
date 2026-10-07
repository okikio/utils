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
