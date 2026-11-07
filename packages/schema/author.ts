import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import * as recordCore from '@okikio/collection/record';
import * as jsonValues from '@okikio/collection/record/json';
import { hasIdentity, identify, jsonSchema, reject, SchemaValidationError } from './validation.ts';
import type { JsonReader, Reader } from './validation.ts';
import type { Input, Output } from './types.ts';

/** A synchronous schema accepted by native composition. Third-party and async validation remains available through parse(). */
export type Shape = Readonly<Record<string, Reader<unknown>>>;

/** Fields whose declared input permits omission. */
export type OptionalInputKeys<Fields extends Shape> = {
	[Key in keyof Fields]: undefined extends Input<Fields[Key]> ? Key : never;
}[keyof Fields];
/** Fields whose validated output may be absent. */
export type OptionalOutputKeys<Fields extends Shape> = {
	[Key in keyof Fields]: undefined extends Output<Fields[Key]> ? Key : never;
}[keyof Fields];
/** Input record inferred from an object schema, including optional properties. */
export type ObjectInput<Fields extends Shape> =
	& { [Key in Exclude<keyof Fields, OptionalInputKeys<Fields>>]: Input<Fields[Key]> }
	& { [Key in OptionalInputKeys<Fields>]?: Input<Fields[Key]> };
/** Output record inferred from an object schema, including optional properties. */
export type ObjectOutput<Fields extends Shape> =
	& { [Key in Exclude<keyof Fields, OptionalOutputKeys<Fields>>]: Output<Fields[Key]> }
	& { [Key in OptionalOutputKeys<Fields>]?: Output<Fields[Key]> };

/** Type-only shape identity keeps extension inference exact without exposing a mutable schema record. */
declare const objectShape: unique symbol;
/** Type-only policy identity keeps extension behavior aligned with its inferred result. */
declare const objectPolicy: unique symbol;
// These symbols have no runtime value. Type-only exports let declarations name
// the retained shape and policy without exposing mutable runtime metadata.
export type { objectPolicy, objectShape };
/** How an object validator treats undeclared own data properties. */
export type UnknownKeys = 'reject' | 'strip' | 'preserve';
/** Accept named interfaces and extra literal properties without weakening declared field types. */
export type UnknownInput<Policy extends UnknownKeys, Known = unknown> = Policy extends 'reject' ? Known
	: Known | (Known & Record<string, unknown>);
/** Only preserving objects expose undeclared values on output. */
export type UnknownOutput<Policy extends UnknownKeys> = Policy extends 'preserve' ? Record<string, unknown> : unknown;
/** Object reader retaining both its field definitions and unknown-key policy for exact extension. */
export interface ObjectReader<Fields extends Shape, Policy extends UnknownKeys = 'reject'>
	extends JsonReader<ObjectOutput<Fields> & UnknownOutput<Policy>, UnknownInput<Policy, ObjectInput<Fields>>> {
	/** Phantom field identity; the runtime retains the shape privately. */
	readonly [objectShape]: Fields;
	/** Phantom policy identity; no mutable runtime metadata is exposed. */
	readonly [objectPolicy]: Policy;
}
/** Extract a retained object schema shape or accept a directly authored shape. */
export type ObjectFields<Value extends Shape | ObjectReader<Shape, UnknownKeys>> = Value extends
	ObjectReader<infer Fields, UnknownKeys> ? Fields
	: Value extends Shape ? Value
	: never;
/** A directly authored shape starts strict; an existing reader retains its policy. */
export type ObjectPolicy<Value> = Value extends ObjectReader<Shape, infer Policy> ? Policy : 'reject';
/** Private snapshots support extension without letting callers mutate fields or reset policy accidentally. */
const objectDefinitions = new WeakMap<object, Readonly<{ fields: Shape; unknownKeys: UnknownKeys }>>();

/**
 * String constraints count Unicode code points, as JSON Schema does.
 *
 * A supplementary character such as an emoji counts once. Combining marks
 * remain separate code points; these limits do not count displayed graphemes.
 */
export interface StringOptions {
	/** Minimum length, inclusive; omitted means zero. */
	readonly minLength?: number;
	/** Maximum length, inclusive; omitted means unbounded. */
	readonly maxLength?: number;
	/**
	 * Pattern tested from index zero on every read without changing the caller's expression.
	 * Validation preserves its flags. JSON conversion requires Unicode `u` mode and
	 * rejects case-insensitive, multiline, dot-all, sticky and Unicode-set matching.
	 */
	readonly pattern?: RegExp;
}

/** Finite-number constraints. Infinity and NaN are always rejected. */
export interface NumberOptions {
	/** Require a safe integer instead of any finite number. */
	readonly integer?: boolean;
	/** Inclusive lower bound. */
	readonly minimum?: number;
	/** Inclusive upper bound. */
	readonly maximum?: number;
	/** Exclusive lower bound. */
	readonly exclusiveMinimum?: number;
	/** Exclusive upper bound. */
	readonly exclusiveMaximum?: number;
}

/** Object key policy. Rejection is the default so configuration misspellings stay visible. */
export interface ObjectOptions<Policy extends UnknownKeys = UnknownKeys> {
	/** Reject, strip, or retain undeclared own data keys. */
	readonly unknownKeys?: Policy;
}

