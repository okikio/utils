/** Preserve native form entries, repeated names and files before explicit schema validation. @module */
import * as schema from '@okikio/schema';
import type { Schema, ValidationResult } from '@okikio/schema';
import type { BindingHandle, ErrorReporter, ListenerTarget, Native } from './types.ts';
import type { FileValue } from './files.ts';
import * as ownership from './ownership.ts';
import * as callback from './callback.ts';
import * as targets from './targets.ts';

/** An ordered form entry; the referenced file is borrowed and its body is not read. */
export type Entry<Value = string | FileValue> = readonly [name: string, value: Value];

/** Portable form adapter. Real HTML forms use the native FormData algorithm instead. */
export interface FormHost<Value = string | FileValue> extends ListenerTarget {
	/** Snapshot successful controls, accounting for the selected submitter. */
	read(submitter?: unknown): Iterable<Entry<Value>>;
}

/** Snapshot limit protects applications receiving arbitrarily large structural entry iterables. */
export interface ReadOptions {
	/** Native submitter, included by FormData when named. */
	readonly submitter?: unknown;
	/** Maximum entries, including repeated names; defaults to 4096. */
	readonly maxEntries?: number;
}

/** Explicit projection from a lossless ordered entry list into schema input. */
export interface ObjectOptions extends ReadOptions {
	/** These names are arrays even when present once; missing names become empty arrays. */
	readonly multiple?: readonly string[];
	/** Repeated scalar fields become arrays by default; never silently discard them. */
	readonly duplicates?: 'array' | 'reject' | 'first' | 'last';
}

/** Sources accepted without requiring a browser: FormData, ordered entries, or a supplied reader. */
export type Source<Value = string | FileValue> = Iterable<Entry<Value>> | FormHost<Value> | Native<'HTMLFormElement'>;

/**
 * Snapshot entries in order. Real forms delegate successful-control, checkbox,
 * disabled-field and submitter semantics to native FormData in their own realm.
 * Minimal hosts implement read(); no global document or DOM constructor check is used.
 */
export function read(
	source: Native<'HTMLFormElement'>,
	options?: ReadOptions,
): readonly Entry<string | Native<'File', FileValue>>[];
/** Preserve the exact value type of a portable entry source, including native FormData files. */
export function read<Value>(
	source: Iterable<Entry<Value>> | FormHost<Value>,
	options?: ReadOptions,
): readonly Entry<Value>[];
/** Read a union of native and portable sources without dropping its declared value type. */
export function read<Value>(source: Source<Value>, options?: ReadOptions): readonly Entry<Value>[];
export function read(source: Source<unknown>, options: ReadOptions = {}): readonly Entry<unknown>[] {
	const maximum = options.maxEntries ?? 4096;
	if (!Number.isSafeInteger(maximum) || maximum < 1) {
		throw new RangeError('Form maxEntries must be a positive integer.');
	}
	let entries: unknown = source;
	// HTMLFormElement iterates its controls, not form entries. Select its native
	// algorithm before the generic iterable path; the tag check works across realms.
	if (
		targets.object(source) &&
		(typeof source.read === 'function' || Object.prototype.toString.call(source) === '[object HTMLFormElement]' ||
			typeof source[Symbol.iterator] !== 'function')
	) {
		if (typeof source.read === 'function') entries = Reflect.apply(source.read, source, [options.submitter]);
		else {
			const document = targets.object(source.ownerDocument) ? source.ownerDocument : undefined;
			const view = document && targets.object(document.defaultView) ? document.defaultView : undefined;
			const constructor = view?.FormData ?? Reflect.get(globalThis, 'FormData');
			if (typeof constructor !== 'function') {
				throw new TypeError('Native form collection requires FormData or a supplied read capability.');
			}
			entries = Reflect.construct(
				constructor,
				options.submitter === undefined ? [source] : [source, options.submitter],
			);
		}
	}
	if (!targets.object(entries) || typeof entries[Symbol.iterator] !== 'function') {
		throw new TypeError('Form input must provide ordered entries.');
	}
	const result: Entry<unknown>[] = [];
	for (const entry of entries as unknown as Iterable<unknown>) {
		if (result.length === maximum) throw new RangeError('Form entries exceed maxEntries.');
		if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
			throw new TypeError('A form entry needs a name and value.');
		}
		result.push([entry[0], entry[1]]);
	}
	return result;
}

