import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as recordCore from '@okikio/collection/record';

import { EnvironmentError, EnvironmentValidatorError } from './error.ts';
import { isSource, record } from './source.ts';
import type {
	EnvironmentDefinition,
	EnvironmentField,
	EnvironmentFieldKind,
	EnvironmentFieldMetadata,
	EnvironmentFields,
	EnvironmentIssue,
	EnvironmentParseResult,
	EnvironmentRequirement,
	EnvironmentRequirementField,
	EnvironmentSource,
	EnvironmentSourceInput,
	InferEnvironmentFields,
} from './types.ts';

/** Fields carried by a tuple of composed environment definitions. */
export type ComposeEnvironmentFields<Definitions extends readonly EnvironmentDefinition[]> = Definitions extends
	readonly [
		infer Head extends EnvironmentDefinition,
		...infer Tail extends readonly EnvironmentDefinition[],
	] ? Head['fields'] & ComposeEnvironmentFields<Tail>
	: Record<never, never>;

/**
 * Borrow an existing get() source or snapshot a plain record for this parse.
 *
 * @internal
 */
function source(input: EnvironmentSourceInput): EnvironmentSource {
	return isSource(input) ? input : record(input);
}

/**
 * Return whether a validation result is promise-like without depending on one schema library.
 *
 * @internal
 */
function isPromiseLike<Value>(value: Value | PromiseLike<Value>): value is PromiseLike<Value> {
	return typeof value === 'object' && value !== null && 'then' in value &&
		typeof (value as PromiseLike<Value>).then === 'function';
}

/**
 * Normalize a Standard Schema issue path into plain property keys.
 *
 * @internal
 */
function issuePath(issue: StandardSchemaV1.Issue): readonly PropertyKey[] | undefined {
	if (!issue.path) return undefined;
	return issue.path.map((segment) =>
		typeof segment === 'object' && segment !== null && 'key' in segment ? segment.key : segment
	);
}

/**
 * Keep the authored field key and missing/invalid category, redacting secret
 * validator messages and paths that could embed the raw value.
 *
 * @internal
 */
function normalizeIssue(
	key: string,
	rawValue: string | undefined,
	issue: StandardSchemaV1.Issue,
	secret: boolean,
): EnvironmentIssue {
	const path = secret ? undefined : issuePath(issue);
	return {
		key,
		message: secret ? 'Invalid secret value.' : issue.message,
		...(path ? { path } : {}),
		source: rawValue === undefined ? 'missing' : 'invalid',
	};
}

/**
 * Create a canonical environment field while preserving the supplied schema.
 *
 * This low-level constructor is used by the Standard Schema, Zod, and Valibot
 * entrypoints after each adapter has normalized its metadata. Most callers use
 * `env.variable()` or `env.secret()` instead.
 */
export function defineEnvironmentField<
	const Schema extends StandardSchemaV1,
	const Kind extends EnvironmentFieldKind,
>(kind: Kind, schema: Schema, metadata: EnvironmentFieldMetadata): EnvironmentField<Schema, Kind> {
	if (metadata.description.trim().length === 0) {
		throw new TypeError('Environment field descriptions cannot be empty.');
	}
	if (kind === 'secret' && metadata.example !== undefined) {
		throw new TypeError('Secret environment fields cannot include example values.');
	}

	// Definitions are the small, static values for which freezing communicates a
	// real invariant. Runtime sources and parsed configuration remain ordinary
	// values and are not recursively frozen.
	return Object.freeze({
		kind,
		schema,
		metadata: Object.freeze({
			...metadata,
			...(metadata.availability ? { availability: Object.freeze([...metadata.availability]) } : {}),
		}),
	});
}

/**
 * Describe one ordinary setting and the validator that reads its raw text.
 * The required description appears in manifests and generated configuration examples;
 * it is not a runtime value or a default. Put defaults and coercion in the schema
 * so every source uses the same rule. Defining a field reads no environment values.
 */
export function variable<const Schema extends StandardSchemaV1>(
	schema: Schema,
	metadata: EnvironmentFieldMetadata,
): EnvironmentField<Schema, 'variable'> {
	return defineEnvironmentField('variable', schema, metadata);
}

/** Define protected secret material with an explicit Standard Schema contract. */
export function secret<const Schema extends StandardSchemaV1>(
	schema: Schema,
	metadata: EnvironmentFieldMetadata,
): EnvironmentField<Schema, 'secret'> {
	return defineEnvironmentField('secret', schema, metadata);
}

