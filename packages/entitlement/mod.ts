/**
 * Declare which paid or enabled feature an operation requires without coupling its definition to a billing provider. Scattered plan-name comparisons otherwise make the same feature mean different things in different services.
 *
 * Attach the requirement to a resource, activity or endpoint, then configure an entitlement interpreter at the application root. The definition documents a required capability; it does not itself allow access. Unknown requirement families reject unless the owner explicitly chooses another policy. Use exact imported definitions so billing policy and runtime admission describe the same feature.
 *
 * @example
 * ```ts
 * import * as entitlement from '@okikio/entitlement';
 * import * as requirement from '@okikio/requirement';
 * const Export = entitlement.define({ id: 'export.csv', description: 'Export rows as CSV.' });
 * console.log(requirement.document(entitlement.require(Export))[0]?.definition);
 * ```
 *
 * @module
 */
import * as catalogCore from '@okikio/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import * as requirement from '@okikio/requirement';
import type {
	EntitlementCatalog,
	EntitlementDefinition,
	EntitlementOptions,
	EntitlementRequirement,
	EntitlementSelection,
} from './types.ts';

/** Define one immutable entitlement contract. */
export function define(input: EntitlementOptions): EntitlementDefinition {
	assertIdentifier(input.id);
	return Object.freeze({ kind: 'entitlement', ...input });
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

/** Contribute the `require` requirement for one entitlement definition. */
export function require(definition: EntitlementDefinition): EntitlementRequirement {
	return requirement.define({ family: 'entitlement', action: 'require', definition });
}

function assertIdentifier(id: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Invalid entitlement id ${JSON.stringify(id)}.`);
}

export type {
	EntitlementCatalog,
	EntitlementDefinition,
	EntitlementDefinitions,
	EntitlementOptions,
	EntitlementRequirement,
	EntitlementSelection,
} from './types.ts';