/**
 * Select an explicit schema input representation. Strings stay strings, empty
 * strings stay present, and files stay files. Use schema coercion/defaults only
 * where the application wants them. Own properties protect special field names.
 */
export function object(source: Source<unknown>, options: ObjectOptions = {}): Record<string, unknown> {
	const result: Record<string, unknown> = Object.create(null);
	const multiple = new Set(options.multiple ?? []);
	for (const name of multiple) result[name] = [];
	// A field value can itself be an array. Track repetition separately from its runtime shape.
	const repeated = new Set<string>();
	for (const [name, value] of read(source, options)) {
		if (multiple.has(name)) (result[name] as unknown[]).push(value);
		else if (!Object.hasOwn(result, name)) result[name] = value;
		else {
			const policy = options.duplicates ?? 'array';
			if (policy === 'reject') throw new TypeError(`Form field ${name} occurred more than once.`);
			if (policy === 'last') result[name] = value;
			else if (policy === 'array') {
				if (!repeated.has(name)) {
					result[name] = [result[name]];
					repeated.add(name);
				}
				(result[name] as unknown[]).push(value);
			}
		}
	}
	return result;
}

/** Validate the explicit projection with owned Schema or another Standard Schema validator; issue paths are preserved. */
export async function validate<Input, Output>(
	definition: Schema<Input, Output>,
	source: Source<unknown>,
	options?: ObjectOptions,
): Promise<ValidationResult<Output>> {
	return await schema.validate(definition, object(source, options));
}

/** One native or mock submit event. A listener does not submit the form or consume its files. */
export interface Submission<Event = unknown, Value = string | FileValue> {
	/** Ordered successful-control snapshot, including repeated names and borrowed files. */
	readonly entries: readonly Entry<Value>[];
	/** Original control that requested submission, if the event supplies it. */
	readonly submitter: unknown;
	/** Original submit event; native form callbacks retain SubmitEvent. */
	readonly event: Event;
}

/** Submission ownership, native default policy and asynchronous callback admission. */
export interface Options extends ReadOptions {
	/** Abort detaches the submit listener; application save work must receive its own usable signal. */
	readonly signal?: AbortSignal;
	/** Opt in when the application owns submission; defaults to false. */
	readonly preventDefault?: boolean;
	/** Ignore another submit while the callback's Promise is pending; defaults to ignore. No queue is retained. */
	readonly pending?: 'ignore' | 'allow';
	/** Report snapshot and callback failures, including rejected asynchronous submissions. */
	readonly onError?: ErrorReporter;
}

/** Observe a native form and preserve its SubmitEvent type. */
export function listen(
	form: Native<'HTMLFormElement'>,
	submit: (value: Submission<Native<'SubmitEvent', unknown>, string | Native<'File', FileValue>>) => unknown,
	options?: Options,
): BindingHandle;
/** A minimal host supplies successful entries through read(). */
export function listen<Value>(
	form: FormHost<Value>,
	submit: (value: Submission<unknown, Value>) => unknown,
	options?: Options,
): BindingHandle;
/**
 * Snapshot the form synchronously before invoking application code. While one
 * Promise is pending, the default policy admits no additional submit. Closing
 * the binding detaches listeners; the application passes signal into its own save.
 */