/**
 * Read and validate declared fields sequentially, accumulating expected input issues.
 * A validator defect aborts parsing rather than becoming invalid configuration.
 * Secret validator causes are omitted; source.get() failures remain source-owned.
 *
 * @internal
 */
async function parseFields<Fields extends EnvironmentFields>(
	fields: Fields,
	keys: readonly string[],
	sourceInput: EnvironmentSourceInput,
): Promise<EnvironmentParseResult<InferEnvironmentFields<Fields>>> {
	const values = source(sourceInput);
	const entries: Array<
		| Readonly<{ key: string; value: unknown }>
		| Readonly<{ key: string; issues: readonly EnvironmentIssue[] }>
	> = [];
	for (const key of keys) {
		const field = fields[key]!;
		const rawValue = values.get(key);
		try {
			const result = await field.schema['~standard'].validate(rawValue);
			if (result.issues) {
				entries.push({
					key,
					issues: result.issues.map((issue) => normalizeIssue(key, rawValue, issue, field.kind === 'secret')),
				});
				continue;
			}
			entries.push({ key, value: result.value });
		} catch (cause) {
			throw new EnvironmentValidatorError(key, field.kind === 'secret' ? undefined : cause);
		}
	}

	const issues: EnvironmentIssue[] = [];
	for (const entry of entries) {
		if ('issues' in entry && entry.issues) issues.push(...entry.issues);
	}
	if (issues.length > 0) return { success: false, issues };

	return {
		success: true,
		value: Object.fromEntries(
			entries.flatMap((entry) => 'value' in entry ? [[entry.key, entry.value] as const] : []),
		) as InferEnvironmentFields<Fields>,
	};
}

/**
 * Validate without awaiting. A thenable is observed to avoid an unhandled
 * rejection, but it becomes an issue directing the caller to asynchronous parse.
 * Secret issues are redacted; unexpected validator exceptions still throw.
 *
 * @internal
 */
function parseFieldsSync<Fields extends EnvironmentFields>(
	fields: Fields,
	keys: readonly string[],
	sourceInput: EnvironmentSourceInput,
): EnvironmentParseResult<InferEnvironmentFields<Fields>> {
	const values = source(sourceInput);
	const parsed = new Map<string, unknown>();
	const issues: EnvironmentIssue[] = [];

	for (const key of keys) {
		const field = fields[key]!;
		const rawValue = values.get(key);
		try {
			const result = field.schema['~standard'].validate(rawValue);
			if (isPromiseLike(result)) {
				// The validator has already started. Observe rejection while refusing sync use.
				void Promise.resolve(result).catch(() => {});
				issues.push({
					key,
					message: 'This field validates asynchronously. Use environment.parse() instead of parseSync().',
					source: 'invalid',
				});
				continue;
			}
			if (result.issues) {
				issues.push(...result.issues.map((issue) => normalizeIssue(key, rawValue, issue, field.kind === 'secret')));
				continue;
			}
			parsed.set(key, result.value);
		} catch (cause) {
			throw new EnvironmentValidatorError(key, field.kind === 'secret' ? undefined : cause);
		}
	}

	return issues.length > 0
		? { success: false, issues }
		: { success: true, value: Object.fromEntries(parsed) as InferEnvironmentFields<Fields> };
}

/** Snapshot environment fields without dropping any type-visible key. @internal */
function snapshotEnvironmentFields<const Fields extends EnvironmentFields>(fields: Fields): Fields {
	return recordCore.snapshot(fields, 'environment fields');
}

/** Return runtime field names; structural typing does not prove an exhaustive key set. @internal */
function environmentFieldKeys<const Fields extends EnvironmentFields>(
	fields: Fields,
): readonly string[] {
	return recordCore.keys(fields, 'environment fields');
}

/**
 * Create an import-safe definition from canonical environment fields.
 *
 * The definition describes and validates values; it does not decide where raw
 * strings come from. A host supplies `env.env`, `env.record(...)`, or
 * `env.merge(...)` when it starts.
 *
 * @example Standard Schema definition
 * ```ts
 * import * as env from '@okikio/env/standard';
 *
 * const ServiceEnvironment = env.define({
 *   PORT: env.variable(PortSchema, { description: 'HTTP listener port.' }),
 * });
 * ```
 */
