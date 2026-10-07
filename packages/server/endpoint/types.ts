import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	CatalogEntryIdentity,
	CatalogEntryValue,
	DefinitionEntry,
	DefinitionInput,
	ValuedCatalogEntry,
} from '@okikio/catalog';
import type { ProblemDefinition, ProblemResult } from '@okikio/http/problem';
import type { ResponseDefinition, ResponseResult } from '@okikio/http/response';
import type { Context } from '@okikio/context';
import type { EffectContext, EffectDefinitions } from '@okikio/effect';
import type { RequestParsingOptions } from '@okikio/http/request';
import type { MiddlewareInput } from '@okikio/server/middleware';
import type { ResilienceInput } from '@okikio/resilience';
import type { RequirementInput } from '@okikio/requirement';

/** Static resource reference accepted by portable endpoint contracts. */
export type EndpointResourceDefinition<Value = unknown> = ValuedCatalogEntry<'resource', Value>;

/** Runtime value represented by one endpoint resource reference. */
export type EndpointResourceValue<Definition extends EndpointResourceDefinition> = CatalogEntryValue<Definition>;

/** HTTP methods supported by endpoint definitions. */
export type EndpointMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

/** Request locations understood by the endpoint compiler. */
export type EndpointInputSource = 'param' | 'query' | 'header' | 'cookie' | 'json' | 'form' | 'raw';

/** Standard Schema-compatible runtime validation contract. */
export type EndpointSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

/** Concrete request or response example retained for generated documentation. */
export interface EndpointExample<Value = unknown> {
	/** Authored name of this entry or example in its containing catalog. */
	readonly key: string;
	/** Short explanation shown beside this operation or example in generated references. */
	readonly summary?: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
	/** Concrete example payload retained for generated documentation. */
	readonly value: Value;
}

/** Transport-specific documentation wrapped around a first-class schema. */
export interface EndpointInput<Schema extends EndpointSchema = EndpointSchema> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'endpoint-input';
	/** Standard Schema validator and transform for the value accepted by this contract. */
	readonly schema: Schema;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
	/** Whether the declared request input must be present. */
	readonly required?: boolean;
	/** Declared HTTP media type for this input or response body. */
	readonly contentType?: string;
	/** Concrete authored examples retained for API documentation. */
	readonly examples?: readonly EndpointExample[];
	/** Explicit JSON Schema projection when the validator alone cannot describe the wire shape. */
	readonly jsonSchema?: unknown;
	/** Optional transport parsing policy applied before this schema validates the request value. */
	readonly parsing?: RequestParsingOptions;
}

/** Bare or documented schema accepted by one request location. */
export type EndpointInputSlot<Schema extends EndpointSchema = EndpointSchema> = Schema | EndpointInput<Schema>;

/** Flat request input locations accepted by operations and paths. */
export interface EndpointInputSlots {
	/** Schema or input declaration for path parameters. */
	readonly param?: EndpointInputSlot;
	/** Schema or input declaration for query parameters. */
	readonly query?: EndpointInputSlot;
	/** Schema or input declaration for request headers. */
	readonly header?: EndpointInputSlot;
	/** Schema or input declaration for request cookies. */
	readonly cookie?: EndpointInputSlot;
	/** Schema or input declaration for a JSON request body. */
	readonly json?: EndpointInputSlot;
	/** Schema or input declaration for form fields and files. */
	readonly form?: EndpointInputSlot;
	/** Schema or input declaration for the raw request body. */
	readonly raw?: EndpointInputSlot;
}

/** Extract the schema carried by one endpoint input slot. */
export type EndpointInputSchema<Slot> = Slot extends EndpointInput<infer Schema> ? Schema
	: Slot extends EndpointSchema ? Slot
	: never;

/** Wire/authored input values callers must provide before schema transforms. */
export type InferEndpointWireInputs<Inputs extends EndpointInputSlots> = {
	readonly [Source in keyof Inputs as Inputs[Source] extends undefined ? never : Source]: StandardSchemaV1.InferInput<
		EndpointInputSchema<NonNullable<Inputs[Source]>>
	>;
};

