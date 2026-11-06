/**
 * Provider-neutral entitlement definitions and requirement contributions.
 *
 * This package contains no persistence or enforcement implementation. A host
 * can inspect or interpret the immutable definitions using its own policy and
 * provider integrations.
 *
 * @module
 */
import * as catalogCore from '@okikio/collection/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/collection/catalog';
import * as requirement from '@okikio/capability/requirement/definition';
import type {
	EntitlementCatalog,
	EntitlementDefinition,
	EntitlementIds,
	EntitlementOptions,
	EntitlementRequirement,
	EntitlementRequirementCatalog,
	EntitlementSelection,
} from './types.ts';

/** Runtime identity set for definitions admitted through `define()`. */
const entitlementDefinitions = new WeakSet<object>();

/** Define one immutable entitlement contract. */
export function define<const Id extends string>(input: EntitlementOptions<Id>): EntitlementDefinition<Id> {
	assertIdentifier(input.id);
	const definition = Object.freeze({ kind: 'entitlement', ...input }) as EntitlementDefinition<Id>;
	entitlementDefinitions.add(definition);
	return definition;
}

/** Return whether a value is an entitlement definition created by `define()`. */
export function is(value: unknown): value is EntitlementDefinition {
	return typeof value === 'object' && value !== null && entitlementDefinitions.has(value);
}

/** Create a named immutable entitlement catalog. */
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>,
>(
	namespace: Namespace,
	entries: Entries,
): EntitlementCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving entitlement catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: EntitlementCatalog<Entries>,
	keys: Keys,
): EntitlementSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose entitlement definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends EntitlementDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Return whether one exact entitlement definition belongs to a source catalog or selection. */
export function has<Entry extends EntitlementDefinition>(
	source: import('@okikio/collection/catalog').CatalogLike<Entry>,
	definition: unknown,
): definition is Entry {
	return catalogCore.has(source, definition);
}

/** Resolve one stable entitlement ID back to an exact trusted definition. */
export function get<Entry extends EntitlementDefinition>(
	input: CatalogDefinitionInput<Entry>,
	id: string,
): Entry | undefined {
	return catalogCore.get(input, id);
}

/** Project stable entitlement identifiers while preserving catalog keys. */
export function ids<const Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>>(
	source: EntitlementCatalog<Entries>,
): EntitlementIds<Entries>;
/** Project stable entitlement identifiers from a key-preserving selection. */
export function ids<
	Entry extends EntitlementDefinition,
	const Entries extends Readonly<Record<PropertyKey, Entry>>,
>(source: EntitlementSelection<Entry, Entries>): EntitlementIds<Entries>;
/** Build the entitlement identifier projection after catalog-kind narrowing. */
export function ids(
	source: import('@okikio/collection/catalog').CatalogLike<EntitlementDefinition>,
): Readonly<Record<string, string>> {
	return catalogCore.ids(source as never);
}

/** Contribute the `require` requirement for one entitlement definition. */
export function require<Definition extends EntitlementDefinition>(
	definition: Definition,
): EntitlementRequirement<Definition> {
	if (!is(definition)) throw new TypeError('Entitlement requirement needs an exact imported definition.');
	return requirement.define({ family: 'entitlement', action: 'require', definition });
}

/** Derive a complete key-preserving `require` catalog from canonical entitlements. */
export function requirements<const Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>>(
	source: EntitlementCatalog<Entries>,
): EntitlementRequirementCatalog<Entries>;
/** Derive a key-preserving `require` catalog from an entitlement selection. */
export function requirements<
	Entry extends EntitlementDefinition,
	const Entries extends Readonly<Record<PropertyKey, Entry>>,
>(source: EntitlementSelection<Entry, Entries>): EntitlementRequirementCatalog<Entries>;
/** Project entitlement definitions into memoized generic requirements. */
export function requirements(
	source: import('@okikio/collection/catalog').CatalogLike<EntitlementDefinition>,
): EntitlementRequirementCatalog<Readonly<Record<string, EntitlementDefinition>>> {
	return requirement.catalog(source as never, {
		family: 'entitlement',
		action: 'require',
	}) as unknown as EntitlementRequirementCatalog<
		Readonly<Record<string, EntitlementDefinition>>
	>;
}

/** Keep feature IDs stable and printable before catalogs or requirement metadata retain them. */
function assertIdentifier(id: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Invalid entitlement id ${JSON.stringify(id)}.`);
}

export type {
	EntitlementCatalog,
	EntitlementDecision,
	EntitlementDefinition,
	EntitlementDefinitions,
	EntitlementIds,
	EntitlementOptions,
	EntitlementRequirement,
	EntitlementRequirementCatalog,
	EntitlementSelection,
} from './types.ts';