/** Resolve an options value without treating an optional policy as a guarantee that it was supplied. */
export type ResolveObjectPolicy<Options, Default extends UnknownKeys> = Options extends object
	? 'unknownKeys' extends keyof Options
		? Extract<Options['unknownKeys'], UnknownKeys> | (undefined extends Options['unknownKeys'] ? Default : never)
	: Default
	: Default;

/** Internal JSON projection is evaluated per request so consumers receive independent documents. */
type Projection = (io: 'input' | 'output', options: StandardJSONSchemaV1.Options) => Record<string, unknown>;

/** Omission metadata belongs to the owned reader and never executes validators while producing a JSON Schema. */
const omissions = new WeakMap<object, Readonly<{ input: boolean; output: boolean }>>();

/** One validation owns this report budget; nested reads receive it explicitly, never through mutable global state. */
interface IssueBudget {
	/** Maximum retained issues at each native aggregate. */
	readonly maximumIssues: number;
	/** Maximum retained root-most path segments. */
	readonly maximumPathLength: number;
	/** Evidence was omitted or later invalid siblings were deliberately left unvisited. */
	truncated: boolean;
}
/** Exact native parser capability. Foreign callbacks remain opaque even if they use our vendor string. */
const nativeReaders = new WeakMap<object, (value: unknown, budget: IssueBudget) => unknown>();

/** Per-invocation recursion metadata never leaks into a concurrent or reentrant root parse. */
const recursiveReads = new WeakMap<IssueBudget, RecursionStateType>();

/** Mutable state belongs to one root validation, including its nested lazy reads. */
interface RecursionStateType {
	/** Each schema definition remembers the object roots already checked against its own bounds. */
	readonly checked: Map<object, Set<object>>;
	/** Active lazy calls, restored in finally so failed reads cannot consume later depth. */
	depth: number;
}

/** Iterative traversal frame avoids using the JavaScript call stack for untrusted input. */
interface RecursiveFrameType {
	/** Active ancestor identity used to distinguish cycles from repeated sibling references. */
	readonly owner: object;
	/** Own keys captured without invoking property getters. */
	readonly keys: readonly string[];
	/** Next child to visit; advances before entering a nested frame. */
	index: number;
}

/** Bounds for recursive native schemas, independent of retained error-report limits. */
export interface RecursionOptionsType {
	/** Maximum nested plain-record/array depth and nested lazy calls, 1 through 128. */
	readonly maximumDepth: number;
	/** Maximum visited values, including leaves and repeated references. */
	readonly maximumNodes: number;
}

/**
 * Resolve a synchronous schema on its first validation, supporting self and
 * mutual recursion. A successful factory is cached; a factory failure propagates
 * and may be retried on a later invocation. It is never invoked by JSON Schema
 * inspection. Recursive projection is explicitly unsupported, rather than
 * expanding forever or fabricating a reference document.
 *
 * Before validation, iterative traversal rejects cycles, accessors and excess
 * nodes/depth in arrays and plain records. Shared acyclic references are valid
 * but count each visit. Other host values remain opaque leaves. This bounds
 * visited input values, not private validator allocations or Object.keys' own
 * key enumeration. Opaque foreign callbacks still own their internal traversal.
 */
export function lazy<Value, InputValue = Value>(
	factory: () => Reader<Value, InputValue>,
	options: RecursionOptionsType,
): JsonReader<Value, InputValue> {
	const { maximumDepth, maximumNodes } = options;
	if (
		!Number.isSafeInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 128 ||
		!Number.isSafeInteger(maximumNodes) || maximumNodes < 1
	) {
		throw new RangeError('Recursive schemas require maximumDepth 1..128 and positive maximumNodes.');
	}
	let resolved: Reader<Value, InputValue> | undefined;
	const definition: JsonReader<Value, InputValue> = build((value, policy) => {
		let state = recursiveReads.get(policy);
		if (state === undefined) {
			state = { checked: new Map(), depth: 0 };
			recursiveReads.set(policy, state);
		}
		if (state.depth >= maximumDepth) reject('Recursive schema exceeds maximumDepth.');
		let checked = state.checked.get(definition);
		if (checked === undefined) {
			checked = new Set();
			state.checked.set(definition, checked);
		}
		if (value === null || typeof value !== 'object' || !checked.has(value)) {
			checkRecursive(value, maximumDepth, maximumNodes, checked);
		}
		if (resolved === undefined) {
			const candidate = factory();
			if (candidate === definition || typeof candidate?.parse !== 'function') {
				throw new TypeError('Recursive schema factory must return a different synchronous reader.');
			}
			resolved = candidate;
		}
		state.depth++;
		try {
			return child(resolved, value, policy);
		} finally {
			state.depth--;
		}
	}, false);
	return definition;
}