/** Parsed and validated output values exposed to an endpoint handler. */
export type InferEndpointInputs<Inputs extends EndpointInputSlots> = {
	readonly [Source in keyof Inputs as Inputs[Source] extends undefined ? never : Source]: StandardSchemaV1.InferOutput<
		EndpointInputSchema<NonNullable<Inputs[Source]>>
	>;
};

/** Merge path-level inputs with operation-level inputs. */
export type MergeEndpointInputs<
	Shared extends EndpointInputSlots,
	Operation extends EndpointInputSlots,
> = Omit<Shared, keyof Operation> & Operation;

/** Static cross-cutting values contributed by a group, path, or operation. */
export interface EndpointContributions {
	/** Declared middleware contributions or their compiled placement plan. */
	readonly middleware?: MiddlewareInput;
	/** Authentication contracts required by the selected operation; the host supplies their evaluator. */
	readonly authentication?: DefinitionInput<CatalogEntryIdentity>;
	/** Active requirement declarations; declaring them does not itself authorize work. */
	readonly requirements?: RequirementInput;
	/** Required one-way consequences that code in this endpoint scope may announce. */
	readonly effects?: EffectDefinitions;
	/** Resource contracts reachable through this declaration; the live host owns acquisition. */
	readonly resources?: DefinitionInput<EndpointResourceDefinition>;
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems?: DefinitionInput<ProblemDefinition>;
	/** Declared successful response contracts or their projected IDs. */
	readonly responses?: DefinitionInput<ResponseDefinition>;
	/** Declared resilience policies; each policy retains a designated runtime owner. */
	readonly resiliency?: ResilienceInput;
}

/** Common human-facing metadata for endpoint definitions. */
export interface EndpointDocumentation {
	/** Stable operation identity used by generated clients, routing and diagnostics. */
	readonly operationId?: string;
	/** Short explanation shown beside this operation or example in generated references. */
	readonly summary?: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
	/** Documentation groups assigned to this operation. */
	readonly tags?: readonly string[];
	/** Whether generated API references should mark this operation deprecated. */
	readonly deprecated?: boolean;
	/** Whether this contract is intended for internal exposure rather than a public projection. */
	readonly internal?: boolean;
}

/** Input accepted by a method-operation definition. */
export type EndpointOperationInput =
	& Readonly<{
		readonly id: string;
		readonly method?: EndpointMethod;
		readonly rawResponse?: boolean;
	}>
	& EndpointDocumentation
	& EndpointInputSlots
	& EndpointContributions;

/** Pick only explicitly authored request-location fields from a flat endpoint input. */
type ExplicitEndpointInputSlots<Input> = {
	readonly [
		Source in EndpointInputSource as Input extends Readonly<Record<Source, infer Slot>>
			? Exclude<Slot, undefined> extends EndpointInputSlot ? Source : never
			: never
	]: Input extends Readonly<Record<Source, infer Slot>> ? Exclude<Slot, undefined> : never;
};

/** Preserve exact authored schemas while retaining a broad shape for heterogeneous operations. */
export type PickEndpointInputSlots<Input> = Input extends EndpointOperationInput
	? EndpointOperationInput extends Input ? EndpointInputSlots : ExplicitEndpointInputSlots<Input>
	: ExplicitEndpointInputSlots<Input>;

/** Immutable path-independent method contract. */
export interface EndpointOperation<
	Method extends EndpointMethod = EndpointMethod,
	Inputs extends EndpointInputSlots = EndpointInputSlots,
	Responses extends ResponseDefinition = ResponseDefinition,
	Problems extends ProblemDefinition = ProblemDefinition,
	Resources extends EndpointResourceDefinition = EndpointResourceDefinition,
