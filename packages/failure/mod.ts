/**
 * Stable expected-failure definitions and durable failure occurrences.
 *
 * Failures describe why work could not complete. They do not define HTTP
 * presentation or the success-or-failure container used by callers.
 *
 * @module
 */
import * as catalogCore from '@okikio/catalog';
import type { DefinitionInput } from '@okikio/catalog';
import * as schema from '@okikio/schema';

import type { Data, Definition, Encoded, FailureCatalog, FailureSelection, Occurrence } from './types.ts';

/** Error raised when durable failure data references an unknown definition. */
export class UnknownFailureDefinitionError extends TypeError {
	readonly id: string;

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
	readonly definition: FailureDefinition;
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
export function define<const Id extends string, Output>(input: Readonly<{
	readonly id: Id;
	readonly description: string;
	readonly data: import('@standard-schema/spec').StandardSchemaV1<unknown, Output>;
}>): Definition<Id, Output> {
	assertIdentifier(input.id);
	if (input.description.trim().length === 0) throw new TypeError('Failure description must not be empty.');
	schema.assert(input.data, 'failure data schema');
	return Object.freeze({ kind: 'failure', ...input });
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
): FailureSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose direct failure definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends Definition>(...inputs: readonly DefinitionInput<Entry>[]): readonly Entry[] {
	return catalogCore.compose(...inputs);
}

/** Create one schema-validated failure occurrence. */
export async function create<FailureDefinition extends Definition>(
	definition: FailureDefinition,
	input: Readonly<{ readonly data: unknown; readonly message?: string; readonly cause?: unknown }>,
): Promise<Occurrence<FailureDefinition>> {
	// `FailureDefinition` preserves the exact definition object while Standard Schema
	// carries its output type through a nested property. TypeScript cannot reduce
	// `Data<FailureDefinition>` from that generic property access here, so keep the
	// assertion at this one validated seam rather than widening the public contract.
	const data = await schema.parse(definition.data, input.data) as Data<FailureDefinition>;
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

/** Match a failure occurrence by stable definition ID. */
export function match<Value>(
	value: Occurrence,
	cases: Readonly<Record<string, (value: Occurrence) => Value>>,
	otherwise?: (value: Occurrence) => Value,
): Value {
	const handler = cases[value.definition.id];
	if (handler !== undefined) return handler(value);
	if (otherwise !== undefined) return otherwise(value);
	throw new TypeError(`No failure match case exists for ${JSON.stringify(value.definition.id)}.`);
}

/** Encode an occurrence after revalidating its durable data. Causes are deliberately omitted. */
export async function encode(value: Occurrence): Promise<Encoded> {
	const data = await schema.parse(value.definition.data, value.data);
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
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;

	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== 'string') return false;
		const descriptor = descriptors[key];
		if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) return false;
	}

	const id = descriptors.id;
	const message = descriptors.message;
	const data = descriptors.data;
	return id !== undefined && 'value' in id && typeof id.value === 'string' &&
		message !== undefined && 'value' in message && typeof message.value === 'string' &&
		data !== undefined && 'value' in data;
}

/**
 * Rejects invalid identifier before it can enter authoritative module state.
 *
 * @internal
 */
function assertIdentifier(value: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) throw new TypeError(`Invalid failure id ${JSON.stringify(value)}.`);
}

export type { Definition, Data, Occurrence, Encoded, FailureCatalog, FailureSelection } from './types.ts';