/** DFS retains only an ancestor path and iterator frames; sibling count does not create a pending-node queue. */
function checkRecursive(value: unknown, maximumDepth: number, maximumNodes: number, checked: Set<object>): void {
	const visited = new Set<object>();
	const active = new WeakSet<object>();
	const stack: RecursiveFrameType[] = [];
	let current = value;
	let visits = 0;
	while (true) {
		if (++visits > maximumNodes) reject('Recursive input exceeds maximumNodes.');
		if (
			current !== null && typeof current === 'object' &&
			(Array.isArray(current) || Object.getPrototypeOf(current) === Object.prototype ||
				Object.getPrototypeOf(current) === null)
		) {
			if (active.has(current)) reject('Recursive input contains a cycle.');
			if (stack.length >= maximumDepth) reject('Recursive input exceeds maximumDepth.');
			active.add(current);
			visited.add(current);
			stack.push({ owner: current, keys: Object.keys(current), index: 0 });
		}
		let found = false;
		while (stack.length !== 0) {
			const frame = stack[stack.length - 1]!;
			if (frame.index === frame.keys.length) {
				active.delete(frame.owner);
				stack.pop();
				continue;
			}
			const descriptor = Object.getOwnPropertyDescriptor(frame.owner, frame.keys[frame.index++]!);
			if (descriptor === undefined || !('value' in descriptor)) reject('Recursive input requires own data properties.');
			current = descriptor.value;
			found = true;
			break;
		}
		if (!found) {
			for (const object of visited) checked.add(object);
			return;
		}
	}
}
/** Validate optional report limits before any authored callback runs. */
function budget(options?: StandardSchemaV1.Options): IssueBudget {
	const input = options as import('./validation.ts').ValidationOptionsType | undefined;
	for (const key of ['maximumIssues', 'maximumPathLength'] as const) {
		const value = input?.[key];
		if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
			throw new TypeError(`${key} must be a positive safe integer.`);
		}
	}
	return {
		maximumIssues: input?.maximumIssues ?? Infinity,
		maximumPathLength: input?.maximumPathLength ?? Infinity,
		truncated: false,
	};
}
/** Pass the invocation budget only to owned readers. Foreign synchronous readers keep their declared parse boundary. */
function child<Definition extends Reader<unknown>>(
	definition: Definition,
	value: unknown,
	budget: IssueBudget,
): Output<Definition> {
	const read = nativeReaders.get(definition);
	return (read === undefined ? definition.parse(value) : read(value, budget)) as Output<Definition>;
}
/** Bound each retained aggregate before copying child issues or paths. Prefixes retain the root-most evidence. */
function append(
	issues: StandardSchemaV1.Issue[],
	incoming: readonly StandardSchemaV1.Issue[],
	budget: IssueBudget,
	key?: string | number,
): void {
	for (let index = 0; index < incoming.length; index++) {
		if (issues.length >= budget.maximumIssues) {
			budget.truncated = true;
			break;
		}
		const issue = incoming[index]!;
		const source = issue.path;
		const length = (source?.length ?? 0) + (key === undefined ? 0 : 1);
		if (length > budget.maximumPathLength) budget.truncated = true;
		const path = key === undefined
			? source?.slice(0, budget.maximumPathLength)
			: [key, ...(source?.slice(0, budget.maximumPathLength - 1) ?? [])];
		issues.push({ ...issue, ...(path === undefined ? {} : { path }) });
	}
}
/** After a known rejection fills the report, later sibling validation is deliberately skipped. */
function full(issues: readonly StandardSchemaV1.Issue[], budget: IssueBudget): boolean {
	if (issues.length < budget.maximumIssues) return false;
	budget.truncated = true;
	return true;
}

/**
 * Construct the native reader without executing any author callback.
 *
 * Validation and projection share the authored definition but stay independent:
 * an opaque guard still validates even though its converter must reject. Private
 * omission and identity metadata lets parent objects describe required fields
 * and lets codecs reuse unchanged outputs without probing a validator.
 */
function build<InputValue, OutputValue>(
	read: (value: unknown, budget: IssueBudget) => OutputValue,
	identity: boolean,
	project?: Projection,
	omission: Readonly<{ input: boolean; output: boolean }> = { input: false, output: false },
): JsonReader<OutputValue, InputValue> {
	const parse = (value: unknown): OutputValue => read(value, budget());
	const convert = (io: 'input' | 'output', options: StandardJSONSchemaV1.Options): Record<string, unknown> => {
		if (!['draft-2020-12', 'draft-07'].includes(options.target)) {
			throw new TypeError(`Unsupported JSON Schema target ${JSON.stringify(options.target)}.`);
		}
		if (project === undefined) throw new TypeError('This schema cannot be represented faithfully as JSON Schema.');
		return project(io, options);
	};
	const definition: JsonReader<OutputValue, InputValue> = Object.freeze({
		parse,
		'~standard': Object.freeze({
			version: 1 as const,
			vendor: 'okikio',
			/** Return only expected validation issues; implementation failures still throw. */
			validate(value: unknown, options?: StandardSchemaV1.Options): StandardSchemaV1.Result<OutputValue> {
				const policy = budget(options);
				try {
					return { value: read(value, policy) };
				} catch (error) {
					if (error instanceof SchemaValidationError) {
						const issues: StandardSchemaV1.Issue[] = [];
						append(issues, error.issues, policy);
						return { ...{ issues }, ...(policy.truncated ? { truncated: true } : {}) };
					}
					throw error;
				}
			},
			jsonSchema: Object.freeze({
				input: (options: StandardJSONSchemaV1.Options) => convert('input', options),
				output: (options: StandardJSONSchemaV1.Options) => convert('output', options),
			}),
		}),
	});
	nativeReaders.set(definition, read);
	omissions.set(definition, omission);
	return identity ? identify(definition) : definition;
}

