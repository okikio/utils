/**
 * Give expected rejection a stable identity and validated data that can cross a process or storage transfer. Catching every Error by message makes a renamed sentence change application behavior.
 *
 * Use failures for expected domain outcomes such as missing input or a declined request. Encode before transport and decode against trusted definitions on the receiving side. Unknown identities reject instead of manufacturing authority from input. Unexpected exceptions belong to fault diagnostics; HTTP presentation belongs to problem definitions. Do not put secrets in durable failure data.
 *
 * @example
 * ```ts
 * import * as failure from '@okikio/result/failure';
 * import * as schema from '@okikio/schema';
 * const Missing = failure.define({
 *   id: 'asset.missing', description: 'The requested asset does not exist.',
 *   data: schema.object({ id: schema.string() }),
 * });
 * const occurrence = await failure.create(Missing, { data: { id: 'asset-1' } });
 * const wire = await failure.encode(occurrence);
 * const restored = await failure.decode(wire, [Missing]);
 * console.log(restored.definition === Missing, restored.data.id);
 * ```
 *
 * @module
 */
import * as record from '@okikio/collection/record';
import * as catalogCore from '@okikio/collection/catalog';
import type { DefinitionInput } from '@okikio/collection/catalog';
import * as codec from '@okikio/schema/codec';
import type { Contract, ContractOutput } from '@okikio/schema/codec';

import type { Cases, Data, Definition, Encoded, FailureCatalog, FailureSelection, Occurrence } from './types.ts';

/** Error raised when durable failure data references an unknown definition. */
export class UnknownFailureDefinitionError extends TypeError {
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id: string;

	/** Retain the unrecognized wire ID so callers can diagnose a catalog-version mismatch. */
	constructor(id: string) {
		super(`Unknown failure definition ${JSON.stringify(id)}.`);
		this.name = 'UnknownFailureDefinitionError';
		this.id = id;
	}
}

/**
 * Owns the internal failure occurrence state used by declared failure encoding.
 *
 * Failure internals preserve stable expected-failure identity across process-local occurrences and durable encoded values.
 *
 * @internal
 */
class FailureOccurrence<FailureDefinition extends Definition> extends Error implements Occurrence<FailureDefinition> {
	/** Keep the trusted definition identity for same-process handling. */
	readonly definition: FailureDefinition;
	/** Checked occurrence data; encoded values use the definition's stable wire ID. */
	readonly data: Data<FailureDefinition>;

	constructor(definition: FailureDefinition, data: Data<FailureDefinition>, message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'Failure';
		this.definition = definition;
		this.data = data;
		Object.freeze(this);
	}
}

/** Define one immutable expected failure contract. */
export function define<const Id extends string, const DataContract extends Contract>(
	input: Readonly<{
		readonly id: Id;
		readonly description: string;
		readonly data: DataContract;
	}>,
): Definition<Id, ContractOutput<DataContract>, DataContract> {
	record.assert(input, 'failure definition');
	if (Object.keys(input).some((key) => !['id', 'description', 'data'].includes(key))) {
		throw new TypeError('Failure definition contains an unknown property.');
	}
	assertIdentifier(input.id);
	if (typeof input.description !== 'string' || input.description.trim().length === 0) {
		throw new TypeError('Failure description must not be empty.');
	}
	codec.input(input.data);
	return Object.freeze({ kind: 'failure', id: input.id, description: input.description, data: input.data });
}

/** Create a named immutable failure catalog. */
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, Definition>>,
>(namespace: Namespace, entries: Entries): FailureCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving failure catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, Definition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: FailureCatalog<Entries>,
	keys: Keys,
): FailureSelection<Entries[Keys[number]], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose direct failure definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends Definition>(...inputs: readonly DefinitionInput<Entry>[]): readonly Entry[] {
	return catalogCore.compose(...inputs);
}

