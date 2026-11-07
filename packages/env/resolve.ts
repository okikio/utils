/** Resolve explicitly supplied configuration sources once and keep key-only provenance separate from secret values. @module */
import * as recordCore from '@okikio/collection/record';
import { isSource, record } from './source.ts';
import type {
	EnvironmentDefinition,
	EnvironmentFields,
	EnvironmentSourceInput,
	InferEnvironmentFields,
} from './types.ts';

/** Named source with an optional inventory for get-only sources. Names must not contain credentials. */
export interface SourceType {
	readonly name: string;
	readonly source: EnvironmentSourceInput;
	/** Required for complete unknown-key inspection when source only exposes get(). No ambient enumeration occurs. */
	readonly keys?: readonly string[];
}
/** Every source is read at most once for each declared key; explicit bounds protect both dimensions. */
export interface ResolveOptionsType {
	readonly maximumKeys: number;
	readonly maximumSources: number;
}
/** Key-only selection evidence. Schema-owned defaults/coercions are deliberately not guessed. */
export interface ProvenanceType {
	readonly key: string;
	readonly selected: 'source' | 'schema';
	readonly source?: string;
	readonly sourceIndex?: number;
	/** Lower-precedence sources that supplied concrete strings, in declaration order. */
	readonly shadowed: readonly number[];
	readonly deprecated: boolean;
	readonly replacement?: string;
}
/** A source failed to read a key. Cause/message are excluded because a source may include raw secret values. */
export class EnvironmentSourceError extends Error {
	/** Declared configuration key whose provider failed. */
	readonly key: string;
	/** Zero-based position in the caller's source list, in precedence order. */
	readonly sourceIndex: number;
	/** Retain only the key and source position; a provider error may contain a secret value. */
	constructor(key: string, sourceIndex: number) {
		super(`Environment source ${sourceIndex} could not read ${JSON.stringify(key)}.`);
		this.name = 'EnvironmentSourceError';
		this.key = key;
		this.sourceIndex = sourceIndex;
	}
}

/** Snapshot validated keys before parsing; later sources override only concrete strings, including blank strings. */
function capture(
	definition: EnvironmentDefinition,
	sources: readonly SourceType[],
	options: ResolveOptionsType,
): Readonly<
	{
		raw: Readonly<Record<string, string | undefined>>;
		provenance: readonly ProvenanceType[];
		unknown: readonly string[];
		inventoryComplete: boolean;
	}
> {
	for (const [name, value] of Object.entries(options)) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new TypeError(`${name} must be a non-negative safe integer.`);
		}
	}
	if (!Number.isSafeInteger(options.maximumKeys) || !Number.isSafeInteger(options.maximumSources)) {
		throw new TypeError('maximumKeys and maximumSources are required.');
	}
	if (definition.keys.length > options.maximumKeys || sources.length > options.maximumSources) {
		throw new RangeError('Environment resolution exceeds its key/source bound.');
	}
	const raw: Record<string, string | undefined> = Object.create(null);
	const providers = sources.map((source) => {
		if (typeof source.name !== 'string' || !source.name.length) {
			throw new TypeError('Environment source name is required.');
		}
		return isSource(source.source) ? source.source : record(source.source);
	});
	const unknown = new Set<string>();
	const known = new Set(definition.keys);
	// A get-only provider can answer declared keys without revealing all of its available keys.
	let inventoryComplete = true;
	for (const source of sources) {
		const keys = source.keys ?? (isSource(source.source) ? undefined : recordCore.keys(source.source));
		if (keys === undefined) {
			inventoryComplete = false;
			continue;
		}
		if (keys.length > options.maximumKeys) throw new RangeError('Environment source inventory exceeds maximumKeys.');
		for (const key of keys) {
			if (typeof key !== 'string') throw new TypeError('Environment inventory keys must be strings.');
			if (!known.has(key)) unknown.add(key);
			if (unknown.size > options.maximumKeys) {
				throw new RangeError('Unknown environment inventory exceeds maximumKeys.');
			}
		}
	}
	// Read every layer once, even after a winner is known, to report shadowed
	// sources. Unlike merge().get(), this inspection does not short-circuit.
	const provenance = definition.keys.map((key): ProvenanceType => {
		const supplied: number[] = [];
		for (let index = 0; index < providers.length; index++) {
			let value: unknown;
			try {
				value = providers[index]!.get(key);
			} catch {
				throw new EnvironmentSourceError(key, index);
			}
			if (value !== undefined && typeof value !== 'string') throw new EnvironmentSourceError(key, index);
			if (value !== undefined) {
				raw[key] = value;
				supplied.push(index);
			}
		}
		const index = supplied.pop();
		const field = definition.fields[key]!;
		return Object.freeze({
			key,
			selected: index === undefined ? 'schema' : 'source',
			...(index === undefined ? {} : { sourceIndex: index, source: sources[index]!.name }),
			shadowed: Object.freeze(supplied),
			deprecated: field.metadata.deprecated ?? false,
			...(field.metadata.replacement === undefined ? {} : { replacement: field.metadata.replacement }),
		});
	});
	return Object.freeze({
		raw: Object.freeze(raw),
		provenance: Object.freeze(provenance),
		unknown: Object.freeze([...unknown].sort()),
		inventoryComplete,
	});
}

/** Validate once from a fixed source snapshot. Returned values may contain secrets; provenance never contains values. */
export async function resolve<Fields extends EnvironmentFields>(
	definition: EnvironmentDefinition<Fields>,
	sources: readonly SourceType[],
	options: ResolveOptionsType,
): Promise<
	Readonly<{ readonly values: InferEnvironmentFields<Fields>; readonly provenance: readonly ProvenanceType[] }>
> {
	const snapshot = capture(definition, sources, options);
	const values = await definition.parse(snapshot.raw);
	return Object.freeze({ values, provenance: snapshot.provenance });
}

/** Inspect validation, shadowing, deprecation and supplied key inventories without returning any parsed/raw values. */
export async function inspect(
	definition: EnvironmentDefinition,
	sources: readonly SourceType[],
	options: ResolveOptionsType & Readonly<{ readonly unknownKeys: 'report' | 'reject' }>,
): Promise<
	Readonly<
		{
			readonly valid: boolean;
			readonly provenance: readonly ProvenanceType[];
			readonly unknown: readonly string[];
			readonly inventoryComplete: boolean;
			readonly issues: readonly Readonly<
				{ readonly key: string; readonly source: 'missing' | 'invalid' | 'conflict' }
			>[];
		}
	>
> {
	if (!['report', 'reject'].includes(options.unknownKeys)) throw new TypeError('Unknown environment key policy.');
	const snapshot = capture(definition, sources, {
		maximumKeys: options.maximumKeys,
		maximumSources: options.maximumSources,
	});
	if (options.unknownKeys === 'reject' && !snapshot.inventoryComplete) {
		throw new TypeError('Unknown-key rejection requires a complete source inventory.');
	}
	const result = await definition.safeParse(snapshot.raw);
	return Object.freeze({
		valid: result.success && (options.unknownKeys !== 'reject' || snapshot.unknown.length === 0),
		provenance: snapshot.provenance,
		unknown: snapshot.unknown,
		inventoryComplete: snapshot.inventoryComplete,
		issues: Object.freeze(
			result.success ? [] : result.issues.map((issue) => Object.freeze({ key: issue.key, source: issue.source })),
		),
	});
}