/** Reject invalid authored bounds before they can make a validator inconsistent. */
function length(value: number | undefined, name: string): void {
	if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
		throw new TypeError(`${name} must be a non-negative safe integer.`);
	}
}

/** Count a surrogate pair once without allocating an array of every character. */
function codePointLength(value: string): number {
	let size = 0;
	for (let index = 0; index < value.length; size++) {
		index += value.codePointAt(index)! > 0xFFFF ? 2 : 1;
	}
	return size;
}

/** Validate a primitive string with an owned, repeatable pattern check. */
export function string(options: StringOptions = {}): JsonReader<string, string> {
	recordCore.assert(options, 'string options');
	const { minLength, maxLength } = options;
	length(minLength, 'minLength');
	length(maxLength, 'maxLength');
	if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
		throw new RangeError('minLength exceeds maxLength.');
	}
	const pattern = options.pattern === undefined ? undefined : new RegExp(options.pattern.source, options.pattern.flags);
	return build(
		(value) => {
			if (typeof value !== 'string') reject('Expected a string.');
			const size = minLength === undefined && maxLength === undefined ? 0 : codePointLength(value);
			if (minLength !== undefined && size < minLength) {
				reject(`Expected at least ${minLength} characters.`);
			}
			if (maxLength !== undefined && size > maxLength) {
				reject(`Expected at most ${maxLength} characters.`);
			}
			if (pattern !== undefined) {
				pattern.lastIndex = 0;
				if (!pattern.test(value)) reject(`String does not match ${pattern.source}.`);
			}
			return value;
		},
		true,
		() => {
			if (
				pattern !== undefined &&
				(!pattern.unicode || pattern.ignoreCase || pattern.multiline || pattern.dotAll || pattern.sticky)
			) {
				throw new TypeError(
					'JSON Schema patterns require Unicode u mode without i, m, s, v or y flags; validation still preserves the authored RegExp.',
				);
			}
			return {
				type: 'string',
				...(minLength === undefined ? {} : { minLength }),
				...(maxLength === undefined ? {} : { maxLength }),
				...(pattern === undefined ? {} : { pattern: pattern.source }),
			};
		},
	);
}

/** Validate one finite number and optional exact bounds. */
export function number(options: NumberOptions = {}): JsonReader<number, number> {
	recordCore.assert(options, 'number options');
	const { integer, minimum, maximum, exclusiveMinimum, exclusiveMaximum } = options;
	if (integer !== undefined && typeof integer !== 'boolean') throw new TypeError('integer must be a boolean.');
	for (const bound of [minimum, maximum, exclusiveMinimum, exclusiveMaximum]) {
		if (bound !== undefined && !Number.isFinite(bound)) throw new TypeError('Number bounds must be finite.');
	}
	if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
		throw new RangeError('minimum exceeds maximum.');
	}
	return build(
		(value) => {
			if (typeof value !== 'number' || !Number.isFinite(value)) reject('Expected a finite number.');
			if (integer && !Number.isSafeInteger(value)) reject('Expected a safe integer.');
			if (
				minimum !== undefined && value < minimum || maximum !== undefined && value > maximum ||
				exclusiveMinimum !== undefined && value <= exclusiveMinimum ||
				exclusiveMaximum !== undefined && value >= exclusiveMaximum
			) {
				reject('Number is outside the permitted range.');
			}
			return value;
		},
		true,
		() => ({
			type: integer ? 'integer' : 'number',
			// Authored bounds can narrow the safe-integer range, but cannot widen it.
			...(integer
				? {
					minimum: Math.max(Number.MIN_SAFE_INTEGER, minimum ?? Number.MIN_SAFE_INTEGER),
					maximum: Math.min(Number.MAX_SAFE_INTEGER, maximum ?? Number.MAX_SAFE_INTEGER),
				}
				: {
					...(minimum === undefined ? {} : { minimum }),
					...(maximum === undefined ? {} : { maximum }),
				}),
			...(exclusiveMinimum === undefined ? {} : { exclusiveMinimum }),
			...(exclusiveMaximum === undefined ? {} : { exclusiveMaximum }),
		}),
	);
}

/** Accept only a boolean, without truthiness coercion. */
export function boolean(): JsonReader<boolean, boolean> {
	return build(
		(value) => {
			if (typeof value !== 'boolean') reject('Expected a boolean.');
			return value;
		},
		true,
		() => ({ type: 'boolean' }),
	);
}

/** Accept every value and retain the caller's payload ownership. */
export function unknown(): JsonReader<unknown> {
	return build((value) => value, true, () => ({}), { input: true, output: true });
}

/** Accept a valid Date instance and borrow it; use schema/time for an ISO wire representation. */
export function date(): JsonReader<Date, Date> {
	return build((value) => {
		if (!(value instanceof Date) || !Number.isFinite(value.getTime())) reject('Expected a valid Date.');
		return value;
	}, true);
}

/** Accept one exact primitive value. Signed zero follows JSON numeric equality. */
export function literal<const Value extends string | number | boolean | null | undefined>(
	expected: Value,
): JsonReader<Value, Value> {
	if (typeof expected === 'number' && !Number.isFinite(expected)) {
		throw new TypeError('Numeric literals must be finite.');
	}
	return build(
		(value) => {
			if (value !== expected) reject(`Expected literal ${String(expected)}; received ${typeof value}.`);
			return expected;
		},
		true,
		expected === undefined ? undefined : () => ({ const: expected }),
		{ input: expected === undefined, output: expected === undefined },
	);
}

