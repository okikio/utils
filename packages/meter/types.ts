import type { Catalog, CatalogEntryIdentity, CatalogSelection, DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import type { EffectDefinition } from '@okikio/effect';

/** Options accepted by `meters.define()`. */
export interface MeterOptions {
	/** Stable measurement identity used by effect definitions and downstream metric consumers. */
	readonly id: string;
	/** Human-readable meter purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Unit represented by one recorded measurement value. */
	readonly unit?: string;
	/** Suggested aggregation meaning for downstream metric consumers. */
	readonly aggregation?: string;
}

/** Immutable meter contract and its required effect definition. */
export interface MeterDefinition extends CatalogEntryIdentity {
	/** Stable discriminant for this meter value. */
	readonly kind: 'meter';
	/** Human-readable meter purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Unit represented by each fact recorded for this meter. */
	readonly unit?: string;
	/** Suggested downstream aggregation meaning retained as static metadata. */
	readonly aggregation?: string;
	/** Required effect used when a runtime records one measurement. */
	readonly effect: EffectDefinition;
}

/** Input accepted by `meters.record()`. */
export interface MeterRecordOptions {
	/** Caller-stable key used for deterministic identity or keyed coordination. */
	readonly key: string;
	/** Additional bounded dimensions attached to the recorded meter fact. */
	readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

/** Named meter catalog. */
export type MeterCatalog<Entries extends Readonly<Record<PropertyKey, MeterDefinition>>> = Catalog<Entries[keyof Entries], Entries>;

/** Key-preserving meter catalog selection. */
export type MeterSelection<
	Entry extends MeterDefinition,
	Entries extends Readonly<Record<PropertyKey, Entry>>,
> = CatalogSelection<Entry, Entries>;

/** Recursive input accepted where meter definitions are declared. */
export type MeterDefinitions = CatalogDefinitionInput<MeterDefinition>;

export type { MeterReadingType } from './schema.ts';
