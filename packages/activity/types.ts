import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Catalog, CatalogSelection, DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import type { Context as BaseContext, Resources as OwnedResources } from '@okikio/context';
import type { EffectDefinition, EffectDefinitions, EffectEmitter, EffectRuntime } from '@okikio/effect';
import type { Occurrence as FailureOccurrence, Definition as FailureDefinition } from '@okikio/failure';
import type { PermissionChecker, PermissionRuntime } from '@okikio/permission';
import type { ResourceCollection, ResourceDefinition, ResourceValue } from '@okikio/resource';
import type { RequirementDefinition, RequirementInput, RequirementDocument, RequirementRuntime } from '@okikio/requirement';
import type { ResilienceInput, ResiliencePolicy } from '@okikio/resilience';
import type { Result as ExplicitResult } from '@okikio/result';
import type { ActivityCommandOptions, ActivityReference, WorkflowOperation } from '@okikio/workflow';
import type { EngineDefinition, EnginePlacementDocumentType, EnginePlacementType, EnginePlacementInputType } from './engine.ts';

/** Standard Schema contract accepted by activity inputs and results. */
export type ActivitySchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

/** Options accepted by `activities.define()`. */
export interface ActivityOptions {
	/** Stable external-work identity used by workflow instructions, providers, and documentation. */
	readonly id: string;
	/** Contract version used to distinguish incompatible activity shapes. */
	readonly version: string;
	/** Human-readable activity purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Schema that validates activity input before execution. */
	readonly input: ActivitySchema;
	/** Schema that validates successful activity output. */
	readonly result: ActivitySchema;
	/** Expected failure definitions or data declared by this activity. */
	readonly failures?: CatalogDefinitionInput<FailureDefinition>;
	/** Required one-way consequences this activity can emit. */
	readonly effects?: EffectDefinitions;
	/** Ordered execution-target selection interpreted by the workflow Scheduler. */
	readonly placement: EnginePlacementInputType;
	/** Resource definitions or collection available to this activity. */
	readonly resources?: CatalogDefinitionInput<ResourceDefinition>;
	/** Requirements owned directly by this activity. Resource requirements stay on their resources. */
	readonly requirements?: RequirementInput;
	/** Static resilience policies applied at the activity lifecycle. */
	readonly resilience?: ResilienceInput;
}

/** Immutable external-work contract. */
export interface ActivityDefinition<Authoring extends ActivityOptions = ActivityOptions> extends ActivityReference {
	/** Stable discriminant for this activity value. */
	readonly kind: 'activity';
	/** Contract version used to distinguish incompatible activity shapes. */
	readonly version: Authoring['version'];
	/** Human-readable activity purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Standard Schema contract that validates activity input before an attempt starts. */
	readonly input: Authoring['input'];
	/** Standard Schema contract that validates successful activity output before completion. */
	readonly result: Authoring['result'];
	/** Expected failure definitions or data declared by this activity. */
	readonly failures: readonly FailureDefinition[];
	/** Required effect definitions or scoped effect state associated with this activity. */
	readonly effects: readonly EffectDefinition[];
	/** Ordered engine placement declaration used before attempt dispatch. */
	readonly placement: EnginePlacementType;
	/** Resource definitions or collection available to this activity. */
	readonly resources: readonly ResourceDefinition[];
	/** Direct requirements only. Use inspection utilities for reachable requirements. */
	readonly requirements: readonly RequirementDefinition[];
	/** Static resilience policies applied at the activity lifecycle. */
	readonly resilience: readonly ResiliencePolicy[];
}

/** Input value inferred from an activity definition. */
export type ActivityInput<Activity extends ActivityDefinition> = StandardSchemaV1.InferOutput<Activity['input']>;

/** Result value inferred from an activity definition. */
export type ActivityResult<Activity extends ActivityDefinition> = StandardSchemaV1.InferOutput<Activity['result']>;

/** Resource union declared by an activity. */
export type ActivityResources<Activity extends ActivityDefinition> = Activity['resources'][number];

/** Declared failure occurrence union inferred from an activity. */
export type ActivityFailures<Activity extends ActivityDefinition> =
	Activity['failures'][number] extends infer Failure extends FailureDefinition ? FailureOccurrence<Failure> : never;