/** Accept one member of a nonempty, snapshotted primitive set. */
export function oneOf<
	const Values extends readonly [string | number | boolean | null, ...(string | number | boolean | null)[]],
>(values: Values): JsonReader<Values[number], Values[number]> {
	// Duplicate authored choices do not change membership; draft 07 requires a unique enum.
	const owned = [...new Set(values)];
	if (
		owned.length === 0 ||
		owned.some((value) =>
			value !== null && !['string', 'number', 'boolean'].includes(typeof value) ||
			typeof value === 'number' && !Number.isFinite(value)
		)
	) throw new TypeError('oneOf requires finite primitive choices.');
	return build(
		(value) => {
			if (!owned.includes(value as Values[number])) reject('Value is not one of the declared choices.');
			return value as Values[number];
		},
		true,
		() => ({ enum: [...owned] }),
	);
}

/** Make undefined a present value, while object schemas may omit that property altogether. */
export function optional<Definition extends Reader<unknown>>(
	definition: Definition,
): JsonReader<Output<Definition> | undefined, Input<Definition> | undefined> {
	return build(
		(value, policy) => value === undefined ? undefined : child(definition, value, policy) as Output<Definition>,
		hasIdentity(definition),
		(io, options) => jsonSchema(definition, io, options),
		{ input: true, output: true },
	);
}

/** Add null without conflating it with undefined or an omitted property. */
export function nullable<Definition extends Reader<unknown>>(
	definition: Definition,
): JsonReader<Output<Definition> | null, Input<Definition> | null> {
	return build(
		(value, policy) => value === null ? null : child(definition, value, policy) as Output<Definition>,
		hasIdentity(definition),
		(io, options) => ({ anyOf: [jsonSchema(definition, io, options), { type: 'null' }] }),
		omissions.get(definition),
	);
}

/** Supply a freshly obtained default only for undefined, then validate it with every original constraint. */
export function defaults<Definition extends Reader<unknown>>(
	definition: Definition,
	supply: () => Input<Definition>,
): JsonReader<Output<Definition>, Input<Definition> | undefined> {
	return build(
		(value, policy) => child(definition, value === undefined ? supply() : value, policy) as Output<Definition>,
		hasIdentity(definition),
		(io, options) => jsonSchema(definition, io, options),
		{ input: true, output: omissions.get(definition)?.output ?? false },
	);
}

/** Add a predicate without mutating child issues. Arbitrary predicates deliberately have no JSON Schema projection. */
export function refine<Definition extends Reader<unknown>>(
	definition: Definition,
	predicate: (value: Output<Definition>) => boolean,
	message: string,
): JsonReader<Output<Definition>, Input<Definition>> {
	return build((value, policy) => {
		const parsed = child(definition, value, policy) as Output<Definition>;
		if (!predicate(parsed)) reject(message);
		return parsed;
	}, hasIdentity(definition));
}

/**
 * Transform a validated output without assuming the callback is invertible.
 * Input projection describes the source before this callback, which may still
 * reject. It never runs the callback, and output conversion remains unsupported.
 * Author an explicit codec inverse before transporting transformed values.
 */
export function transform<Definition extends Reader<unknown>, Next>(
	definition: Definition,
	convert: (value: Output<Definition>) => Next & (Extract<Next, PromiseLike<unknown>> extends never ? unknown : never),
): JsonReader<Next, Input<Definition>> {
	return build(
		(value, policy) => {
			const output = convert(child(definition, value, policy) as Output<Definition>);
			if (
				output !== null && (typeof output === 'object' || typeof output === 'function') &&
				typeof (output as { then?: unknown }).then === 'function'
			) {
				void Promise.resolve(output).catch(() => undefined);
				throw new TypeError('A synchronous transform returned a Promise; use defineAsync().');
			}
			return output;
		},
		false,
		(io, options) => {
			if (io === 'output') throw new TypeError('A transformed output requires an explicit JSON Schema projection.');
			return jsonSchema(definition, 'input', options);
		},
		{ input: omissions.get(definition)?.input ?? false, output: false },
	);
}

/** Prefix a child's copied rejection path and retain all independent property failures. */
function property<Definition extends Reader<unknown>>(
	definition: Definition,
	value: unknown,
	key: string | number,
	issues: StandardSchemaV1.Issue[],
	policy: IssueBudget,
): Output<Definition> | undefined {
	try {
		return child(definition, value, policy) as Output<Definition>;
	} catch (error) {
		if (!(error instanceof SchemaValidationError)) throw error;
		append(issues, error.issues, policy, key);
		return undefined;
	}
}

/**
 * Create fresh data records using an explicit unknown-key policy.
 *
 * The default rejects unknown keys so authored configuration misspellings stay
 * visible. Use preserve for evolving external records, or strip to select known
 * fields from those records. All policies still validate declared fields and
 * reject ordinary accessor-backed input without invoking its getters. Proxy
 * traps can still run during inspection. Output containers are fresh; arbitrary
 * preserved fields and leaf values remain borrowed.
 */
