import type { CatalogEntryIdentity, DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import type { Context as BaseContext } from '@okikio/context';

/** One immutable contract contribution attached to another definition. */
export interface RequirementDefinition<
	Family extends string = string,
	Action extends string = string,
	Entry extends CatalogEntryIdentity = CatalogEntryIdentity,
> extends CatalogEntryIdentity {
	/** Stable discriminant for this requirement value. */
	readonly kind: 'requirement';
	/** Domain that owns the semantics, such as `permission` or `entitlement`. */
	readonly family: Family;
	/** Operation interpreted by that domain, such as `require`. */
	readonly action: Action;
	/** Exact domain definition referenced by this requirement. */
	readonly definition: Entry;
}

/** Recursive input accepted by requirement-consuming definitions. */
export type RequirementInput<Entry extends RequirementDefinition = RequirementDefinition> = CatalogDefinitionInput<Entry>;

/** Options accepted by `requirements.define()`. */
export interface RequirementOptions<
	Family extends string,
	Action extends string,
	Entry extends CatalogEntryIdentity,
> {
	/** Stable interpreter family that owns runtime meaning for this requirement. */
	readonly family: Family;
	/** Family-specific operation requested by this requirement contribution. */
	readonly action: Action;
	/** Exact import-safe definition bound to this requirement. */
	readonly definition: Entry;
	/** Human-readable requirement purpose used by documentation and diagnostics. */
	readonly description?: string;
}

/** JSON-safe projection of one requirement. */
export interface RequirementDocument {
	/** Stable requirement identity derived from family, action, and exact definition ID. */
	readonly id: string;
	/** Stable requirement family safe to expose in generated documentation. */
	readonly family: string;
	/** Family-specific action safe to expose in generated documentation. */
	readonly action: string;
	/** Exact import-safe definition bound to this requirement. */
	readonly definition: string;
	/** Catalog definition kind attached to the documented requirement target. */
	readonly definitionKind: string;
	/** Human-readable requirement purpose used by documentation and diagnostics. */
	readonly description?: string;
}

/**
 * Provenance for one statically reachable requirement.
 *
 * Runtime admission does not automatically apply this value. The path exists
 * for inspection, deployment planning, security review, and documentation.
 */
export interface RequirementPathType {
	/** Exact reachable requirement found along this dependency path. */
	readonly requirement: RequirementDefinition;
	/** Temporary owner identity used while this requirement path is claimed. */
	readonly owner: CatalogEntryIdentity;
	/** Deterministic or canonical path associated with this requirement path. */
	readonly path: readonly CatalogEntryIdentity[];
}

/** Host behavior for one exact requirement family. */
export interface RequirementInterpreter<Entry extends RequirementDefinition = RequirementDefinition> {
	/** Attach family-specific runtime views from statically reachable declarations without activating them. */
	scope?(ctx: BaseContext, requirements: readonly Entry[]): BaseContext;
	/** Interpret requirements that became active on the current execution path. */
	apply(ctx: BaseContext, requirements: readonly Entry[]): Promise<void>;
}

/** Policy used when active work reaches an unconfigured requirement family. */
export type UnknownRequirementPolicyType = 'reject' | 'ignore';

/** Runtime requirement interpreters attached to one execution context. */
export interface RequirementRuntime {
	/** Configured family interpreters keyed by stable requirement family. */
	readonly interpreters: Readonly<Record<string, RequirementInterpreter | undefined>>;
	/** Explicit policy used when active work reaches an unconfigured requirement family. */
	readonly unknown: UnknownRequirementPolicyType;
}

/** Execution context view that can apply active requirements. */
export type RequirementContext<Base extends BaseContext = BaseContext> =
	Base & Readonly<{ readonly requirements: RequirementRuntime }>;

/** Options accepted by `requirements.scope()`. */
export interface RequirementScopeOptions {
	/** Family interpreters available to the newly created requirement scope. */
	readonly interpreters?: Readonly<Record<string, RequirementInterpreter | undefined>>;
	/** Unknown families reject by default. Tests must opt in when they intentionally ignore policy. */
	readonly unknown?: UnknownRequirementPolicyType;
}
