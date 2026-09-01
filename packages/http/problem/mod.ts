/**
 * RFC 9457 problem definitions, catalogs, validation, and response creation.
 *
 * Problem definitions stay import-safe so server composition can select them without constructing a response.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as catalog from '@okikio/catalog';
import * as record from '@okikio/record';
import type { Catalog, CatalogSelection, DefinitionInput } from '@okikio/catalog';
import { mergeHeaders } from '@okikio/http/response/headers';

import type {
	CreateProblemOptions,
	ProblemBody,
	ProblemDefinition,
	ProblemDefinitionInput,
	ProblemDocument,
	ProblemExtensionContract,
	ProblemHeaders,
	ProblemResult,
	ProblemResultMetadata,
	ProblemRetryPolicy,
	ProblemStatus,
} from './types.ts';

const problemResultMetadata = new WeakMap<ReadonlyArray<unknown>, ProblemResultMetadata>();
const CANONICAL_MEMBERS = Object.freeze({ type: true, title: true, status: true, detail: true, instance: true });

/**
 * Resolve one stable problem type URL below a caller-owned namespace.
 *
 * This is a convenience for `new URL(path, base)`. The helper normalizes the
 * base pathname so callers do not accidentally replace its final segment when
 * they omit a trailing slash.
 */
export function url(base: string | URL, path: string): string {
	const root = new URL(base);
	if (!root.pathname.endsWith('/')) root.pathname += '/';
	return new URL(path.replace(/^\/+/, ''), root).href;
}

/**
 * Create a reusable resolver for one caller-owned problem type namespace.
 *
 * This is equivalent to repeatedly calling `url(base, path)`. It is useful when
 * a package defines several RFC 9457 problem types below one stable base URL.
 */
export function namespace(base: string | URL): (path: string) => string {
	const root = new URL(base);
	if (!root.pathname.endsWith('/')) root.pathname += '/';
	return (path: string) => new URL(path.replace(/^\/+/, ''), root).href;
}

/** Define one immutable RFC 9457 problem contract. */
export function define<
	const Extensions extends ProblemExtensionContract | undefined = undefined,
	const Status extends ProblemStatus = ProblemStatus,
>(input: ProblemDefinitionInput<Extensions, Status>): ProblemDefinition<Extensions, Status> {
	record.assert(input, 'Problem definition');
	assertDefinition(input);
	const examples = input.examples === undefined ? undefined : snapshotExamples(input.examples);
	const retry = input.retry === undefined ? undefined : snapshotRetry(input.retry);
	const provider = input.provider === undefined ? undefined : snapshotProvider(input.provider);
	const extensions = input.extensions === undefined ? undefined : snapshotExtensionContract(input.extensions);
	return Object.freeze({
		id: input.id,
		type: input.type,
		status: input.status,
		title: input.title,
		description: input.description,
		kind: 'problem',
		exposure: input.exposure ?? 'public',
		...(input.remediation === undefined ? {} : { remediation: input.remediation }),
		...(input.externalDocumentation === undefined ? {} : { externalDocumentation: input.externalDocumentation }),
		...(input.localizationKey === undefined ? {} : { localizationKey: input.localizationKey }),
		...(input.severity === undefined ? {} : { severity: input.severity }),
		...(examples === undefined ? {} : { examples }),
		...(retry === undefined ? {} : { retry }),
		...(provider === undefined ? {} : { provider }),
		...(extensions === undefined ? {} : { extensions }),
	} satisfies ProblemDefinition<Extensions, Status>);
}

/** Create a named immutable problem catalog. */
export function problemCatalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, ProblemDefinition>>,
>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries> {
	return catalog.create(namespace, entries);
}

/** Select an immutable key-preserving problem subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, ProblemDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: Catalog<Entries[keyof Entries], Entries>,
	keys: Keys,
): CatalogSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalog.select(source, keys);
}

/** Compose problem definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends ProblemDefinition>(
	...inputs: readonly DefinitionInput<Entry>[]
): readonly Entry[] {
	return catalog.compose(...inputs);
}

/** Instantiate one problem occurrence as an RFC 9457 tuple. */
export function create<
	Definition extends ProblemDefinition,
	Extensions extends Readonly<Record<string, unknown>> = Readonly<Record<string, never>>,