export function object<const Fields extends Shape>(fields: Fields): ObjectReader<Fields, 'reject'>;
/** Explicit or optional options retain the exact declared policy and any possible default. */
export function object<const Fields extends Shape, const Options extends ObjectOptions | undefined>(
	fields: Fields,
	options: Options,
): ObjectReader<Fields, ResolveObjectPolicy<Options, 'reject'>>;
export function object<const Fields extends Shape>(
	fields: Fields,
	options: ObjectOptions = {},
): ObjectReader<Fields, UnknownKeys> {
	recordCore.assert(fields, 'schema shape');
	recordCore.assert(options, 'object options');
	const entries = Object.entries(fields);
	const names = new Set(entries.map(([key]) => key));
	const policy = options.unknownKeys ?? 'reject';
	if (!['reject', 'strip', 'preserve'].includes(policy)) throw new TypeError('Invalid unknown-key policy.');
	for (const [, definition] of entries) {
		if (typeof definition.parse !== 'function') {
			throw new TypeError('Object fields require synchronous owned readers.');
		}
	}
	const definition = build<ObjectInput<Fields>, ObjectOutput<Fields>>(
		(value, report) => {
			if (!recordCore.is(value)) reject('Expected an object containing own enumerable data properties.');
			const output: Record<string, unknown> = Object.create(null);
			const issues: StandardSchemaV1.Issue[] = [];
			// Check extra fields separately from declared fields. Stripping a field
			// must not accidentally skip a missing required field or its default.
			for (const key of Object.keys(value)) {
				if (full(issues, report)) break;
				if (!names.has(key)) {
					if (policy === 'reject') append(issues, [{ message: 'Unknown object property.', path: [key] }], report);
					else if (policy === 'preserve') output[key] = value[key];
				}
			}
			for (const [key, definition] of entries) {
				if (full(issues, report)) break;
				const present = Object.hasOwn(value, key);
				const parsed = property(definition, present ? value[key] : undefined, key, issues, report);
				// Preserve explicit undefined, but keep an omitted optional field absent.
				// A default produces a value and therefore creates the output field.
				if (present || parsed !== undefined) output[key] = parsed;
			}
			if (issues.length > 0) throw new SchemaValidationError(issues);
			return output as ObjectOutput<Fields>;
		},
		entries.every(([, definition]) => hasIdentity(definition)),
		(io, projectionOptions) => {
			const properties: Record<string, unknown> = Object.create(null);
			const required: string[] = [];
			for (const [key, definition] of entries) {
				properties[key] = jsonSchema(definition, io, projectionOptions);
				if (!(omissions.get(definition)?.[io] ?? false)) required.push(key);
			}
			return {
				type: 'object',
				properties,
				required,
				// Stripping accepts extra input but removes those properties from its output.
				additionalProperties: policy === 'preserve' || io === 'input' && policy === 'strip',
			};
		},
	);
	objectDefinitions.set(definition, { fields: Object.freeze(Object.fromEntries(entries)), unknownKeys: policy });
	return definition as ObjectReader<Fields, UnknownKeys>;
}

/**
 * Extend a shape while retaining its unknown-key policy unless explicitly replaced.
 *
 * Added fields replace overlapping fields in both the inferred type and runtime
 * checks. Extending a plain shape uses the same strict default as object().
 */
export function extend<
	const Base extends Shape | ObjectReader<Shape, UnknownKeys>,
	const Added extends Shape,
>(base: Base, added: Added): ObjectReader<Omit<ObjectFields<Base>, keyof Added> & Added, ObjectPolicy<Base>>;
/** An omitted replacement policy keeps the base policy, even when the options type names another policy. */
export function extend<
	const Base extends Shape | ObjectReader<Shape, UnknownKeys>,
	const Added extends Shape,
	const Options extends ObjectOptions | undefined,
>(
	base: Base,
	added: Added,
	options: Options,
): ObjectReader<Omit<ObjectFields<Base>, keyof Added> & Added, ResolveObjectPolicy<Options, ObjectPolicy<Base>>>;
export function extend<
	const Base extends Shape | ObjectReader<Shape, UnknownKeys>,
	const Added extends Shape,
>(
	base: Base,
	added: Added,
	options: ObjectOptions = {},
): ObjectReader<Omit<ObjectFields<Base>, keyof Added> & Added, UnknownKeys> {
	const retained = objectDefinitions.get(base);
	const shape = retained?.fields ?? base;
	recordCore.assert(shape, 'base shape');
	recordCore.assert(added, 'added shape');
	recordCore.assert(options, 'object options');
	const fields = { ...shape, ...added } as Omit<ObjectFields<Base>, keyof Added> & Added;
	const unknownKeys = options.unknownKeys ?? retained?.unknownKeys ?? 'reject';
	return object(fields, { unknownKeys });
}

