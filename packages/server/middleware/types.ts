import type {
	CatalogEntryIdentity,
	CatalogEntryValue,
	DefinitionEntry,
	DefinitionInput,
	ValuedCatalogEntry,
} from '@okikio/catalog';
import type { Context } from '@okikio/context';
import type { EffectContext, EffectDefinitions } from '@okikio/effect';
import type { ProblemDefinition } from '@okikio/http/problem';
import type { ResilienceInput } from '@okikio/resilience';
import type { RequirementDocument, RequirementInput } from '@okikio/requirement';

/** Static resource reference accepted by portable middleware contracts. */
export type MiddlewareResourceDefinition<Value = unknown> = ValuedCatalogEntry<'resource', Value>;

/** Runtime value represented by one middleware resource reference. */
export type MiddlewareResourceValue<Definition extends MiddlewareResourceDefinition> = CatalogEntryValue<Definition>;

const middlewareContextValue: unique symbol = Symbol('utils.server.middleware.context-value');

/** Typed request-context value that middleware may require or provide. */
export interface MiddlewareContextDefinition<Value = unknown> extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'middleware-context';
	/** Compile-time context value inference slot; it is not an initialized runtime value. */
	readonly [middlewareContextValue]: Value;
}

/** Input accepted by {@link context}. */
export interface MiddlewareContextDefinitionInput {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
}

/** Value represented by one middleware context definition. */
export type MiddlewareContextValue<Definition extends MiddlewareContextDefinition> = Definition extends
	MiddlewareContextDefinition<infer Value> ? Value : never;

/** Static import-safe middleware contract. */
export interface MiddlewareDefinition<
	Requires extends readonly MiddlewareContextDefinition[] = readonly MiddlewareContextDefinition[],
	Provides extends readonly MiddlewareContextDefinition[] = readonly MiddlewareContextDefinition[],
	Resources extends MiddlewareResourceDefinition = MiddlewareResourceDefinition,
	Problems extends ProblemDefinition = ProblemDefinition,
> extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'middleware';
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Context definitions, or their IDs in documents, needed before this middleware runs. */
	readonly requires: Requires;
	/** Context definitions, or their IDs in documents, that this middleware makes available. */
	readonly provides: Provides;
	/** Resource contracts reachable through this declaration; the live host owns acquisition. */
	readonly resources?: DefinitionInput<Resources>;
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems?: DefinitionInput<Problems>;
	/** Active requirement declarations; declaring them does not itself authorize work. */
	readonly requirements?: RequirementInput;
	/** Required one-way consequences this middleware may announce when it runs. */
	readonly effects?: EffectDefinitions;
	/** Authentication contracts required by the selected operation; the host supplies their evaluator. */
	readonly authentication?: DefinitionInput<CatalogEntryIdentity>;
	/** Declared resilience policies; each policy retains a designated runtime owner. */
	readonly resiliency?: ResilienceInput;
	/** Author-supplied reference URL and notes retained alongside this middleware. */
	readonly documentation?: Readonly<{ readonly url?: string; readonly notes?: string }>;
}

/** Input accepted by {@link define}. */
export interface MiddlewareDefinitionInput<
	Requires extends readonly MiddlewareContextDefinition[] = readonly MiddlewareContextDefinition[],
	Provides extends readonly MiddlewareContextDefinition[] = readonly MiddlewareContextDefinition[],
