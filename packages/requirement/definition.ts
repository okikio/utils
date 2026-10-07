/** Pure requirement declarations; runtime interpretation belongs to the main facade. */
import * as catalogCore from '@okikio/catalog';
import type { Catalog, CatalogEntryIdentity, CatalogLike, CatalogSelection } from '@okikio/catalog';
import type {
	RequirementCatalog,
	RequirementCatalogOptions,
	RequirementDefinition,
	RequirementDocument,
	RequirementInput,
	RequirementOptions,
} from './types.ts';

/** Exact requirement definitions memoized by domain definition, family, and action. */
const definitions = new WeakMap<CatalogEntryIdentity, Map<string, RequirementDefinition>>();

/** Define one immutable requirement without implementing its domain semantics. */
export function define<
	const Family extends string,
	const Action extends string,
	Entry extends CatalogEntryIdentity,
>(input: RequirementOptions<Family, Action, Entry>): RequirementDefinition<Family, Action, Entry> {
	assertPart(input.family, 'requirement family');
	assertPart(input.action, 'requirement action');
	if (!input.definition || typeof input.definition.id !== 'string' || typeof input.definition.kind !== 'string') {
		throw new TypeError('Requirement definition must be a catalog definition.');
	}

	const key = `${input.family}:${input.action}`;
	const owned = definitions.get(input.definition) ?? new Map<string, RequirementDefinition>();
	const existing = owned.get(key);
	if (existing !== undefined) {
		if (existing.description !== input.description) {
			throw new TypeError(`Requirement ${JSON.stringify(existing.id)} was defined with different descriptions.`);
		}
		return existing as RequirementDefinition<Family, Action, Entry>;
	}

	const value: RequirementDefinition<Family, Action, Entry> = Object.freeze({
		kind: 'requirement',
		id: `${input.family}:${input.action}:${input.definition.id}`,
		family: input.family,
		action: input.action,
		definition: input.definition,
		...(input.description === undefined ? {} : { description: input.description }),
	});
	owned.set(key, value);
	definitions.set(input.definition, owned);
	return value;
}

/**
 * Project one canonical definition catalog into key-preserving requirements.
 *
 * The source definition objects remain authoritative. This helper only derives
 * the generic requirement declarations interpreted by the owning family.
 */
export function catalog<
	const Family extends string,
	const Action extends string,
	const Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>,
>(
	source: Catalog<Entries[keyof Entries], Entries>,
	options: RequirementCatalogOptions<Family, Action>,
): RequirementCatalog<Family, Action, Entries>;
/** Project a key-preserving catalog selection into requirements. */
export function catalog<
	const Family extends string,
	const Action extends string,
	SourceEntry extends CatalogEntryIdentity,
	const Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>,
>(
	source: CatalogSelection<SourceEntry, Entries>,
	options: RequirementCatalogOptions<Family, Action>,
): RequirementCatalog<Family, Action, Entries>;
/** Build the requirement projection after the source catalog shape is statically captured. */
export function catalog<const Family extends string, const Action extends string>(
	source: CatalogLike<CatalogEntryIdentity>,
	options: RequirementCatalogOptions<Family, Action>,
): RequirementCatalog<Family, Action, Readonly<Record<string, CatalogEntryIdentity>>> {
	const sourceMetadata = catalogCore.metadata(source);
	const sourceEntries = source as unknown as Readonly<Record<string, CatalogEntryIdentity>>;
	const projected = Object.create(null) as Record<string, RequirementDefinition<Family, Action, CatalogEntryIdentity>>;
	for (const key of sourceMetadata.keys) {
		projected[key] = define({ family: options.family, action: options.action, definition: sourceEntries[key]! });
	}
	return catalogCore.create(
		`${sourceMetadata.namespace}.${options.family}.${options.action}`,
		projected,
	);
}

/** Compose direct requirements, catalogs, selections, and nested arrays. */
export function compose<Entry extends RequirementDefinition>(
	...input: readonly RequirementInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Return requirements owned by one semantic family. */
export function family<const Family extends string, Entry extends RequirementDefinition>(
	input: RequirementInput<Entry>,
	familyName: Family,
): readonly Extract<Entry, RequirementDefinition<Family, string, CatalogEntryIdentity>>[] {
	return Object.freeze(catalogCore.values(input).filter((entry) => entry.family === familyName)) as readonly Extract<
		Entry,
		RequirementDefinition<Family, string, CatalogEntryIdentity>
	>[];
}

/** Return whether a value has the generic requirement protocol. */
export function is(value: unknown): value is RequirementDefinition {
	return typeof value === 'object' && value !== null &&
		(value as { kind?: unknown }).kind === 'requirement' &&
		typeof (value as { id?: unknown }).id === 'string' &&
		typeof (value as { family?: unknown }).family === 'string' &&
		typeof (value as { action?: unknown }).action === 'string';
}

/** Create deterministic JSON-safe documentation for requirement definitions. */
export function document(input: RequirementInput): readonly RequirementDocument[] {
	return Object.freeze(
		catalogCore.values(input).map((entry) =>
			Object.freeze({
				id: entry.id,
				family: entry.family,
				action: entry.action,
				definition: entry.definition.id,
				definitionKind: entry.definition.kind,
				...(entry.description === undefined ? {} : { description: entry.description }),
			})
		),
	);
}

/** Reject an invalid family/action part before it enters the requirement cache. */
function assertPart(value: string, name: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) throw new TypeError(`Invalid ${name} ${JSON.stringify(value)}.`);
}
