/**
 * Declare permissions for browser and service contracts without importing execution contexts.
 *
 * A declaration names an action and optionally validates its target. It never
 * authenticates an actor or contacts a provider. The main facade re-exports
 * these same functions and owns explicit runtime evaluation through scope().
 *
 * @module
 */
import * as catalogCore from '@okikio/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import * as requirement from '@okikio/requirement/definition';
import * as schema from '@okikio/schema';
import type {
	PermissionCatalog,
	PermissionDefinition,
	PermissionOptions,
	PermissionRequirement,
	PermissionSelection,
} from './types.ts';

/** Define one immutable permission contract without starting a policy provider. */
export function define<
	const Id extends string,
	TargetSchema extends import('./types.ts').PermissionSchema | undefined = undefined,
>(input: PermissionOptions<Id, TargetSchema>): PermissionDefinition<Id, TargetSchema> {
	assertIdentifier(input.id);
	if (input.target !== undefined) schema.assert(input.target, 'permission target schema');
	return Object.freeze({
		kind: 'permission',
		id: input.id,
		...(input.description === undefined ? {} : { description: input.description }),
		...(input.target === undefined ? {} : { target: input.target }),
	}) as PermissionDefinition<Id, TargetSchema>;
}

/** Create a named immutable permission catalog. */
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, PermissionDefinition>>,
>(
	namespace: Namespace,
	entries: Entries,
): PermissionCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving permission catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, PermissionDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: PermissionCatalog<Entries>,
	keys: Keys,
): PermissionSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose permission definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends PermissionDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Contribute the `require` requirement for one permission definition. */
export function require(definition: PermissionDefinition): PermissionRequirement {
	return requirement.define({ family: 'permission', action: 'require', definition });
}

/** Reject an invalid stable permission identifier before it enters authoritative state. */
function assertIdentifier(id: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Invalid permission id ${JSON.stringify(id)}.`);
}