>(
	definition: Definition,
	options: CreateProblemOptions<Extensions> = {},
): ProblemResult<Definition, ProblemBody<Definition> & Extensions> {
	record.assert(options, 'Problem occurrence options');
	if (options.detail !== undefined && typeof options.detail !== 'string') throw new TypeError('Problem detail must be a string.');
	if (options.instance !== undefined && typeof options.instance !== 'string') throw new TypeError('Problem instance must be a string.');
	const extensions = snapshotOccurrenceExtensions(options.extensions);
	for (const key of record.keys(extensions)) {
		if (Object.hasOwn(CANONICAL_MEMBERS, key)) throw new TypeError(`Problem extension ${JSON.stringify(key)} overwrites an RFC 9457 member.`);
	}

	const body = Object.freeze({
		type: definition.type,
		title: definition.title,
		status: definition.status,
		...(options.detail !== undefined ? { detail: options.detail } : {}),
		...(options.instance !== undefined ? { instance: options.instance } : {}),
		...extensions,
	}) as ProblemBody<Definition> & Extensions;

	const headers = mergeHeaders(
		{ 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' },
		options.headers,
	);

	const tuple = problemTuple<Definition, ProblemBody<Definition> & Extensions>(body, definition.status, headers);
	problemResultMetadata.set(tuple, Object.freeze({
		definition,
		...(options.cause !== undefined ? { cause: options.cause } : {}),
	}));
	return tuple;
}

/** Construct one frozen logical problem tuple without widening its element types to an array union. */
function problemTuple<Definition extends ProblemDefinition, Body extends ProblemBody<Definition>>(
	body: Body,
	status: Definition['status'],
	headers: ProblemHeaders,
): ProblemResult<Definition, Body> {
	return Object.freeze([body, status, headers] as const);
}

/** Return whether a value is any problem result or belongs to one definition/input. */
export function is(value: unknown): value is ProblemResult;
/** Return whether a value belongs to one exact problem definition. */
export function is<Definition extends ProblemDefinition>(
	value: unknown,
	definition: Definition,
): value is ProblemResult<Definition>;
/** Return whether a value belongs to any problem in a composed definition input. */
export function is<Entry extends ProblemDefinition>(
	value: unknown,
	input: DefinitionInput<Entry>,
): value is ProblemResult<Entry>;
/** Narrow a value to a problem result and optionally one exact declared universe. */
export function is(value: unknown, input?: DefinitionInput<ProblemDefinition>): value is ProblemResult {
	if (!Array.isArray(value) || !problemResultMetadata.has(value)) return false;
	if (input === undefined) return true;
	const definition = problemResultMetadata.get(value)?.definition;
	if (definition === undefined) return false;
	return catalog.values(input).includes(definition);
}

/** Return the exact imported definition retained by a problem tuple. */
export function definitionOf<Definition extends ProblemDefinition>(value: ProblemResult<Definition>): Definition {
	if (!is(value)) throw new TypeError('Value is not a problem result.');
	const metadata = problemResultMetadata.get(value);
	if (metadata === undefined) throw new TypeError('Problem result metadata is unavailable.');
	return metadata.definition as Definition;
}

/** Return the internal cause retained by a problem tuple, when present. */
export function causeOf(value: ProblemResult): unknown {
	if (!is(value)) throw new TypeError('Value is not a problem result.');
	return problemResultMetadata.get(value)?.cause;
}

/** Exhaustively branch by direct definition identity using catalog keys. */
export function match<
	Entry extends ProblemDefinition,
	const Entries extends Readonly<Record<PropertyKey, Entry>>,
	Result,
>(
	value: ProblemResult<Entry>,
	universe: Catalog<Entry, Entries> | CatalogSelection<Entry, Entries>,
	handlers: { readonly [Key in keyof Entries]: (value: ProblemResult<Entries[Key]>) => Result },
): Result;
/** Branch through partial handlers with one required fallback. */
export function match<
	Entry extends ProblemDefinition,
	const Entries extends Readonly<Record<PropertyKey, Entry>>,
	Result,
>(
	value: ProblemResult<Entry>,
	universe: Catalog<Entry, Entries> | CatalogSelection<Entry, Entries>,
	handlers: Partial<{ readonly [Key in keyof Entries]: (value: ProblemResult<Entries[Key]>) => Result }>,
	options: { readonly otherwise: (value: ProblemResult<Entry>) => Result },
): Result;
/** Dispatch a problem result through exhaustive or fallback handlers. */
export function match(
	value: ProblemResult,
	universe: Catalog<ProblemDefinition> | CatalogSelection<ProblemDefinition>,
	handlers: Readonly<Record<PropertyKey, ((value: ProblemResult) => unknown) | undefined>>,
	options?: { readonly otherwise: (value: ProblemResult) => unknown },
): unknown {
	const definition = definitionOf(value);
	const metadata = catalog.metadata(universe);
	const key = metadata.keyByEntry.get(definition);
	if (key === undefined) throw new TypeError(`Problem ${JSON.stringify(definition.id)} is outside the supplied universe.`);
	const handler = handlers[key];
	if (handler) return handler(value);
	if (options) return options.otherwise(value);
	throw new TypeError(`Problem handler ${JSON.stringify(key)} is missing.`);
}

/** Exhaustively translate one problem universe into problem results. */
export function map<
	Entry extends ProblemDefinition,
	const Entries extends Readonly<Record<PropertyKey, Entry>>,
	Result extends ProblemResult,
>(
	value: ProblemResult<Entry>,
	universe: Catalog<Entry, Entries> | CatalogSelection<Entry, Entries>,
	handlers: { readonly [Key in keyof Entries]: (value: ProblemResult<Entries[Key]>) => Result },
): Result {
	return match(value, universe, handlers);
}

/** Create JSON-safe documentation from definitions, catalogs, or selections. */
export function document(input: DefinitionInput<ProblemDefinition>): readonly ProblemDocument[] {
	const keys = new Map<ProblemDefinition, string>();
	if (catalog.is(input)) {
		const metadata = catalog.metadata(input);
		for (const entry of metadata.entries) keys.set(entry as ProblemDefinition, metadata.keyByEntry.get(entry)!);
	}

	return Object.freeze(catalog.values(input).map((definition): ProblemDocument => {
		const key = keys.get(definition);
		return Object.freeze({
		...(key !== undefined ? { key } : {}),
		id: definition.id,
		type: definition.type,
		status: definition.status,
		title: definition.title,
		description: definition.description,
		...(definition.remediation !== undefined ? { remediation: definition.remediation } : {}),
		...(definition.externalDocumentation !== undefined
			? { externalDocumentation: definition.externalDocumentation }
			: {}),
		retry: definition.retry ?? Object.freeze({ kind: 'never' as const }),
		severity: definition.severity ?? 'error',
		exposure: definition.exposure,
		examples: definition.examples ?? Object.freeze([]),
		...(definition.provider !== undefined ? { provider: definition.provider } : {}),
		});
	}));
}

/** Snapshot concrete examples without invoking array or metadata accessors. */
function snapshotExamples(values: readonly import('./types.ts').ProblemExample[]): readonly import('./types.ts').ProblemExample[] {
	const descriptors = Object.getOwnPropertyDescriptors(values);
	const result: import('./types.ts').ProblemExample[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined || !('value' in descriptor)) throw new TypeError('Problem examples must be a dense data array without accessors.');
		const example = descriptor.value as import('./types.ts').ProblemExample;
		record.assert(example, `Problem example ${index}`);
		if (typeof example.key !== 'string' || example.key.length === 0) throw new TypeError(`Problem example ${index} key must be a non-empty string.`);
		if (example.summary !== undefined && typeof example.summary !== 'string') throw new TypeError(`Problem example ${index} summary must be a string.`);
		record.assert(example.value, `Problem example ${index} value`);
		result.push(Object.freeze({
			key: example.key,
			...(example.summary === undefined ? {} : { summary: example.summary }),
			value: record.snapshot(example.value, `Problem example ${index} value`),
		}));
	}
	return Object.freeze(result);
}