export function listen<Event, Value>(
	form: FormHost<Value> | Native<'HTMLFormElement'>,
	submit: (value: Submission<Event, Value>) => unknown,
	options: Options = {},
): BindingHandle {
	// Reject invalid limits before installing a listener that can take ownership of native submission.
	read([], options);
	const owner = ownership.create(options.signal);
	// Hold admission until a returned Promise settles. This prevents a second
	// submit from starting another save; it does not cancel the first save.
	let busy = false;
	/** Snapshot successful controls at submission time, before asynchronous application work can change the form. */
	const receive = (event: unknown) => {
		if (owner.handle.closed || !targets.object(event)) return;
		if (options.preventDefault && typeof event.preventDefault === 'function') {
			Reflect.apply(event.preventDefault, event, []);
		}
		if (busy && options.pending !== 'allow') return;
		const submitter = event.submitter;
		callback.call(
			() => {
				const entries = read<Value>(form, { ...options, submitter });
				busy = true;
				try {
					const result = submit({ entries, submitter, event: event as Event });
					if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
						return Promise.resolve(result).finally(() => {
							busy = false;
						});
					}
					busy = false;
					return result;
				} catch (error) {
					busy = false;
					throw error;
				}
			},
			undefined,
			options.onError,
		);
	};
	try {
		owner.listen(form, 'submit', receive);
	} catch (error) {
		ownership.fail(owner, error);
	}
	return owner.handle;
}

/** Exact schema path mapped to one native field name. Bracket/dot spellings are never inferred. */
export interface FieldMapType {
	readonly name: string;
	readonly path: readonly (string | number)[];
}
/** Bounded UI-facing validation evidence; the application owns whether messages are suitable for display. */
export interface IssueType {
	readonly message: string;
	readonly path: readonly (string | number)[];
	/** Unsupported/deep paths or shortened messages remain explicit instead of matching the wrong field. */
	readonly truncated: boolean;
}
/** Mapped and unmatched issues stay separate; no focus, ARIA state, control value or submission is changed. */
export interface IssuesType {
	readonly fields: Readonly<Record<string, readonly IssueType[]>>;
	readonly unmapped: readonly IssueType[];
	readonly capped: boolean;
}
/**
 * Map a validation result to explicitly named controls. Several controls may share one schema path;
 * repeated field values and File objects are not examined. Deep/unsupported issue paths remain
 * unmatched, never mapped by a truncated prefix. All text bounds count UTF-16 code units.
 */
export function issues(
	validation: ValidationResult<unknown>,
	fieldMap: readonly FieldMapType[],
	options: Readonly<
		{
			readonly maximumFields: number;
			readonly maximumIssues: number;
			readonly maximumPathLength: number;
			readonly maximumMessageCodeUnits: number;
		}
	>,
): IssuesType {
	for (
		const value of [
			options.maximumFields,
			options.maximumIssues,
			options.maximumPathLength,
			options.maximumMessageCodeUnits,
		]
	) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('Form issue limits require nonnegative safe integers.');
		}
	}
	if (fieldMap.length > options.maximumFields) throw new RangeError('Form mapping exceeds maximumFields.');
	const fields: Record<string, IssueType[]> = Object.create(null);
	const paths = fieldMap.map((field) => {
		if (
			typeof field.name !== 'string' || !field.name || Object.hasOwn(fields, field.name) ||
			field.path.length > options.maximumPathLength ||
			field.path.some((part) => typeof part !== 'string' && (!Number.isSafeInteger(part) || part < 0))
		) throw new TypeError('Invalid or duplicate form field mapping.');
		fields[field.name] = [];
		return { name: field.name, path: [...field.path] };
	});
	const input = validation.issues ?? [];
	const unmapped: IssueType[] = [];
	let capped = input.length > options.maximumIssues || ('truncated' in validation && validation.truncated === true);
	for (const problem of input.slice(0, options.maximumIssues)) {
		const path: (string | number)[] = [];
		let truncated = false;
		for (const part of problem.path ?? []) {
			if (path.length === options.maximumPathLength) {
				truncated = true;
				break;
			}
			const key = typeof part === 'object' && part !== null ? part.key : part;
			if (typeof key !== 'string' && (typeof key !== 'number' || !Number.isSafeInteger(key) || key < 0)) {
				truncated = true;
				break;
			}
			path.push(key);
		}
		if (problem.message.length > options.maximumMessageCodeUnits) truncated = true;
		const issue = Object.freeze({
			message: problem.message.slice(0, options.maximumMessageCodeUnits),
			path: Object.freeze(path),
			truncated,
		});
		let matched = false;
		// A shortened message can still name its exact field; an incomplete path cannot.
		const completePath = (problem.path?.length ?? 0) === path.length;
		if (completePath) {
			for (const field of paths) {
				if (field.path.length === path.length && field.path.every((part, index) => part === path[index])) {
					fields[field.name]!.push(issue);
					matched = true;
				}
			}
		}
		if (!matched) unmapped.push(issue);
		capped ||= truncated;
	}
	for (const name of Object.keys(fields)) Object.freeze(fields[name]);
	return Object.freeze({ fields: Object.freeze(fields), unmapped: Object.freeze(unmapped), capped });
}