> extends
	CatalogEntryIdentity,
	EndpointDocumentation,
	Omit<EndpointContributions, 'responses' | 'problems' | 'resources'> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'endpoint-operation';
	/** HTTP method selected for this operation or route. */
	readonly method: Method;
	/** Stable operation identity used by generated clients, routing and diagnostics. */
	readonly operationId: string;
	/** Declared request input slots or their compiled validation steps. */
	readonly inputs: Inputs;
	/** Declared successful response contracts or their projected IDs. */
	readonly responses?: DefinitionInput<Responses>;
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems?: DefinitionInput<Problems>;
	/** Resource contracts reachable through this declaration; the live host owns acquisition. */
	readonly resources?: DefinitionInput<Resources>;
	/** Whether this operation deliberately permits a native Response instead of a declared response tuple. */
	readonly rawResponse: boolean;
}

/** Response definitions represented by one operation authoring input. */
export type EndpointOperationResponses<Input extends EndpointOperationInput> = Extract<
	DefinitionEntry<NonNullable<Input['responses']>>,
	ResponseDefinition
>;

/** Problem definitions represented by one operation authoring input. */
export type EndpointOperationProblems<Input extends EndpointOperationInput> = Extract<
	DefinitionEntry<NonNullable<Input['problems']>>,
	ProblemDefinition
>;

/** Resource definitions represented by one operation authoring input. */
export type EndpointOperationResources<Input extends EndpointOperationInput> = Extract<
	DefinitionEntry<NonNullable<Input['resources']>>,
	EndpointResourceDefinition
>;

/** Fully inferred operation type produced from one authoring input. */
export type DefinedEndpointOperation<
	Method extends EndpointMethod,
	Input extends EndpointOperationInput,
> = EndpointOperation<
	Method,
	PickEndpointInputSlots<Input>,
	EndpointOperationResponses<Input>,
	EndpointOperationProblems<Input>,
	EndpointOperationResources<Input>
>;

/** Input accepted by a multi-method endpoint path. */
export type EndpointDefinitionInput<
	Path extends string = string,
	Operations extends readonly EndpointOperation[] = readonly EndpointOperation[],
> =
	& Readonly<{
		readonly id: string;
		readonly path: Path;
		readonly operations: Operations;
	}>
	& Omit<EndpointDocumentation, 'operationId'>
	& EndpointInputSlots
	& Omit<EndpointContributions, 'responses'>;

/** Immutable path contract containing one or more method operations. */
export interface EndpointDefinition<
	Path extends string = string,
	SharedInput extends EndpointInputSlots = EndpointInputSlots,
	Operations extends readonly EndpointOperation[] = readonly EndpointOperation[],
	Resources extends EndpointResourceDefinition = EndpointResourceDefinition,
	Problems extends ProblemDefinition = ProblemDefinition,
> extends
	CatalogEntryIdentity,
	Omit<EndpointDocumentation, 'operationId'>,
	Omit<EndpointContributions, 'responses' | 'resources' | 'problems'> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'endpoint';
	/** Declared route pathname or prefix; path parameters retain the endpoint grammar. */
	readonly path: Path;
	/** Declared request input slots or their compiled validation steps. */
	readonly inputs: SharedInput;
	/** Method operations retained in this endpoint path. */
	readonly operations: Operations;
	/** Resource contracts reachable through this declaration; the live host owns acquisition. */
	readonly resources?: DefinitionInput<Resources>;
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems?: DefinitionInput<Problems>;
}

/** Resource definitions represented by one endpoint path authoring input. */
export type EndpointDefinitionResources<Input extends EndpointContributions> = Extract<
	DefinitionEntry<NonNullable<Input['resources']>>,
	EndpointResourceDefinition
>;

/** Problem definitions represented by one endpoint path authoring input. */
export type EndpointDefinitionProblems<Input extends EndpointContributions> = Extract<
	DefinitionEntry<NonNullable<Input['problems']>>,
	ProblemDefinition
>;

/** Complete single-method endpoint authoring input. */
export type SingleMethodEndpointInput<
	Path extends string = string,
> =
	& Readonly<{ readonly id: string; readonly path: Path; readonly rawResponse?: boolean }>
	& EndpointDocumentation
	& EndpointInputSlots
	& EndpointContributions;

/** One concrete endpoint, group, or group selection accepted by composition. */
export type EndpointEntry = EndpointDefinition | EndpointGroup | EndpointGroupSelection;

