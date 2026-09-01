import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	Catalog,
	CatalogEntryIdentity,
	CatalogSelection,
	DefinitionInput as CatalogDefinitionInput,
} from '@okikio/catalog';
import type { Context as BaseContext } from '@okikio/context';
import type { RequirementDefinition } from '@okikio/requirement';

/** Standard Schema contract used to validate one optional permission target. */
export type PermissionSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

/** Options accepted by `permissions.define()`. */
export interface PermissionOptions<
	Id extends string = string,
	TargetSchema extends PermissionSchema | undefined = undefined,
> {
	/** Stable permission identity used by policy providers and documentation. */
	readonly id: Id;
	/** Human-readable purpose of the authority check. */
	readonly description?: string;
	/**
	 * Optional schema for a concrete runtime target.
	 *
	 * Omit the schema when the policy provider can derive the subject from the
	 * current validated operation state. Add it when work can discover a target
	 * after admission, such as a URL, asset, project, or external object.
	 */
	readonly target?: TargetSchema;
}

/** Immutable import-safe permission contract. */
export interface PermissionDefinition<
	Id extends string = string,
	TargetSchema extends PermissionSchema | undefined = PermissionSchema | undefined,
> extends CatalogEntryIdentity {
	/** Stable discriminant used by requirement composition and runtime declaration checks. */
	readonly kind: 'permission';
	/** Stable policy identity understood by the configured authorization provider. */
	readonly id: Id;
	/** Human-readable authority meaning used by documentation and diagnostics. */
	readonly description?: string;
	/** Optional schema for a concrete target discovered after initial admission. */
	readonly target?: TargetSchema;
}

/** Input accepted for one permission definition's concrete runtime target. */
export type PermissionTargetInput<Permission extends PermissionDefinition> =
	Permission extends PermissionDefinition<string, infer TargetSchema>
		? TargetSchema extends PermissionSchema ? StandardSchemaV1.InferInput<TargetSchema> : undefined
		: never;

/** Validated target supplied to a permission provider. */
export type PermissionTarget<Permission extends PermissionDefinition> =
	Permission extends PermissionDefinition<string, infer TargetSchema>
		? TargetSchema extends PermissionSchema ? StandardSchemaV1.InferOutput<TargetSchema> : undefined
		: never;

/** Target argument required by `permissions.on()`, `check()`, and `assert()`. */
export type PermissionTargetArguments<Permission extends PermissionDefinition> =
	Permission extends PermissionDefinition<string, infer TargetSchema>
		? TargetSchema extends PermissionSchema
			? readonly [target: StandardSchemaV1.InferInput<TargetSchema>]
			: readonly []
		: readonly [];

/** Requirement contribution that declares one permission as reachable. */
export type PermissionRequirement = RequirementDefinition<'permission', 'require', PermissionDefinition>;

/** One atomic runtime permission check before target validation. */
export interface PermissionCheck<Permission extends PermissionDefinition = PermissionDefinition> {
	/** Stable discriminant for one atomic authorization question. */
	readonly kind: 'permission-check';
	/** Exact permission definition that the current execution declared as reachable. */
	readonly definition: Permission;
	/** Raw target input validated before the policy provider receives the request. */
	readonly target: PermissionTargetInput<Permission>;
}

/** Runtime expression that requires every child expression to allow. */
export interface PermissionAll {
	/** Stable discriminant for conjunction semantics. */
	readonly kind: 'permission-all';
	/** Independent child authorization questions. Evaluation order is not observable. */
	readonly checks: readonly PermissionExpression[];
}

/** Runtime expression that requires at least one child expression to allow. */
export interface PermissionAny {
	/** Stable discriminant for alternative authorization semantics. */
	readonly kind: 'permission-any';
	/** Independent child authorization questions. Any explicit allow can satisfy the expression. */
	readonly checks: readonly PermissionExpression[];
}

/** Runtime expression accepted by `permissions.check()` and `assert()`. */
export type PermissionExpression = PermissionCheck | PermissionAll | PermissionAny;

/** Targetless definition that can act as one runtime expression without `on()`. */
export type TargetlessPermission = PermissionDefinition<string, undefined>;

/** Author input accepted by expression composition and `permissions.batch()`. */
export type PermissionExpressionInput = PermissionExpression | TargetlessPermission;

/** One validated atomic request sent to the configured policy provider. */
export interface PermissionRequest<Permission extends PermissionDefinition = PermissionDefinition> {
	/** Exact permission definition whose policy must be evaluated. */
	readonly definition: Permission;
	/** Validated target value, or `undefined` for state-derived permissions. */
	readonly target: PermissionTarget<Permission>;
}

/** One atomic result returned by a permission provider. */
export type PermissionDecision =
	| Readonly<{ readonly allowed: true; readonly reason?: string }>
	| Readonly<{ readonly allowed: false; readonly reason?: string }>
	| Readonly<{ readonly error: unknown }>;

/**
 * Provider-neutral evaluator for one logical permission batch.
 *
 * `maximumChecks` bounds the number of atomic checks in one logical call. A
 * remote adapter can split that logical batch into smaller wire requests while
 * preserving one provider revision or consistency view.
 */
export interface PermissionChecker {
	/** Maximum atomic requests accepted in one logical evaluation batch. */
	readonly maximumChecks: number;
	/** Evaluate one logical batch without changing application state as a side effect of the decision. */
	check(ctx: BaseContext, requests: readonly PermissionRequest[]): Promise<readonly PermissionDecision[]>;
}

/** Permission state attached to one local execution context. */
export interface PermissionRuntime {
	/** Provider-neutral evaluator used for runtime authorization decisions in this context. */
	readonly checker?: PermissionChecker;
	/** Exact definitions that the active definition graph declared as reachable. */
	readonly permissions: readonly PermissionDefinition[];
}

/** Execution-context view with permission checks available. */
export type PermissionContext<Base extends BaseContext = BaseContext> =
	Base & Readonly<{ readonly permissions: PermissionRuntime }>;

/** Options accepted by `permissions.scope()`. */
export interface PermissionScopeOptions {
	/** Provider-neutral evaluator. Omit only when runtime checks must fail as unconfigured. */
	readonly checker?: PermissionChecker;
	/** Exact permissions that code in this scope can legitimately check. */
	readonly permissions: CatalogDefinitionInput<PermissionDefinition>;
}

/** Named permission catalog. */
export type PermissionCatalog<Entries extends Readonly<Record<PropertyKey, PermissionDefinition>>> = Catalog<
	Entries[keyof Entries],
	Entries
>;

/** Key-preserving permission catalog selection. */
export type PermissionSelection<
	Entry extends PermissionDefinition,
	Entries extends Readonly<Record<PropertyKey, Entry>>,
> = CatalogSelection<Entry, Entries>;

/** Recursive input accepted where permission definitions are declared. */
export type PermissionDefinitions = CatalogDefinitionInput<PermissionDefinition>;