/** Comparison is descriptive only; defaults and current values remain borrowed and unchanged. */
export interface DirtyType {
	readonly dirty: boolean;
	/** Names with missing, additional or unequal occurrences, in first-current then first-default order. */
	readonly fields: readonly string[];
	/** Global entry-name order differs, even when per-field occurrences are equal. */
	readonly orderChanged: boolean;
}
/**
 * Compare lossless entry snapshots with explicit equality and ordering policy. Values, including Files,
 * remain borrowed; no serialization or file read occurs. Occurrence order within a repeated field is
 * always significant. entries also treats global field-name order as significant; per-field ignores
 * only that global order. Callback defects propagate and no control is submitted or mutated.
 */
export function dirty<Value>(
	current: readonly Entry<Value>[],
	defaults: readonly Entry<Value>[],
	options: Readonly<
		{
			readonly maximumEntries: number;
			readonly order: 'entries' | 'per-field';
			readonly equal: (current: Value, initial: Value, name: string, occurrence: number) => boolean;
		}
	>,
): DirtyType {
	const { maximumEntries, order, equal } = options;
	if (
		!Number.isSafeInteger(maximumEntries) || maximumEntries < 0 || current.length > maximumEntries ||
		defaults.length > maximumEntries ||
		!['entries', 'per-field'].includes(order) || typeof equal !== 'function'
	) throw new RangeError('Invalid form comparison bounds or policy.');
	/** Snapshot ordered pairs before callbacks can mutate the caller's entry arrays. Values stay borrowed. */
	const snapshot = (input: readonly Entry<Value>[]): readonly Entry<Value>[] =>
		input.map((entry) => {
			if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
				throw new TypeError('Form comparison requires name/value pairs.');
			}
			return Object.freeze([entry[0], entry[1]] as const);
		});
	const left = snapshot(current), right = snapshot(defaults);
	const names = new Set([...left.map(([name]) => name), ...right.map(([name]) => name)]);
	/** Group occurrences without sorting: repeated-value order is part of the dirty comparison. */
	const collect = (entries: readonly Entry<Value>[]): Map<string, Value[]> => {
		const result = new Map<string, Value[]>();
		for (const [name, value] of entries) {
			const values = result.get(name) ?? [];
			values.push(value);
			result.set(name, values);
		}
		return result;
	};
	const actual = collect(left), initial = collect(right), changed: string[] = [];
	for (const name of names) {
		const now = actual.get(name) ?? [], before = initial.get(name) ?? [];
		if (now.length !== before.length || now.some((value, index) => !equal(value, before[index]!, name, index))) {
			changed.push(name);
		}
	}
	const orderChanged = left.length !== right.length || left.some(([name], index) => name !== right[index]?.[0]);
	return Object.freeze({
		dirty: changed.length !== 0 || (order === 'entries' && orderChanged),
		fields: Object.freeze(changed),
		orderChanged,
	});
}
