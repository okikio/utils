import type { Catalog, CatalogEntryIdentity, CatalogSelection, DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import type { RequirementDefinition } from '@okikio/requirement';

/** EntitlementDefinitions accepted by `define()`. */
export interface EntitlementOptions {
	/** Stable entitlement identity used for correlation, lookup, or durable records. */
	readonly id: string;
	/** Human-readable entitlement purpose used by documentation and diagnostics. */
	readonly description?: string;
}

/** Immutable entitlement definition. */
export interface EntitlementDefinition extends CatalogEntryIdentity {
	/** Stable discriminant for this entitlement value. */
	readonly kind: 'entitlement';
}

/** Entitlement requirement contributed to another definition. */
export type EntitlementRequirement = RequirementDefinition<'entitlement', 'require', EntitlementDefinition>;

/** Named entitlement catalog. */
export type EntitlementCatalog<Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>> = Catalog<Entries[keyof Entries], Entries>;

/** Key-preserving entitlement catalog selection. */
export type EntitlementSelection<Entry extends EntitlementDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>> = CatalogSelection<Entry, Entries>;

/** Recursive entitlement definition input. */
export type EntitlementDefinitions = CatalogDefinitionInput<EntitlementDefinition>;