/** Snapshot retry guidance while preserving its discriminated shape. */
function snapshotRetry(value: ProblemRetryPolicy): ProblemRetryPolicy {
	record.assert(value, 'Problem retry policy');
	switch (value.kind) {
		case 'never':
			return Object.freeze({ kind: 'never' });
		case 'immediate':
			if (value.maximumAttempts !== undefined && (!Number.isSafeInteger(value.maximumAttempts) || value.maximumAttempts < 1)) {
				throw new TypeError('Problem retry maximumAttempts must be a positive safe integer.');
			}
			return Object.freeze({ kind: 'immediate', ...(value.maximumAttempts === undefined ? {} : { maximumAttempts: value.maximumAttempts }) });
		case 'after':
			if (value.header !== undefined && typeof value.header !== 'string') throw new TypeError('Problem retry header must be a string.');
			if (value.defaultSeconds !== undefined && (!Number.isFinite(value.defaultSeconds) || value.defaultSeconds < 0)) {
				throw new TypeError('Problem retry defaultSeconds must be a non-negative finite number.');
			}
			return Object.freeze({ kind: 'after', ...(value.header === undefined ? {} : { header: value.header }), ...(value.defaultSeconds === undefined ? {} : { defaultSeconds: value.defaultSeconds }) });
	}
}