/** Recursive endpoint composition input accepted by groups, services, and gateways. */
export type EndpointCompositionInput = EndpointEntry | readonly EndpointCompositionInput[];

/** Named or direct endpoint-group members. */
export type EndpointGroupMembers =
	| Readonly<Record<string, EndpointEntry>>
	| EndpointCompositionInput;

/** Input accepted by an endpoint group. */
export type EndpointGroupInput<
	Path extends string = string,
	Members extends EndpointGroupMembers = EndpointGroupMembers,
> =
	& Readonly<{
		readonly id: string;
		readonly path: Path;
		readonly endpoints: Members;
	}>
	& Omit<EndpointDocumentation, 'operationId'>
	& Omit<EndpointContributions, 'responses'>;

/** Static endpoint group with a shared path prefix and contributions. */
export interface EndpointGroup<
	Path extends string = string,
	Entries extends Readonly<Record<string, EndpointEntry>> | undefined =
		| Readonly<Record<string, EndpointEntry>>
		| undefined,
> extends CatalogEntryIdentity, Omit<EndpointDocumentation, 'operationId'>, Omit<EndpointContributions, 'responses'> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'endpoint-group';
	/** Declared route pathname or prefix; path parameters retain the endpoint grammar. */
	readonly path: Path;
	/** Exact endpoint composition or selected bindings retained by this contract. */
	readonly endpoints: readonly EndpointEntry[];
	/** Named exact entries retained by this group. */
	readonly entries?: Entries;
}

/** Key-preserving immutable selection from a named endpoint group. */
export interface EndpointGroupSelection<
	Group extends EndpointGroup = EndpointGroup,
	Entries extends Readonly<Record<string, EndpointEntry>> = Readonly<Record<string, EndpointEntry>>,
> extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'endpoint-group-selection';
	/** Original declaration from which this selection was made. */
	readonly source: Group;
	/** Authored entry names retained by this selection. */
	readonly keys: readonly (keyof Entries & string)[];
	/** Exact endpoint composition or selected bindings retained by this contract. */
	readonly endpoints: readonly EndpointEntry[];
}

/** One deterministic endpoint validation issue. */
export interface EndpointValidationIssue {
	/** Stable failure code; callers should branch on this instead of matching explanation text. */
	readonly code:
		| 'invalid-id'
		| 'invalid-path'
		| 'missing-operation'
		| 'missing-result'
		| 'duplicate-method'
		| 'duplicate-id'
		| 'duplicate-operation-id'
		| 'body-method-conflict'
		| 'raw-body-conflict'
		| 'missing-path-schema'
		| 'ambiguous-route';
	/** Human-readable diagnostic explanation; it is not a stable program discriminator. */
	readonly message: string;
	/** Exact endpoint declaration associated with this validation issue, when available. */
	readonly definition?: EndpointEntry | EndpointOperation;
}

/** Deterministic endpoint validation result. */
export type EndpointValidationResult =
	| Readonly<{ readonly valid: true; readonly endpoints: readonly EndpointDefinition[] }>
	| Readonly<{ readonly valid: false; readonly issues: readonly EndpointValidationIssue[] }>;

/** JSON-safe operation projection. */
export interface EndpointOperationDocument {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** HTTP method selected for this operation or route. */
	readonly method: EndpointMethod;
	/** Stable operation identity used by generated clients, routing and diagnostics. */
	readonly operationId: string;
	/** Short explanation shown beside this operation or example in generated references. */
	readonly summary?: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
	/** Documentation groups assigned to this operation. */
	readonly tags: readonly string[];
	/** Whether generated API references should mark this operation deprecated. */
	readonly deprecated: boolean;
	/** Whether this contract is intended for internal exposure rather than a public projection. */
	readonly internal: boolean;
	/** Declared request input slots or their compiled validation steps. */
	readonly inputs: readonly EndpointInputSource[];
	/** Declared successful response contracts or their projected IDs. */
	readonly responses: readonly string[];
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems: readonly string[];
	/** Resource contracts reachable through this declaration; the live host owns acquisition. */
	readonly resources: readonly string[];
	/** Effect IDs declared by the effective endpoint path and operation. */
	readonly effects: readonly string[];
}

