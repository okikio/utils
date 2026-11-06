import type {
	Catalog,
	CatalogEntryIdentity,
	CatalogIds,
	CatalogSelection,
	DefinitionInput as CatalogDefinitionInput,
} from '@okikio/collection/catalog';
import type { RequirementCatalog, RequirementDefinition } from '@okikio/capability/requirement';
import type { Context } from '@okikio/context';

/** Compile-time brand carried only by definitions created through `entitlement.define()`. */
declare const entitlementDefinitionBrand: unique symbol;

/** Options accepted by `entitlement.define()`. */
export interface EntitlementOptions<Id extends string = string> {
	/** Stable entitlement identity used for correlation, lookup, or durable records. */
	readonly id: Id;
	/** Human-readable entitlement purpose used by documentation and diagnostics. */
	readonly description?: string;
}

/** Immutable entitlement definition. */
export interface EntitlementDefinition<Id extends string = string> extends CatalogEntryIdentity {
	/** Prevent structurally similar records from becoming entitlement definitions without validation. */
	readonly [entitlementDefinitionBrand]: true;
	/** Stable discriminant for this entitlement value. */
	readonly kind: 'entitlement';
	/** Stable entitlement identity retained as a literal type. */
	readonly id: Id;
}

/** One provider-neutral entitlement decision returned by a runtime checker. */
export type EntitlementDecision = import('../decisions.ts').Decision;

/** Runtime policy that evaluates one logical batch of required entitlements. */
export interface EntitlementChecker {
	/** Maximum definitions accepted in one logical admission batch. */
	readonly maximumChecks?: number;
	/** Evaluate each entitlement in authored order for the current execution context. */
	check(ctx: Context, definitions: readonly EntitlementDefinition[]): Promise<readonly EntitlementDecision[]>;
}

/** Entitlement requirement contributed to another definition. */
export type EntitlementRequirement<Definition extends EntitlementDefinition = EntitlementDefinition> =
	RequirementDefinition<'entitlement', 'require', Definition>;

/** Named entitlement catalog. */
export type EntitlementCatalog<Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>> = Catalog<
	Entries[keyof Entries],
	Entries
>;

/** Key-preserving entitlement identifiers projected from a canonical catalog. */
export type EntitlementIds<Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>> = CatalogIds<Entries>;

/** Named requirement catalog derived from one canonical entitlement catalog. */
export type EntitlementRequirementCatalog<Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>> =
	RequirementCatalog<'entitlement', 'require', Entries>;

/** Key-preserving entitlement catalog selection. */
export type EntitlementSelection<
	Entry extends EntitlementDefinition,
	Entries extends Readonly<Record<PropertyKey, Entry>>,
> = CatalogSelection<Entry, Entries>;

/** Recursive entitlement definition input. */
export type EntitlementDefinitions = CatalogDefinitionInput<EntitlementDefinition>;
