/** Stable identity required by values that participate in catalogs. */
export interface CatalogEntryIdentity {
	/** Globally unique stable identifier for the definition. */
	readonly id: string;
	/** Domain discriminator such as `problem`, `resource`, or `permission`. */
	readonly kind: string;
	/** Human-readable explanation used by generated documentation. */
	readonly description?: string;
}

/** Phantom symbol used to retain the value represented by a static definition. */
export declare const catalogEntryValue: unique symbol;

/**
 * Generic catalog entry whose static definition represents a concrete runtime value.
 *
 * The property is type-only; definition objects do not gain an enumerable runtime
 * field. Domain packages such as resources use this protocol so portable
 * contracts can retain value inference without importing a runtime adapter.
 */
export interface ValuedCatalogEntry<
	Kind extends string = string,
	Value = unknown,
> extends CatalogEntryIdentity {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: Kind;
	/** Compile-time value inference carried by this catalog entry; it is not an acquired resource. */
	readonly [catalogEntryValue]: Value;
}

/** Concrete runtime value represented by a valued catalog entry. */
export type CatalogEntryValue<Entry extends ValuedCatalogEntry> = Entry extends ValuedCatalogEntry<string, infer Value>
	? Value
	: never;

/** Metadata retained for an immutable named catalog. */
export interface CatalogMetadata<Entry extends CatalogEntryIdentity = CatalogEntryIdentity> {
	/** Protocol or representation variant selected by this value. */
	readonly type: 'catalog';
	/** Catalog namespace that groups these exact entries. */
	readonly namespace: string;
	/** Catalog keys in their stable authored order. */
	readonly keys: readonly string[];
	/** Exact entry objects in the order of the retained catalog keys. */
	readonly entries: readonly Entry[];
	/** Reverse lookup from an exact catalog entry object to its authored key. */
	readonly keyByEntry: ReadonlyMap<Entry, string>;
	/** Lookup from a stable ID to the exact registered catalog entry. */
	readonly entryById: ReadonlyMap<string, Entry>;
}

/** Metadata retained for an immutable selection from a source catalog. */
export interface CatalogSelectionMetadata<Entry extends CatalogEntryIdentity = CatalogEntryIdentity> {
	/** Protocol or representation variant selected by this value. */
	readonly type: 'selection';
	/** Catalog namespace that groups these exact entries. */
	readonly namespace: string;
	/** Source representation or provenance retained alongside the interpreted value. */
	readonly source: Catalog<Entry>;
	/** Catalog keys in their stable authored order. */
	readonly keys: readonly string[];
	/** Exact entry objects in the order of the retained catalog keys. */
	readonly entries: readonly Entry[];
	/** Reverse lookup from an exact catalog entry object to its authored key. */
	readonly keyByEntry: ReadonlyMap<Entry, string>;
	/** Lookup from a stable ID to the exact registered catalog entry. */
	readonly entryById: ReadonlyMap<string, Entry>;
}

const catalogBrand: unique symbol = Symbol('utils.catalog.type');
const catalogSelectionBrand: unique symbol = Symbol('utils.catalog.selection.type');

/** Record-shaped immutable catalog with hidden compile-time identity. */
export type Catalog<
	Entry extends CatalogEntryIdentity = CatalogEntryIdentity,
	Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>> = Readonly<Record<string, Entry>>,
> = Readonly<Entries> & CatalogBrand<Entry>;

/** Record-shaped immutable catalog selection with hidden compile-time identity. */
export type CatalogSelection<
	Entry extends CatalogEntryIdentity = CatalogEntryIdentity,
	Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>> = Readonly<Record<string, Entry>>,
> = Readonly<Entries> & CatalogSelectionBrand<Entry>;

/** Any catalog-like value accepted by generic catalog helpers. */
export type CatalogLike<Entry extends CatalogEntryIdentity = CatalogEntryIdentity> =
	| CatalogBrand<Entry>
	| CatalogSelectionBrand<Entry>;

/** Key-preserving stable identifiers projected from one catalog or selection. */
export type CatalogIds<Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>> = Readonly<
	{
		readonly [Key in keyof Entries]: Entries[Key]['id'];
	}
>;

/** Recursive input accepted by definition-consuming fields. */
export type DefinitionInput<Entry extends CatalogEntryIdentity> =
	| Entry
	| CatalogLike<Entry>
	| readonly DefinitionInput<Entry>[];

/** Entry union represented by one direct, nested, catalog, or selection input. */
export type DefinitionEntry<
	Input,
	Depth extends readonly unknown[] = readonly [],
> = Depth['length'] extends 8 ? Extract<Input, CatalogEntryIdentity>
	: Input extends readonly (infer Item)[] ? DefinitionEntry<Item, readonly [...Depth, unknown]>
	: Input extends CatalogBrand<infer Entry> ? Entry
	: Input extends CatalogSelectionBrand<infer Entry> ? Entry
	: Input extends CatalogEntryIdentity ? Input
	: never;

/** JSON-safe description of one catalog entry. */
export interface CatalogEntryDocument {
	/** Stable lookup or correlation key within the owning contract. */
	readonly key: string;
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id: string;
	/** Stable discriminant that selects the documented variant. */
	readonly kind: string;
	/** Caller-authored purpose used in documentation and diagnostics. */
	readonly description?: string;
}

/** JSON-safe projection of a catalog or selection. */
export interface CatalogDocument {
	/** Protocol or representation variant selected by this value. */
	readonly type: 'catalog' | 'selection' | 'composition';
	/** Catalog namespace that groups these exact entries. */
	readonly namespace?: string;
	/** Exact entry objects in the order of the retained catalog keys. */
	readonly entries: readonly CatalogEntryDocument[];
}

/** Validation issue produced while inspecting a definition input. */
export interface CatalogValidationIssue {
	/** Stable machine-readable reason that callers can inspect without matching message text. */
	readonly code: 'invalid-entry' | 'duplicate-id' | 'empty-id' | 'empty-kind';
	/** Human-readable explanation; use the stable code or discriminant for program decisions. */
	readonly message: string;
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id?: string;
	/** First operand or observation retained in this ordered pair. */
	readonly first?: CatalogEntryIdentity;
	/** Second operand or observation retained in this ordered pair. */
	readonly second?: CatalogEntryIdentity;
}

/** Deterministic validation result for a catalog input. */
export type CatalogValidationResult =
	| { readonly valid: true; readonly entries: readonly CatalogEntryIdentity[] }
	| { readonly valid: false; readonly issues: readonly CatalogValidationIssue[] };

/** Compile-time brand carried by catalog values. */
export interface CatalogBrand<Entry extends CatalogEntryIdentity> {
	/** Hidden compile-time catalog identity; it is not an acquired resource value. */
	readonly [catalogBrand]: Entry;
}

/** Compile-time brand carried by catalog selections. */
export interface CatalogSelectionBrand<Entry extends CatalogEntryIdentity> {
	/** Hidden compile-time selection identity preserving exact catalog entry inference. */
	readonly [catalogSelectionBrand]: Entry;
}