/** JSON-safe endpoint projection with fully composed path. */
export interface EndpointDocument {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Declared route pathname or prefix; path parameters retain the endpoint grammar. */
	readonly path: string;
	/** Enclosing endpoint group identities retained in the projected path. */
	readonly groupIds: readonly string[];
	/** Method operations retained in this endpoint path. */
	readonly operations: readonly EndpointOperationDocument[];
}

/** Resource definition union retained by an operation. */
export type OperationResource<Operation extends EndpointOperation> = Operation extends
	EndpointOperation<EndpointMethod, EndpointInputSlots, ResponseDefinition, ProblemDefinition, infer Resource>
	? Resource
	: never;

/** Resource definition union retained by an endpoint path. */
export type PathResource<Endpoint extends EndpointDefinition> = Endpoint extends
	EndpointDefinition<string, EndpointInputSlots, readonly EndpointOperation[], infer Resource, ProblemDefinition>
	? Resource
	: never;

/** Effective resource definitions available to an endpoint handler. */
export type EndpointResources<
	Endpoint extends EndpointDefinition,
	Operation extends EndpointOperation,
> = PathResource<Endpoint> | OperationResource<Operation>;

/** Resolver constrained to resources declared by the effective operation. */
export interface EndpointResourceResolver<Allowed extends EndpointResourceDefinition = EndpointResourceDefinition> {
	/** Test whether the exact declared resource is available in this resolver. */
	has<Definition extends Allowed>(definition: Definition): boolean;
	/** Borrow an allowed resource from its live owner; acquisition failures reject the returned promise. */
	get<Definition extends Allowed>(definition: Definition): Promise<EndpointResourceValue<Definition>>;
}

/** Request execution context propagated by the owning host. */
export type EndpointContext = EffectContext<Context>;

/**
 * Empty base contract for application-owned values added during request execution.
 *
 * Applications extend this type with exact provider-neutral values such as a
 * session, principal, membership, tenant, or authorization snapshot. The
 * endpoint package does not reserve domain field names.
 */
export type EndpointRequestValues = Readonly<Record<never, never>>;

/** Empty host value used when an endpoint handler does not require host state. */
export type EmptyEndpointHost = Readonly<Record<never, never>>;

/**
 * Portable handler context specialized by a service runtime adapter.
 *
 * Request values are intersected with the fixed HTTP context instead of being
 * reduced to a hard-coded field list. A domain package can therefore add
 * provider-neutral values such as `session`, `identity`, or `membership` and
 * keep those exact types from authentication through the endpoint handler.
 */
export type EndpointHandlerContext<
	Endpoint extends EndpointDefinition = EndpointDefinition,
	Operation extends EndpointOperation = EndpointOperation,
	Host extends object = EmptyEndpointHost,
	Values extends EndpointRequestValues = EndpointRequestValues,
> = Readonly<
	{
		readonly request: Request;
		readonly host: Host;
		readonly input: InferEndpointInputs<MergeEndpointInputs<Endpoint['inputs'], Operation['inputs']>>;
		readonly resources: EndpointResourceResolver<EndpointResources<Endpoint, Operation>>;
		readonly ctx: EndpointContext;
	} & Values
>;

/** Response definition union retained by an operation. */
export type OperationResponse<Operation extends EndpointOperation> = Operation extends EndpointOperation<
	EndpointMethod,
	EndpointInputSlots,
	infer ResponseDefinition_,
	ProblemDefinition,
	EndpointResourceDefinition
> ? ResponseDefinition_
	: never;

/** Problem definition union retained by an operation. */
export type OperationProblem<Operation extends EndpointOperation> = Operation extends EndpointOperation<
	EndpointMethod,
	EndpointInputSlots,
	ResponseDefinition,
	infer ProblemDefinition_,
	EndpointResourceDefinition
> ? ProblemDefinition_
	: never;

