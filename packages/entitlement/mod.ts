/**
 * Provider-neutral entitlement definitions and requirement contributions.
 *
 * This package contains no persistence or enforcement implementation. A host
 * can inspect or interpret the immutable definitions using its own policy and
 * provider integrations.
 *
 * @module
 */
import * as catalogCore from '@okikio/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import * as requirement from '@okikio/requirement';
import type { EntitlementCatalog, EntitlementSelection, EntitlementDefinition, EntitlementOptions, EntitlementRequirement } from './types.ts';

/** Define one immutable entitlement contract. */
export function define(input: EntitlementOptions): EntitlementDefinition {
	assertIdentifier(input.id);
	return Object.freeze({ kind: 'entitlement', ...input });
}

/** Create a named immutable entitlement catalog. */
export function catalog<const Namespace extends string, const Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>>(
	namespace: Namespace, entries: Entries,
): EntitlementCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving entitlement catalog subset. */
export function select<const Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>, const Keys extends readonly (keyof Entries & string)[]>(
	source: EntitlementCatalog<Entries>, keys: Keys,
): EntitlementSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose entitlement definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends EntitlementDefinition>(...input: readonly CatalogDefinitionInput<Entry>[]): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Contribute the `require` requirement for one entitlement definition. */
export function require(definition: EntitlementDefinition): EntitlementRequirement {
	return requirement.define({ family: 'entitlement', action: 'require', definition });
}

function assertIdentifier(id: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Invalid entitlement id ${JSON.stringify(id)}.`);
}

export type { EntitlementCatalog, EntitlementSelection, EntitlementDefinition, EntitlementOptions, EntitlementDefinitions, EntitlementRequirement } from './types.ts';