> {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Context definitions, or their IDs in documents, needed before this middleware runs. */
	readonly requires?: Requires;
	/** Context definitions, or their IDs in documents, that this middleware makes available. */
	readonly provides?: Provides;
	/** Resource contracts reachable through this declaration; the live host owns acquisition. */
	readonly resources?: DefinitionInput<MiddlewareResourceDefinition>;
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems?: DefinitionInput<ProblemDefinition>;
	/** Active requirement declarations; declaring them does not itself authorize work. */
	readonly requirements?: RequirementInput;
	/** Required one-way consequences this middleware may announce when it runs. */
	readonly effects?: EffectDefinitions;
	/** Authentication contracts required by the selected operation; the host supplies their evaluator. */
	readonly authentication?: DefinitionInput<CatalogEntryIdentity>;
	/** Declared resilience policies; each policy retains a designated runtime owner. */
	readonly resiliency?: ResilienceInput;
	/** Author-supplied reference URL and notes retained alongside this middleware. */
	readonly documentation?: Readonly<{ readonly url?: string; readonly notes?: string }>;
}

/** Required contexts represented by one middleware authoring input. */
export type MiddlewareRequires<Input extends MiddlewareDefinitionInput> = Input extends
	{ readonly requires: infer Requires extends readonly MiddlewareContextDefinition[] } ? Requires
	: readonly [];

/** Provided contexts represented by one middleware authoring input. */
export type MiddlewareProvides<Input extends MiddlewareDefinitionInput> = Input extends
	{ readonly provides: infer Provides extends readonly MiddlewareContextDefinition[] } ? Provides
	: readonly [];

/** Resource definitions represented by one middleware input. */
export type MiddlewareResources<Input extends MiddlewareDefinitionInput> = Extract<
	DefinitionEntry<NonNullable<Input['resources']>>,
	MiddlewareResourceDefinition
>;

/** Problem definitions represented by one middleware input. */
export type MiddlewareProblems<Input extends MiddlewareDefinitionInput> = Extract<
	DefinitionEntry<NonNullable<Input['problems']>>,
	ProblemDefinition
>;

/** Typed context store visible to one middleware handler. */
export interface MiddlewareContextStore<Allowed extends MiddlewareContextDefinition = MiddlewareContextDefinition> {
	/** Test whether this exact context definition has a stored request value. */
	has<Definition extends Allowed>(definition: Definition): boolean;
	/** Get the value stored under this exact allowed context definition; missing values throw. */
	get<Definition extends Allowed>(definition: Definition): MiddlewareContextValue<Definition>;
	/** Store a value under the exact context definition so later declared middleware can retrieve it. */
	set<Definition extends Allowed>(definition: Definition, value: MiddlewareContextValue<Definition>): void;
}

/** Resource resolver constrained to the middleware declaration envelope. */
export interface MiddlewareResourceResolver<
	Allowed extends MiddlewareResourceDefinition = MiddlewareResourceDefinition,
> {
	/** Test whether the exact declared resource is available in this resolver. */
	has<Definition extends Allowed>(definition: Definition): boolean;
	/** Borrow an allowed resource from its live owner; acquisition failures reject the returned promise. */
	get<Definition extends Allowed>(definition: Definition): Promise<MiddlewareResourceValue<Definition>>;
}

/** Runtime context supplied to a middleware handler by the server adapter. */
export interface MiddlewareHandlerContext<
	Definition extends MiddlewareDefinition = MiddlewareDefinition,
	Host = unknown,
> {
	/** Web Request borrowed for this operation; body ownership follows the enclosing transport contract. */
	readonly request: Request;
	/** Application-owned host values supplied by the composition root. */
	readonly host: Host;
	/** Request-local values addressable only by this middleware required and provided context definitions. */
	readonly values: MiddlewareContextStore<Definition['requires'][number] | Definition['provides'][number]>;
	/** Borrowed resource resolver constrained to this middleware declaration; the host owns cleanup. */
	readonly resources: MiddlewareResourceResolver<
		Extract<
			DefinitionEntry<NonNullable<Definition['resources']>>,
			MiddlewareResourceDefinition
		>
	>;
	/** Execution context borrowed from the request lifetime owner for cancellation, timing and effects. */
	readonly ctx: EffectContext<Context>;
}

/** Onion-style continuation used by middleware handlers. */
export type MiddlewareNext<Result = unknown> = () => Promise<Result>;