/** Declared result union for one endpoint operation. */
export type EndpointHandlerResult<Operation extends EndpointOperation> =
	| ResponseResult<OperationResponse<Operation>>
	| ProblemResult<OperationProblem<Operation>>
	| (Operation['rawResponse'] extends true ? Response : never);

/** Handler function for one exact endpoint operation. */
export type EndpointHandler<
	Endpoint extends EndpointDefinition,
	Operation extends EndpointOperation,
	Host extends object = EmptyEndpointHost,
	Values extends EndpointRequestValues = EndpointRequestValues,
> = (
	context: EndpointHandlerContext<Endpoint, Operation, Host, Values>,
) => EndpointHandlerResult<Operation> | Promise<EndpointHandlerResult<Operation>>;

/** Direct binding between imported endpoint/operation values and behavior. */
export interface EndpointHandlerBinding<
	Endpoint extends EndpointDefinition = EndpointDefinition,
	Operation extends EndpointOperation = EndpointOperation,
	Host extends object = EmptyEndpointHost,
	Values extends EndpointRequestValues = EndpointRequestValues,
> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'endpoint-handler';
	/** Exact endpoint path contract to which this binding belongs. */
	readonly endpoint: Endpoint;
	/** Exact method-operation contract selected within the endpoint. */
	readonly operation: Operation;
	/** Runtime behavior bound to the exact declaration; the host supplies its request lifetime. */
	readonly handle: EndpointHandler<Endpoint, Operation, Host, Values>;
}

/** Values retained after request-location parsing but before handler specialization. */
export type EndpointRuntimeInputValues = Readonly<
	Partial<
		Record<
			EndpointInputSource,
			unknown
		>
	>
>;

/** Runtime context shape shared by heterogeneous compiled handler collections. */
export interface ErasedEndpointHandlerContext {
	/** Web Request borrowed for this operation; body ownership follows the enclosing transport contract. */
	readonly request: Request;
	/** Application-owned host values supplied by the composition root. */
	readonly host: object;
	/** Validated request values retained in the heterogeneous handler binding view. */
	readonly input: EndpointRuntimeInputValues;
	/** Borrowed resolver for the selected operation resources; the host owns their cleanup. */
	readonly resources: EndpointResourceResolver;
	/** Execution context borrowed from the request lifetime owner for cancellation, timing and effects. */
	readonly ctx: EndpointContext;
}

/**
 * Callable shape used to retain differently specialized endpoint handlers in one
 * compiled collection.
 *
 * The method-signature extraction intentionally makes the parameter bivariant.
 * Each handler remains exact at `handler()` authoring sites, while heterogeneous
 * service composition can retain those handlers without replacing their known
 * context with `any`, `unknown`, or a `never` cast. The service compiler still
 * invokes a binding only for its exact endpoint and operation identities.
 */
export type AnyEndpointHandler = {
	bivarianceHack(
		context: ErasedEndpointHandlerContext,
	): EndpointHandlerResult<EndpointOperation> | Promise<EndpointHandlerResult<EndpointOperation>>;
}['bivarianceHack'];

/** Runtime-erased endpoint binding used by heterogeneous composition utilities. */
export interface AnyEndpointHandlerBinding {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'endpoint-handler';
	/** Exact endpoint path contract to which this binding belongs. */
	readonly endpoint: EndpointDefinition;
	/** Exact method-operation contract selected within the endpoint. */
	readonly operation: EndpointOperation;
	/** Runtime behavior bound to the exact declaration; the host supplies its request lifetime. */
	readonly handle: AnyEndpointHandler;
}

/** Complete handler set for a multi-method endpoint. */
export interface EndpointHandlerSet<
	Endpoint extends EndpointDefinition = EndpointDefinition,
	Bindings extends readonly AnyEndpointHandlerBinding[] = readonly AnyEndpointHandlerBinding[],
> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'endpoint-handlers';
	/** Exact endpoint path contract to which this binding belongs. */
	readonly endpoint: Endpoint;
	/** Runtime handlers bound to the exact operations of this endpoint. */
	readonly bindings: Bindings;
}
