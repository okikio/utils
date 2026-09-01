/**
 * Meter definitions and required measurement effects.
 *
 * A meter names a quantity. Recording is runtime work, so `record()` creates
 * and emits one required effect. The package does not aggregate usage, reserve
 * quota, or bill a customer; the configured effect owner decides how accepted
 * measurements become durable or operational state.
 *
 * @module
 */
import * as catalogCore from '@okikio/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import type { EffectContext, EffectOccurrence } from '@okikio/effect';
import * as effects from '@okikio/effect';
import { MeterReadingSchema } from './schema.ts';
import type {
	MeterCatalog,
	MeterDefinition,
	MeterOptions,
	MeterReadingType,
	MeterRecordOptions,
	MeterSelection,
} from './types.ts';

/** Define one immutable meter contract without starting a measurement sink. */
export function define(input: MeterOptions): MeterDefinition {
	assertIdentifier(input.id);
	const effect = effects.define({
		id: `meter:${input.id}`,
		description: input.description === undefined ? `Records ${input.id}.` : `Records ${input.description}`,
		value: MeterReadingSchema,
	});
	return Object.freeze({ kind: 'meter', ...input, effect });
}

/** Create a named immutable meter catalog. */
export function catalog<const Namespace extends string, const Entries extends Readonly<Record<PropertyKey, MeterDefinition>>>(
	namespace: Namespace,
	entries: Entries,
): MeterCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving meter catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, MeterDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(source: MeterCatalog<Entries>, keys: Keys): MeterSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose meter definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends MeterDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Return the exact required-effect definition used to record this meter. */
export function effect(definition: MeterDefinition): import('@okikio/effect').EffectDefinition {
	assertDefinition(definition);
	return definition.effect;
}

/**
 * Record one measurement as a required effect.
 *
 * The occurrence time comes from the execution context clock, not ambient
 * `Date.now()`, so tests and replay-aware hosts can control time consistently.
 * Resolution means the effect owner accepted responsibility for the fact.
 */
export async function record(
	ctx: EffectContext,
	definition: MeterDefinition,
	value: number,
	options: MeterRecordOptions,
): Promise<EffectOccurrence> {
	assertDefinition(definition);
	const reading: MeterReadingType = {
		value,
		at: ctx.clock.now().toString(),
		...(options.attributes === undefined ? {} : { attributes: options.attributes }),
	};
	return await effects.emit(ctx, definition.effect, reading, { key: options.key });
}

/** Return whether a value is an exact meter definition. */
function isDefinition(value: unknown): value is MeterDefinition {
	return typeof value === 'object' && value !== null &&
		(value as { readonly kind?: unknown }).kind === 'meter' &&
		typeof (value as { readonly id?: unknown }).id === 'string' &&
		(value as { readonly effect?: unknown }).effect !== undefined;
}

/** Reject a malformed meter before it reaches runtime measurement code. */
function assertDefinition(value: MeterDefinition): void {
	if (!isDefinition(value)) throw new TypeError('Meter operation requires a meter definition.');
}

/** Reject an invalid stable meter identifier before definition creation. */
function assertIdentifier(id: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Invalid meter id ${JSON.stringify(id)}.`);
}

export type {
	MeterCatalog,
	MeterDefinition,
	MeterDefinitions,
	MeterOptions,
	MeterReadingType,
	MeterRecordOptions,
	MeterSelection,
} from './types.ts';