export function define<const Fields extends EnvironmentFields>(fields: Fields): EnvironmentDefinition<Fields> {
	const fieldSnapshot = snapshotEnvironmentFields(fields);
	const keys = environmentFieldKeys(fieldSnapshot);

	return Object.freeze({
		fields: fieldSnapshot,
		keys,
		/**
		 * Await each field and return all parsed values, or throw EnvironmentError for input issues.
		 *
		 * @internal
		 */
		async parse(sourceInput: EnvironmentSourceInput): Promise<InferEnvironmentFields<Fields>> {
			const result = await parseFields(fieldSnapshot, keys, sourceInput);
			if (!result.success) throw new EnvironmentError('Environment validation failed.', result.issues);
			return result.value;
		},
		/**
		 * Parse synchronously; input issues and asynchronous validators produce EnvironmentError.
		 *
		 * @internal
		 */
		parseSync(sourceInput: EnvironmentSourceInput): InferEnvironmentFields<Fields> {
			const result = parseFieldsSync(fieldSnapshot, keys, sourceInput);
			if (!result.success) throw new EnvironmentError('Environment validation failed.', result.issues);
			return result.value;
		},
		/**
		 * Return expected input issues as data; source and validator defects still reject.
		 *
		 * @internal
		 */
		safeParse(sourceInput: EnvironmentSourceInput) {
			return parseFields(fieldSnapshot, keys, sourceInput);
		},
		/**
		 * Return synchronous input issues as data; source and validator defects still throw.
		 *
		 * @internal
		 */
		safeParseSync(sourceInput: EnvironmentSourceInput) {
			return parseFieldsSync(fieldSnapshot, keys, sourceInput);
		},
	});
}

/**
 * Compose definitions through canonical field identity.
 *
 * The same field object may be imported through several definitions and is
 * deduplicated. Different field objects using the same key are rejected because
 * choosing one would silently discard validation or deployment metadata.
 */
export function compose<const Definitions extends readonly EnvironmentDefinition[]>(
	...definitions: Definitions
): EnvironmentDefinition<ComposeEnvironmentFields<Definitions>> {
	const fields = new Map<string, EnvironmentField>();
	const issues: EnvironmentIssue[] = [];

	for (const definition of definitions) {
		for (const key of definition.keys) {
			const field = definition.fields[key]!;
			const existing = fields.get(key);
			if (existing === undefined) fields.set(key, field);
			else if (existing !== field) {
				issues.push({
					key,
					message: `Environment key ${key} was declared by different field objects. ` +
						'Import and reuse one canonical field definition.',
					source: 'conflict',
				});
			}
		}
	}

	if (issues.length > 0) {
		throw new EnvironmentError('Environment definition composition failed.', issues);
	}
	// The conflict check above proves that every key from every definition is
	// represented exactly once with its canonical field object. TypeScript cannot
	// infer that intersection from `Map`/`Object.fromEntries`, so this is the one
	// construction assertion at the composition seam.
	const composedFields = Object.fromEntries(fields) as ComposeEnvironmentFields<Definitions>;
	return define(composedFields);
}

/**
 * Attach operator-facing reasons to selected canonical fields.
 *
 * The returned value stores the actual field references rather than only their
 * string keys. Requirement reports can therefore distinguish unrelated
 * definitions that happen to use the same external name.
 */
export function requirement<
	const Fields extends EnvironmentFields,
	const Reasons extends Readonly<Partial<Record<Extract<keyof Fields, string>, string>>>,
>(id: string, definition: EnvironmentDefinition<Fields>, reasons: Reasons): EnvironmentRequirement<Fields> {
	if (id.trim().length === 0) throw new TypeError('Environment requirement ids cannot be empty.');

	const selected: EnvironmentRequirementField<Fields[keyof Fields]>[] = [];
	for (const [key, rawReason] of Object.entries(reasons)) {
		if (!Object.hasOwn(definition.fields, key)) {
			throw new TypeError(`Environment requirement ${id} references unknown key ${key}.`);
		}
		if (typeof rawReason !== 'string' || rawReason.trim().length === 0) {
			throw new TypeError(`Environment requirement ${id} must explain why ${key} is required.`);
		}
		selected.push({
			key,
			field: definition.fields[key] as Fields[keyof Fields],
			reason: rawReason,
		});
	}

	return Object.freeze({ id, environment: definition, fields: Object.freeze(selected) });
}