/** Stable key for middleware work that must execute at most once per request. */
export type MiddlewareOnceKey = string | symbol | object;

/** Runtime behavior bound to one exact middleware definition. */
export interface MiddlewareHandler<
	Definition extends MiddlewareDefinition = MiddlewareDefinition,
	Host = unknown,
	Result = unknown,
> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'middleware-handler';
	/** Exact declaration involved in this binding, result or validation issue. */
	readonly definition: Definition;
	/** Run under the declared request context and optionally await next() to surround downstream work. */
	readonly handle: (
		context: MiddlewareHandlerContext<Definition, Host>,
		next: MiddlewareNext<Result>,
	) => Result | Promise<Result>;
}

/** Supported compiler placement lanes. */
export type MiddlewareLane = 'wholeRequest' | 'beforeValidation' | 'afterValidation' | 'aroundOperation';

/** Use-site placement wrapper around one middleware definition. */
export interface MiddlewareUse<
	Definition extends MiddlewareDefinition = MiddlewareDefinition,
	Lane extends MiddlewareLane = MiddlewareLane,
> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'middleware-use';
	/** Exact declaration involved in this binding, result or validation issue. */
	readonly definition: Definition;
	/** Compiler placement lane selected for this middleware use. */
	readonly lane: Lane;
}

/** Direct or explicitly placed middleware value accepted by composition fields. */
export type MiddlewareInput =
	| MiddlewareDefinition
	| MiddlewareUse
	| readonly MiddlewareInput[];

/** Normalized deterministic middleware lanes. */
export interface MiddlewarePlan {
	/** Middleware that surrounds the complete request lifetime. */
	readonly wholeRequest: readonly MiddlewareDefinition[];
	/** Middleware applied before request input validation. */
	readonly beforeValidation: readonly MiddlewareDefinition[];
	/** Middleware applied after input validation succeeds. */
	readonly afterValidation: readonly MiddlewareDefinition[];
	/** Middleware that surrounds the selected endpoint operation. */
	readonly aroundOperation: readonly MiddlewareDefinition[];
}

/** One validation issue in a middleware definition or composition. */
export interface MiddlewareValidationIssue {
	/** Stable failure code; callers should branch on this instead of matching explanation text. */
	readonly code:
		| 'invalid-id'
		| 'duplicate-id'
		| 'duplicate-context-provider'
		| 'missing-required-context';
	/** Human-readable diagnostic explanation; it is not a stable program discriminator. */
	readonly message: string;
	/** Exact middleware declaration associated with this validation issue, when available. */
	readonly definition?: MiddlewareDefinition;
	/** Exact context declaration involved in the missing or duplicate provider issue. */
	readonly context?: MiddlewareContextDefinition;
}

/** Deterministic validation result for middleware composition. */
export type MiddlewareValidationResult =
	| Readonly<{ readonly valid: true; readonly plan: MiddlewarePlan }>
	| Readonly<{ readonly valid: false; readonly issues: readonly MiddlewareValidationIssue[] }>;

/** JSON-safe middleware documentation projection. */
export interface MiddlewareDocument {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Context definitions, or their IDs in documents, needed before this middleware runs. */
	readonly requires: readonly string[];
	/** Context definitions, or their IDs in documents, that this middleware makes available. */
	readonly provides: readonly string[];
	/** Resource contracts reachable through this declaration; the live host owns acquisition. */
	readonly resources: readonly string[];
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems: readonly string[];
	/** Active requirement declarations; declaring them does not itself authorize work. */
	readonly requirements: readonly RequirementDocument[];
	/** Effect IDs this middleware may announce. */
	readonly effects: readonly string[];
	/** Declared resilience policies; each policy retains a designated runtime owner. */
	readonly resiliency: readonly string[];
	/** Author-supplied reference URL and notes retained alongside this middleware. */
	readonly documentation?: Readonly<{ readonly url?: string; readonly notes?: string }>;
}
