import type {
	Catalog,
	CatalogEntryIdentity,
	CatalogIds,
	CatalogSelection,
	DefinitionInput as CatalogDefinitionInput,
} from '@okikio/collection/catalog';
import type { PermissionDefinition } from '@okikio/authz/permission';

/** Compile-time brand carried only by definitions created through `role.define()`. */
declare const roleDefinitionBrand: unique symbol;

/** Options accepted by `role.define()`. */
export interface RoleOptions<
	Id extends string = string,
	Permission extends PermissionDefinition = PermissionDefinition,
> {
	/** Stable role identity used by adapters, persisted membership, and documentation. */
	readonly id: Id;
	/** Human-readable purpose of the role. */
	readonly description?: string;
	/** Exact canonical permissions granted by this role. */
	readonly permissions?: readonly Permission[];
}

/** Immutable import-safe role contract. */
export interface RoleDefinition<
	Id extends string = string,
	Permission extends PermissionDefinition = PermissionDefinition,
> extends CatalogEntryIdentity {
	/** Prevent structurally similar records from becoming role definitions without validation. */
	readonly [roleDefinitionBrand]: true;
	/** Stable discriminant for role definitions. */
	readonly kind: 'role';
	/** Stable role identity retained as a literal type. */
	readonly id: Id;
	/** Human-readable purpose of the role. */
	readonly description?: string;
	/** Exact canonical permissions granted by this role. */
	readonly permissions: readonly Permission[];
}

/** Named role catalog. */
export type RoleCatalog<Entries extends Readonly<Record<PropertyKey, RoleDefinition>>> = Catalog<
	Entries[keyof Entries],
	Entries
>;

/** Key-preserving role catalog selection. */
export type RoleSelection<
	Entry extends RoleDefinition,
	Entries extends Readonly<Record<PropertyKey, Entry>>,
> = CatalogSelection<Entry, Entries>;

/** Key-preserving role identifiers projected from a canonical catalog. */
export type RoleIds<Entries extends Readonly<Record<PropertyKey, RoleDefinition>>> = CatalogIds<Entries>;

/** Recursive input accepted where role definitions are declared. */
export type RoleDefinitions = CatalogDefinitionInput<RoleDefinition>;
