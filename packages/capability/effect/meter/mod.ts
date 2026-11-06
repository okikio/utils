/**
 * Record one named usage fact through the operation's configured effect recipient.
 * For example, a download can report 2048 accepted bytes. The meter names the quantity and
 * unit; application policy decides pricing, access and where to keep the resulting record.
 *
 * A reading is one occurrence of that measurement. Give it a stable key so its recipient can
 * recognize repeated submission. The recipient must implement deduplication and storage.
 * An in-memory counter alone does not prove that an audit or billing service accepted it.
 *
 * The example's recipient accepts readings in memory. It demonstrates validation and acceptance;
 * it does not create a persistent ledger or a billing backend.
 *
 * @example
 * ```ts
 * import * as context from '@okikio/context';
 * import * as effect from '@okikio/capability/effect';
 * import * as meter from '@okikio/capability/effect/meter';
 * import { MeterReadingSchema } from '@okikio/capability/effect/meter';
 * import * as schema from '@okikio/schema';
 * const Bytes = meter.define({ id: 'download.bytes', unit: 'byte', aggregation: 'sum' });
 * await using owner = context.create({ id: 'download' });
 * const ctx = effect.scope(owner, {
 *   effects: [meter.effect(Bytes)], emitter: { async emit() {} },
 * });
 * const occurrence = await meter.record(ctx, Bytes, 2048, { key: 'download:asset-1' });
 * console.log((await schema.parse(MeterReadingSchema, occurrence.value)).value);
 * ```
 *
 * @module
 */
import * as catalogCore from '@okikio/collection/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/collection/catalog';
import type { EffectContext, EffectOccurrence } from '../mod.ts';
import * as effects from '../mod.ts';
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
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, MeterDefinition>>,
>(
	namespace: Namespace,
	entries: Entries,
): MeterCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving meter catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, MeterDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(source: MeterCatalog<Entries>, keys: Keys): MeterSelection<Entries[Keys[number]], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose meter definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends MeterDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Return the exact declared effect definition used to record this meter. */
export function effect(definition: MeterDefinition): import('@okikio/capability/effect').EffectDefinition {
	assertDefinition(definition);
	return definition.effect;
}

/**
 * Record one measurement as an effect announcement.
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

/** One authored reading; unit must match the selected meter, including an absent unit. */
export interface BatchReadingType extends MeterRecordOptions {
	/** Finite measurement accepted by MeterReadingSchema. */
	readonly value: number;
	/** Explicit measurement unit; never converted implicitly. */
	readonly unit?: string;
}

/** Accepted prefix remains authoritative even when a later sink call rejects. */
export type BatchResultType =
	| Readonly<{ status: 'accepted'; accepted: readonly EffectOccurrence[] }>
	| Readonly<{ status: 'partial'; accepted: readonly EffectOccurrence[]; rejectedIndex: number; error: unknown }>;

/** Explicit scan and wire budgets; JSON encoding itself may allocate before its byte count is checked. */
export interface BatchOptionsType {
	/** Largest number of authored readings, counting duplicate keys. */
	readonly maximumItems: number;
	/** Total UTF-8 bytes across individually encoded effect envelopes. */
	readonly maximumBytes: number;
}

/**
 * Validate and encode the entire bounded input before the first sink call, then
 * deliver sequentially through the existing effect owner. Encoded bytes count
 * each JSON envelope's UTF-8 bytes, without array separators. Preflight failures
 * throw without delivery. Sink failure returns the exact accepted prefix and
 * error, including cancellation during delivery; no rollback, retry or replay is implied. Duplicate keys are retained in
 * order: the sink owns idempotent acceptance and cross-batch conflict policy.
 */
export async function recordBatch(
	ctx: EffectContext,
	definition: MeterDefinition,
	readings: Iterable<BatchReadingType>,
	options: BatchOptionsType,
): Promise<BatchResultType> {
	assertDefinition(definition);
	for (const value of [options.maximumItems, options.maximumBytes]) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError('Meter batch limits must be positive safe integers.');
		}
	}
	const occurrences: EffectOccurrence[] = [];
	const encoder = new TextEncoder();
	let bytes = 0;
	for (const reading of readings) {
		if (occurrences.length >= options.maximumItems) throw new RangeError('Meter batch exceeds maximumItems.');
		if (reading.unit !== definition.unit) {
			throw new TypeError('Meter batch reading unit does not match its definition.');
		}
		const occurrence = await effects.create(definition.effect, {
			value: reading.value,
			at: ctx.clock.now().toString(),
			...(reading.attributes === undefined ? {} : { attributes: reading.attributes }),
		}, { key: reading.key });
		bytes += encoder.encode(JSON.stringify(await effects.encode(occurrence))).byteLength;
		if (bytes > options.maximumBytes) throw new RangeError('Meter batch exceeds maximumBytes.');
		occurrences.push(occurrence);
	}
	const accepted: EffectOccurrence[] = [];
	for (const [index, occurrence] of occurrences.entries()) {
		try {
			accepted.push(await effects.emit(ctx, occurrence));
		} catch (error) {
			return Object.freeze({ status: 'partial', accepted: Object.freeze(accepted), rejectedIndex: index, error });
		}
	}
	return Object.freeze({ status: 'accepted', accepted: Object.freeze(accepted) });
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

export { MeterReadingSchema };