/**
 * Validate data against the definition before constructing a frozen Error occurrence.
 * The definition object remains its process-local identity. Encoding preserves its
 * stable ID and validated data, while cause remains local diagnostic context.
 * Validation rejects; it is not converted into another declared failure.
 */
export async function create<FailureDefinition extends Definition>(
	definition: FailureDefinition,
	input: Readonly<{ readonly data: unknown; readonly message?: string; readonly cause?: unknown }>,
): Promise<Occurrence<FailureDefinition>> {
	// `FailureDefinition` preserves the exact definition object while Standard Schema
	// carries its output type through a nested property. TypeScript cannot reduce
	// `Data<FailureDefinition>` from that generic property access here, so keep the
	// assertion at this one validated seam rather than widening the public contract.
	const data = await codec.read(definition.data, input.data) as Data<FailureDefinition>;
	return new FailureOccurrence(
		definition,
		data,
		input.message ?? definition.description,
		input.cause,
	);
}

/** Return whether a value is a failure occurrence created by this module instance. */
export function isOccurrence(value: unknown): value is Occurrence {
	return value instanceof FailureOccurrence;
}

/** Return whether a value is an occurrence of one exact failure definition. */
export function is<FailureDefinition extends Definition>(
	value: unknown,
	definition: FailureDefinition,
): value is Occurrence<FailureDefinition> {
	return isOccurrence(value) && value.definition === definition;
}

/** Match a declared failure by an own data callback, retaining its exact typed occurrence. */
export function match<Entry extends Definition, Value>(
	value: Occurrence<Entry>,
	cases: Cases<Entry, Value>,
	otherwise?: (value: Occurrence<Entry>) => Value,
): Value {
	const descriptor = Object.getOwnPropertyDescriptor(cases, value.definition.id);
	if (descriptor !== undefined) {
		if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
			throw new TypeError('Failure match cases must be own callable data properties.');
		}
		// The exact definition ID selects its corresponding data type. A dynamic
		// descriptor lookup cannot express that mapped union in the implementation.
		return (descriptor.value as (value: Occurrence<Entry>) => Value)(value);
	}
	if (otherwise !== undefined) return otherwise(value);
	throw new TypeError(`No failure match case exists for ${JSON.stringify(value.definition.id)}.`);
}

/** Encode through an explicit codec or owned identity validator. Causes remain process-local and are omitted. */
export async function encode(value: Occurrence): Promise<Encoded> {
	const data = await codec.write(value.definition.data, value.data);
	return Object.freeze({ id: value.definition.id, data, message: value.message });
}

/** Decode and validate a durable occurrence through a trusted failure catalog. */
export async function decode<Entry extends Definition>(
	value: unknown,
	trusted: DefinitionInput<Entry>,
): Promise<Occurrence<Entry>> {
	if (!isEncoded(value)) throw new TypeError('Encoded failure must contain string id, message, and data fields.');
	const definition = catalogCore.values(trusted).find((entry) => entry.id === value.id);
	if (definition === undefined) throw new UnknownFailureDefinitionError(value.id);
	return await create(definition, { data: value.data, message: value.message });
}

/**
 * Return whether a durable failure record has safe own data properties.
 *
 * The guard inspects property descriptors instead of reading candidate fields.
 * This prevents accessor-backed transport objects from running caller code while
 * the decoder is only trying to classify input.
 *
 * @internal
 */
export function isEncoded(value: unknown): value is Encoded {
	return record.is(value) &&
		Object.hasOwn(value, 'id') && typeof value.id === 'string' &&
		Object.hasOwn(value, 'message') && typeof value.message === 'string' &&
		Object.hasOwn(value, 'data');
}

/** Require the portable ID spelling used by catalogs and durable failure records. @internal */
function assertIdentifier(value: string): void {
	if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) {
		throw new TypeError(`Invalid failure id ${JSON.stringify(value)}.`);
	}
}

export type {
	Cases,
	Data,
	Definition,
	Encoded,
	FailureCatalog,
	FailureSelection,
	Occurrence,
	Occurrences,
} from './types.ts';