/** Validate a dense array and return a fresh plain array with numeric issue paths. */
export function array<Definition extends Reader<unknown>>(
	definition: Definition,
	options: Readonly<{ minLength?: number; maxLength?: number }> = {},
): JsonReader<Output<Definition>[], Input<Definition>[]> {
	recordCore.assert(options, 'array options');
	const { minLength, maxLength } = options;
	length(minLength, 'minLength');
	length(maxLength, 'maxLength');
	if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
		throw new RangeError('minLength exceeds maxLength.');
	}
	return build(
		(value, policy) => {
			if (!Array.isArray(value)) reject('Expected an array.');
			if (
				minLength !== undefined && value.length < minLength || maxLength !== undefined && value.length > maxLength
			) reject('Array length is outside the permitted range.');
			const output: Output<Definition>[] = [];
			const issues: StandardSchemaV1.Issue[] = [];
			for (let index = 0; index < value.length; index++) {
				if (full(issues, policy)) break;
				const descriptor = Object.getOwnPropertyDescriptor(value, index);
				if (descriptor === undefined || !('value' in descriptor)) {
					append(issues, [{ message: 'Expected an own array data element.', path: [index] }], policy);
				} else output.push(property(definition, descriptor.value, index, issues, policy) as Output<Definition>);
			}
			if (issues.length > 0) throw new SchemaValidationError(issues);
			return output;
		},
		hasIdentity(definition),
		(io, projectionOptions) => ({
			type: 'array',
			items: jsonSchema(definition, io, projectionOptions),
			...(minLength === undefined ? {} : { minItems: minLength }),
			...(maxLength === undefined ? {} : { maxItems: maxLength }),
		}),
	);
}

/** Validate an exact-length tuple, preserving each position's input and output. */
export function tuple<const Definitions extends readonly Reader<unknown>[]>(
	definitions: Definitions,
): JsonReader<
	{ -readonly [Key in keyof Definitions]: Output<Definitions[Key]> },
	{ -readonly [Key in keyof Definitions]: Input<Definitions[Key]> }
> {
	const owned = [...definitions];
	return build(
		(value, policy) => {
			if (!Array.isArray(value) || value.length !== owned.length) {
				reject(`Expected a tuple of length ${owned.length}.`);
			}
			const issues: StandardSchemaV1.Issue[] = [];
			const output = owned.map((definition, index) => {
				if (full(issues, policy)) return undefined;
				const descriptor = Object.getOwnPropertyDescriptor(value, index);
				if (descriptor === undefined || !('value' in descriptor)) {
					append(issues, [{ message: 'Expected an own tuple data element.', path: [index] }], policy);
					return undefined;
				}
				return property(definition, descriptor.value, index, issues, policy);
			});
			if (issues.length > 0) throw new SchemaValidationError(issues);
			return output as { -readonly [Key in keyof Definitions]: Output<Definitions[Key]> };
		},
		owned.every(hasIdentity),
		(io, options) => {
			// Both drafts require a nonempty positional schema list. An empty tuple
			// needs only the array type and a zero length limit.
			if (owned.length === 0) return { type: 'array', maxItems: 0 };
			const items = owned.map((definition) => jsonSchema(definition, io, options));
			return options.target === 'draft-07'
				? { type: 'array', items, additionalItems: false, minItems: owned.length, maxItems: owned.length }
				: { type: 'array', prefixItems: items, items: false, minItems: owned.length, maxItems: owned.length };
		},
	);
}

/** Try branches in authored order and retain their independent issues if none accepts. */
export function union<const Definitions extends readonly [Reader<unknown>, ...Reader<unknown>[]]>(
	definitions: Definitions,
): JsonReader<Output<Definitions[number]>, Input<Definitions[number]>> {
	const owned = [...definitions];
	if (owned.length === 0) throw new TypeError('A union needs at least one branch.');
	return build(
		(value, policy) => {
			const issues: StandardSchemaV1.Issue[] = [];
			// A failed earlier branch may exhaust its report budget, but cannot prevent
			// a later branch from accepting. Discard earlier truncation on success.
			const before = policy.truncated;
			for (const definition of owned) {
				try {
					const valueRead = child(definition, value, policy) as Output<Definitions[number]>;
					policy.truncated = before;
					return valueRead;
				} catch (error) {
					if (!(error instanceof SchemaValidationError)) throw error;
					append(issues, error.issues, policy);
				}
			}
			throw new SchemaValidationError(issues);
		},
		owned.every(hasIdentity),
		(io, options) => ({ anyOf: owned.map((definition) => jsonSchema(definition, io, options)) }),
		{
			input: owned.some((definition) => omissions.get(definition)?.input),
			output: owned.some((definition) => omissions.get(definition)?.output),
		},
	);
}

/** Validate string-keyed dictionaries. Finite key rules do not imply every possible key is present. */
export function record<KeySchema extends Reader<string>, ValueSchema extends Reader<unknown>>(
	key: KeySchema,
	value: ValueSchema,
): JsonReader<
	Partial<Record<Output<KeySchema>, Output<ValueSchema>>>,
	Partial<Record<Input<KeySchema> & string, Input<ValueSchema>>>
> {
	return build(
		(input, policy) => {
			if (!recordCore.is(input)) reject('Expected a record containing own enumerable data properties.');
			const output: Record<string, unknown> = Object.create(null);
			const issues: StandardSchemaV1.Issue[] = [];
			for (const name of Object.keys(input)) {
				if (full(issues, policy)) break;
				const parsedKey = property(key, name, name, issues, policy);
				const parsedValue = property(value, input[name], name, issues, policy);
				if (parsedKey !== undefined) {
					if (Object.hasOwn(output, parsedKey)) {
						append(issues, [{ message: 'Transformed record keys collide.', path: [name] }], policy);
					} else output[parsedKey] = parsedValue;
				}
			}
			if (issues.length > 0) throw new SchemaValidationError(issues);
			return output as Partial<Record<Output<KeySchema>, Output<ValueSchema>>>;
		},
		hasIdentity(key) && hasIdentity(value),
		(io, options) => ({
			type: 'object',
			propertyNames: jsonSchema(key, io, options),
			additionalProperties: jsonSchema(value, io, options),
		}),
	);
}