/** Snapshot provider metadata without retaining a mutable authoring object. */
function snapshotProvider(value: import('./types.ts').ProblemProviderMetadata): import('./types.ts').ProblemProviderMetadata {
	record.assert(value, 'Problem provider metadata');
	if (typeof value.name !== 'string' || value.name.length === 0) throw new TypeError('Problem provider name must be a non-empty string.');
	if (value.code !== undefined && typeof value.code !== 'string') throw new TypeError('Problem provider code must be a string.');
	if (value.documentation !== undefined && typeof value.documentation !== 'string') throw new TypeError('Problem provider documentation must be a string.');
	return Object.freeze({ name: value.name, ...(value.code === undefined ? {} : { code: value.code }), ...(value.documentation === undefined ? {} : { documentation: value.documentation }) });
}

/** Snapshot extension schema metadata while borrowing the schema behavior object itself. */
function snapshotExtensionContract<const Contract extends ProblemExtensionContract>(value: Contract): Contract {
	record.assert(value, 'Problem extension contract');
	if (value.description !== undefined && typeof value.description !== 'string') throw new TypeError('Problem extension description must be a string.');
	return record.snapshot(value, 'Problem extension contract');
}

/** Snapshot occurrence extension members so spreading the body cannot execute getters. */
function snapshotOccurrenceExtensions<Extensions extends Readonly<Record<string, unknown>>>(
	value: Extensions | undefined,
): Extensions {
	if (value === undefined) return Object.freeze({}) as Extensions;
	record.assert(value, 'Problem occurrence extensions');
	return record.snapshot(value, 'Problem occurrence extensions');
}

/** Validate definition extension values against the optional Standard Schema contract. */
export async function validateExtensions<Definition extends ProblemDefinition>(
	definition: Definition,
	value: unknown,
): Promise<readonly StandardSchemaV1.Issue[]> {
	const schema = definition.extensions?.schema;
	if (!schema) return Object.freeze([]);
	const result = await schema['~standard'].validate(value);
	return Object.freeze(result.issues ? [...result.issues] : []);
}

/**
 * Rejects invalid definition before it can enter authoritative module state.
 *
 * It keeps RFC 9457 problem representation separate from domain failure identity and server-framework execution.
 *
 * @internal
 */
function assertDefinition(input: ProblemDefinitionInput<ProblemExtensionContract | undefined, ProblemStatus>): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(input.id)) throw new TypeError(`Invalid problem id ${JSON.stringify(input.id)}.`);
	let type: URL;
	try {
		type = new URL(input.type);
	} catch {
		throw new TypeError(`Problem type ${JSON.stringify(input.type)} must be an absolute URI.`);
	}
	if (!type.protocol) throw new TypeError('Problem type must be absolute.');
	if (!Number.isInteger(input.status) || input.status < 400 || input.status > 599) {
		throw new TypeError(`Problem status ${input.status} must be an HTTP error status.`);
	}
	if (input.title.trim().length === 0) throw new TypeError('Problem title cannot be empty.');
	if (input.description.trim().length === 0) throw new TypeError('Problem description cannot be empty.');
}

export { problemCatalog as catalog };
export type {
	CreateProblemOptions,
	ProblemBody,
	ProblemDefinition,
	ProblemDefinitionInput,
	ProblemDocument,
	ProblemExample,
	ProblemExtensionContract,
	ProblemHeaders,
	ProblemProviderMetadata,
	ProblemResult,
	ProblemResultMetadata,
	ProblemRetryPolicy,
	ProblemSeverity,
	ProblemStatus,
} from './types.ts';