/** One concrete local activity-attempt context. */
export interface ActivityContext<Activity extends ActivityDefinition = ActivityDefinition> extends BaseContext, OwnedResources {
	/** Permission state for dynamic checks declared by this activity attempt. */
	readonly permissions: PermissionRuntime;
	/** Required-effect state that limits emission to effects declared by this activity. */
	readonly effects: EffectRuntime;
	/** Active requirement runtime inherited by resource borrows inside this attempt. */
	readonly requirements: RequirementRuntime;
	/** Exact activity definition whose implementation is running. */
	readonly activity: Activity;
	/** Engine definition selected by the Scheduler for this attempt. */
	readonly engine: EngineDefinition;
	/** Stable logical activity-job identity shared by every retry attempt. */
	readonly jobId: string;
	/** One-based attempt number assigned by the Scheduler. */
	readonly attempt: number;
	/** Schema-validated activity input. */
	readonly input: ActivityInput<Activity>;
	/** Lazily acquire one resource declared by this activity under this attempt's active requirement scope. */
	get<Resource extends ActivityResources<Activity>>(definition: Resource): Promise<ResourceValue<Resource>>;
	/** Wait at one explicit cooperative pause point. */
	checkpoint(): Promise<void>;
	/** Report attempt liveness or provider-specific progress to the owning Scheduler. */
	heartbeat(value?: unknown): Promise<void>;
}

/** Concrete behavior bound to one exact activity definition. Placement remains host-owned. */
export interface ActivityImplementation<Activity extends ActivityDefinition = ActivityDefinition> {
	/** Exact definition this behavior implements. */
	readonly definition: Activity;
	/** Perform one activity attempt with validated input and scoped resources. */
	run(ctx: ActivityContext<Activity>): ActivityResult<Activity> | Promise<ActivityResult<Activity>>;
}

/** Options accepted by `activities.implement()`. */
export interface ActivityImplementationOptions<Activity extends ActivityDefinition> {
	/** Concrete activity behavior bound to the exact definition. */
	run: ActivityImplementation<Activity>['run'];
}

/** Options stored in one serializable workflow activity request. */
export interface ActivityRequestOptions extends ActivityCommandOptions {}

/** Inputs accepted by direct `activities.run()`. */
export interface ActivityRunOptions<Activity extends ActivityDefinition> {
	/** Exact local implementation to invoke. */
	readonly implementation: ActivityImplementation<Activity>;
	/** Engine identity recorded in the local attempt context. */
	readonly engine: EngineDefinition;
	/** Untrusted input validated against the activity definition before work starts. */
	readonly input: unknown;
	/** Borrowed parent context that owns cancellation and timing above this attempt. */
	readonly ctx: BaseContext;
	/** Borrowed resource collection used for declared lazy resource acquisition. */
	readonly resources: ResourceCollection;
	/** Stable logical job identity supplied by the caller or Scheduler. */
	readonly jobId: string;
	/** Current one-based attempt number. */
	readonly attempt: number;
	/** Optional policy evaluator used by dynamic permission checks. */
	readonly permission?: PermissionChecker;
	/** Optional authoritative owner for required effect emission. */
	readonly effect?: EffectEmitter;
	/** Additional requirement-family interpreters available to this direct host. */
	readonly requirements?: RequirementRuntime;
	/** Skip direct admission requirements when the owning Scheduler already applied them before placement. */
	readonly admitted?: boolean;
	/** Optional liveness callback owned by the activity-attempt authority. */
	readonly heartbeat?: (value?: unknown) => void | Promise<void>;
	/** Optional cooperative pause gate supplied by the owning Task or remote host. */
	readonly checkpoint?: () => Promise<void>;
}

/** Named activity catalog. */
export type ActivityCatalog<Entries extends Readonly<Record<PropertyKey, ActivityDefinition>>> = Catalog<
	Entries[keyof Entries],
	Entries
>;

/** Key-preserving activity catalog selection. */
export type ActivitySelection<
	Entry extends ActivityDefinition,
	Entries extends Readonly<Record<PropertyKey, Entry>>,
> = CatalogSelection<Entry, Entries>;

/** JSON-safe activity documentation. */
export interface ActivityDocument {
	/** Stable external-work identity used by workflow instructions, providers, and documentation. */
	readonly id: string;
	/** Contract version used to distinguish incompatible activity shapes. */
	readonly version: string;
	/** Human-readable activity purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Standard Schema vendor reported by the input contract for documentation. */
	readonly inputVendor: string;
	/** Standard Schema vendor reported by the result contract for documentation. */
	readonly resultVendor: string;
	/** Expected failure definitions or data declared by this activity. */
	readonly failures: readonly string[];
	/** Required effect definitions or scoped effect state associated with this activity. */
	readonly effects: readonly string[];
	/** Ordered JSON-safe engine placement documentation. */
	readonly placement: readonly EnginePlacementDocumentType[];
	/** Resource definitions or collection available to this activity. */
	readonly resources: readonly string[];
	/** Requirements owned directly by this activity; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDocument[];
	/** Static resilience policies applied at the activity lifecycle. */
	readonly resilience: readonly string[];
}

/** Explicit result returned by `activities.try()`. */
export type ActivityTryResult<Activity extends ActivityDefinition> =
	ExplicitResult<ActivityResult<Activity>, ActivityFailures<Activity>>;

/** Yieldable workflow request for one activity. */
export type ActivityOperation<Activity extends ActivityDefinition> =
	WorkflowOperation<ActivityResult<Activity>, ActivityFailures<Activity>>;