/** Explicit primitive conversion retains the accepted input type for every builder. */
export interface Coercion {
	/** Convert finite numbers and nonempty decimal strings before applying numeric constraints. */
	number(options?: NumberOptions): JsonReader<number, string | number>;
	/** Convert strings, finite numbers and booleans without invoking object conversion methods. */
	string(options?: StringOptions): JsonReader<string, string | number | boolean>;
	/** Accept true, false, "true" and "false", rather than arbitrary truthy values. */
	boolean(): JsonReader<boolean, boolean | 'true' | 'false'>;
}

/** Explicit coercion accepts only documented primitive sources; objects never execute custom conversion methods. */
export const coerce: Readonly<Coercion> = Object.freeze({
	/** Convert a finite number or nonempty decimal string, then apply ordinary numeric constraints. */
	number(options: NumberOptions = {}): JsonReader<number, string | number> {
		const target = number(options);
		return build(
			(value, policy) => {
				if (typeof value === 'string') {
					if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
						reject('Expected a decimal numeric string.');
					}
					return child(target, Number(value), policy);
				}
				return child(target, value, policy);
			},
			false,
			(io, options) => {
				if (io === 'input') {
					throw new TypeError('Numeric coercion constraints cannot be represented faithfully as JSON Schema input.');
				}
				return jsonSchema(target, 'output', options);
			},
		);
	},
	/** Convert string, finite number, or boolean explicitly. Nullish values and objects reject. */
	string(options: StringOptions = {}): JsonReader<string, string | number | boolean> {
		const target = string(options);
		return build(
			(value, policy) => {
				if (
					typeof value !== 'string' && typeof value !== 'boolean' &&
					!(typeof value === 'number' && Number.isFinite(value))
				) reject('Expected a string, finite number, or boolean.');
				return child(target, String(value), policy);
			},
			false,
			(io, options) => {
				if (io === 'input') {
					throw new TypeError('String coercion constraints cannot be represented faithfully as JSON Schema input.');
				}
				return jsonSchema(target, 'output', options);
			},
		);
	},
	/** Convert true/false and the exact strings "true"/"false"; never use truthiness. */
	boolean(): JsonReader<boolean, boolean | 'true' | 'false'> {
		return build(
			(value) => {
				if (value === true || value === 'true') return true;
				if (value === false || value === 'false') return false;
				reject('Expected true or false.');
			},
			false,
			(io) => io === 'input' ? { enum: [true, false, 'true', 'false'] } : { type: 'boolean' },
		);
	},
});

/** Validate finite JSON data with explicit depth and node limits, returning containers with no borrowed references. */
export function json(options: jsonValues.Options = {}): JsonReader<jsonValues.Value, jsonValues.Value> {
	recordCore.assert(options, 'JSON options');
	const policy = { ...options };
	jsonValues.copy(null, policy);
	return build(
		(value) => {
			try {
				return jsonValues.copy(value, policy);
			} catch (error) {
				if (error instanceof TypeError || error instanceof RangeError) reject(error.message);
				throw error;
			}
		},
		true,
		() => ({}),
	);
}

/** Expose a precise type guard as an owned identity validator. The predicate validates but must not transform its input. */
export function guard<Value>(
	predicate: (value: unknown) => value is Value,
	message = 'Value does not satisfy the declared guard.',
): JsonReader<Value, Value> {
	return build((value) => {
		if (!predicate(value)) reject(message);
		return value;
	}, true);
}

/** Select owned object fields while preserving field identity, optionality and unknown-key policy. Foreign shape introspection rejects. */
export function pick<
	const Fields extends Shape,
	Policy extends UnknownKeys,
	const Keys extends readonly (keyof Fields & string)[],
>(
	base: ObjectReader<Fields, Policy>,
	keys: Keys,
): ObjectReader<Pick<Fields, Keys[number]>, Policy> {
	const retained = objectDefinitions.get(base);
	if (retained === undefined) throw new TypeError('pick requires an owned object schema.');
	return object(recordCore.pick(retained.fields, keys) as Pick<Fields, Keys[number]>, {
		unknownKeys: retained.unknownKeys,
	}) as ObjectReader<Pick<Fields, Keys[number]>, Policy>;
}

/** Remove owned object fields without resetting strip/preserve policy or decoding a retained field twice. */
export function omit<
	const Fields extends Shape,
	Policy extends UnknownKeys,
	const Keys extends readonly (keyof Fields & string)[],
>(
	base: ObjectReader<Fields, Policy>,
	keys: Keys,
): ObjectReader<Omit<Fields, Keys[number]>, Policy> {
	const retained = objectDefinitions.get(base);
	if (retained === undefined) throw new TypeError('omit requires an owned object schema.');
	return object(recordCore.omit(retained.fields, keys) as Omit<Fields, Keys[number]>, {
		unknownKeys: retained.unknownKeys,
	}) as ObjectReader<Omit<Fields, Keys[number]>, Policy>;
}
