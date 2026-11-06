import type { StandardSchemaV1 } from '@standard-schema/spec';

/** Named unit used to explain what one capacity value measures. */
export interface CapacityUnit<Id extends string = string> {
	/** Stable unit identifier used by generated diagnostics and documentation. */
	readonly id: Id;
	/** Plain-English description of what the unit measures. */
	readonly description: string;
	/** Optional short display symbol, such as `bytes`, `req`, or `slots`. */
	readonly symbol?: string;
}

/** One schema-backed value that participates in a capacity definition. */
export interface CapacityField<
	Schema extends StandardSchemaV1 = StandardSchemaV1,
	UnitType extends CapacityUnit = CapacityUnit,
> {
	/** Standard Schema contract used to validate the value before constraints run. */
	readonly schema: Schema;
	/** CapacityUnit used by this field. */
	readonly unit: UnitType;
	/** Plain-English explanation of the value. */
	readonly description: string;
}

/** Named fields accepted by a capacity definition. */
export type CapacityFields = Readonly<Record<string, CapacityField>>;

/** Parsed values inferred from a set of capacity fields. */
export type CapacityValues<DefinitionFields extends CapacityFields> = {
	readonly [Key in keyof DefinitionFields]: StandardSchemaV1.InferOutput<DefinitionFields[Key]['schema']>;
};

/** One relationship that compares used capacity with the maximum valid capacity. */
export interface CapacityConstraint<
	Value extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
	UnitType extends CapacityUnit = CapacityUnit,
> {
	/** Stable identifier for diagnostics and tests. */
	readonly id: string;
	/** Plain-English explanation of the relationship. */
	readonly description: string;
	/** CapacityUnit shared by `used` and `maximum`. */
	readonly unit: UnitType;
	/** Return the amount currently used by this relationship. */
	readonly used: (value: Value) => number;
	/** Return the maximum amount allowed by this relationship. */
	readonly maximum: (value: Value) => number;
}

/** Import-safe capacity definition. It performs no I/O and reads no ambient state. */
export interface CapacityDefinition<DefinitionFields extends CapacityFields = CapacityFields> {
	/** Canonical fields keyed by their stable value names. */
	readonly fields: DefinitionFields;
	/** Stable field order used by validation and projections. */
	readonly keys: readonly (keyof DefinitionFields & string)[];
	/** Relationships evaluated after all fields validate. */
	readonly constraints: readonly CapacityConstraint<CapacityValues<DefinitionFields>>[];
}

/** Overall or per-constraint capacity state. */
export type CapacityStatusType = 'satisfied' | 'hit' | 'exceeded';

/** Result for one evaluated constraint. */
export interface ConstraintResult<UnitType extends CapacityUnit = CapacityUnit> {
	/** Stable capacity dimension key used for requests, limits, and diagnostic snapshots. */
	readonly id: string;
	/** Human-readable constraint purpose used by documentation and diagnostics. */
	readonly description: string;
	/** Unit associated with the capacity dimension when the constraint is quantitative. */
	readonly unit: UnitType;
	/** Whether this individual constraint currently admits the requested work. */
	readonly status: CapacityStatusType;
	/** Current amount already consumed in this capacity dimension. */
	readonly used: number;
	/** Maximum simultaneous or retained values permitted by this constraint. */
	readonly maximum: number;
	/** Positive when capacity remains, zero when the limit is hit, negative when exceeded. */
	readonly remaining: number;
}

/** Parsed values and every evaluated capacity relationship. */
export interface CheckResult<Value extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {
	/** Normalized admission request used to evaluate all configured capacity dimensions. */
	readonly value: Value;
	/** Aggregate admission status after every declared capacity constraint is evaluated. */
	readonly status: CapacityStatusType;
	/** Per-dimension results that explain the aggregate admission decision. */
	readonly constraints: readonly ConstraintResult[];
}

/** Inputs accepted by one named atomic admission pool. */
export type AdmissionLimits = Readonly<Record<string, number>>;

/** Units requested atomically from an admission pool. */
export type AdmissionRequest = Readonly<Record<string, number>>;

/** Opaque owner of one set of named admission limits. */
export interface Admission {
	/** Immutable limits configured when the admission pool was created. */
	readonly limits: AdmissionLimits;
}

/** AdmissionCancellation input accepted by {@link acquire}. A Context can be passed directly. */
export type AdmissionCancellation = AbortSignal | Readonly<{ readonly signal: AbortSignal }>;

/** Live admission state used by diagnostics and runtime topology logs. */
export interface AdmissionSnapshot {
	/** Configured total capacity by named dimension. */
	readonly capacity: AdmissionLimits;
	/** Remaining admission capacity without exceeding this admission maximum. */
	readonly available: AdmissionLimits;
	/** Number of acquisition requests currently waiting for capacity. */
	readonly queuedRequests: number;
	/** Age in milliseconds of the oldest queued request, or zero when no request waits. */
	readonly oldestWaitMs?: number;
}

/** AdmissionLease returned after a named request is admitted. */
export interface AdmissionLease extends AsyncDisposable {
	/** Exact units reserved by this lease. */
	readonly request: AdmissionRequest;
	/** Release the reservation. Repeated calls are safe. */
	release(): void;
}
