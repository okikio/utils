/**
 * Return either a value or an expected failure as ordinary data. For example, a contact lookup can return
 * not-found without throwing an exception for a normal absence.
 *
 * Check ok to choose a branch, use match() when both branches need callbacks, or choose an explicit
 * fallback. unwrap() throws the stored failure when exception control flow is intended.
 *
 * Result does not choose retries, HTTP status codes, or durable failure identities. Exceptions become
 * failure data only when the caller explicitly captures them.
 *
 * @example
 * ```ts
 * import * as result from '@okikio/result';
 * const found = result.ok('asset-1');
 * const missing = result.fail('missing');
 * console.log(result.match(found, { ok: (id) => `loaded ${id}`, failure: (reason) => `failed ${reason}` }));
 * console.log(result.getOr(missing as result.Result<string, string>, 'default'));
 * ```
 *
 * @module
 */
/** The successful branch of a Result. Check ok before reading the useful value. */
export interface Success<Value> {
	/** Literal true selects this branch and lets TypeScript expose value. */
	readonly ok: true;
	/** Value carried by this contract; its schema and owner define the accepted shape. */
	readonly value: Value;
}

/** An expected rejection carried as data. The caller chooses a message, fallback or retry. */
export interface Failure<Reason> {
	/** Literal false selects this branch and lets TypeScript expose failure. */
	readonly ok: false;
	/** Expected failure data retained under its declared contract. */
	readonly failure: Reason;
}

/**
 * One completed answer: either a useful value or an expected reason it is absent.
 * This wrapper is not asynchronous. Promise<Result<Value, Reason>> means wait
 * for the work first, then inspect the resulting ok field. Neither branch
 * automatically catches exceptions, retries work or chooses presentation.
 */
export type Result<Value, Reason> = Success<Value> | Failure<Reason>;

/** Create a frozen successful-result wrapper around a borrowed value. */
export function ok<Value>(value: Value): Success<Value> {
	return Object.freeze({ ok: true, value });
}

/** Create a frozen failed-result wrapper around a borrowed failure value. */
export function fail<Reason>(failure: Reason): Failure<Reason> {
	return Object.freeze({ ok: false, failure });
}

/** Return whether a result is successful. */
export function isOk<Value, Reason>(value: Result<Value, Reason>): value is Success<Value> {
	return value.ok;
}

/** Return whether a result is failed. */
export function isFailure<Value, Reason>(value: Result<Value, Reason>): value is Failure<Reason> {
	return !value.ok;
}

/**
 * Call exactly one branch synchronously and return its value unchanged.
 * A branch that throws remains an exception; use capture() explicitly when that
 * exception should become failure data. Promise results are returned without awaiting.
 */
export function match<Value, Reason, SuccessResult, FailureResult>(
	value: Result<Value, Reason>,
	cases: Readonly<{
		readonly ok: (value: Value) => SuccessResult;
		readonly failure: (failure: Reason) => FailureResult;
	}>,
): SuccessResult | FailureResult {
	return value.ok ? cases.ok(value.value) : cases.failure(value.failure);
}

/** Return the success value or throw the supplied failure. */
export function unwrap<Value, Reason>(value: Result<Value, Reason>): Value {
	if (value.ok) return value.value;
	throw value.failure;
}

/** Return the success value or a caller-provided fallback value. */
export function getOr<Value, Reason>(value: Result<Value, Reason>, fallback: NoInfer<Value>): Value {
	return value.ok ? value.value : fallback;
}

/** Return the success value or lazily create a fallback value. */
export function getOrElse<Value, Reason>(
	value: Result<Value, Reason>,
	fallback: () => NoInfer<Value>,
): Value {
	return value.ok ? value.value : fallback();
}

/**
 * Transform a success while preserving a failure wrapper and its payload unchanged.
 * The callback runs synchronously; throws propagate rather than becoming a failure.
 * Use @okikio/result/async when the transformed payload needs to be awaited.
 */
export function map<Value, Reason, Next>(
	value: Result<Value, Reason>,
	transform: (value: Value) => Next,
): Result<Next, Reason> {
	return value.ok ? ok(transform(value.value)) : value;
}

/** Transform expected failure data while preserving a success object unchanged. */
export function mapFailure<Value, Reason, Next>(
	value: Result<Value, Reason>,
	transform: (reason: Reason) => Next,
): Result<Value, Next> {
	return value.ok ? value : fail(transform(value.failure));
}

/** Compose another result-producing operation and retain both operations' failure types. */
export function flatMap<Value, Reason, Next, NextReason>(
	value: Result<Value, Reason>,
	transform: (value: Value) => Result<Next, NextReason>,
): Result<Next, Reason | NextReason> {
	return value.ok ? transform(value.value) : value;
}

/** Capture a synchronous operation. A thrown value remains unknown rather than being declared a domain failure. */
export function capture<Value>(operation: () => Value): Result<Value, unknown> {
	try {
		return ok(operation());
	} catch (failure) {
		return fail(failure);
	}
}

/** Capture synchronous throws and asynchronous rejections with one consistently asynchronous return type. */
export async function captureAsync<Value>(
	operation: () => Value | PromiseLike<Value>,
): Promise<Result<Awaited<Value>, unknown>> {
	try {
		return ok(await operation());
	} catch (failure) {
		return fail(failure);
	}
}

/** Maximum sequential source items admitted to a materializing aggregation. */
export interface AggregateOptionsType {
	/** Inclusive input count; observing the max+1 item throws and closes the iterator. */
	readonly maximumItems: number;
}
/** Success payload extracted from a branch, distributing over unions. */
type SuccessValueType<Value> = Value extends Success<infer Payload> ? Payload : never;
/** Failure payload extracted from a branch, distributing over unions. */
type FailureValueType<Value> = Value extends Failure<infer Reason> ? Reason : never;

/**
 * Unwrap a finite tuple in order, returning the first failure wrapper unchanged.
 * No later source element is consumed after failure. Output values remain borrowed.
 * General iterables require an explicit bound; early exit closes the iterator.
 */
export function all<const Results extends readonly Result<unknown, unknown>[]>(
	values: Results,
): Result<{ readonly [Key in keyof Results]: SuccessValueType<Results[Key]> }, FailureValueType<Results[number]>>;
export function all<Value, Reason>(
	values: Iterable<Result<Value, Reason>>,
	options: AggregateOptionsType,
): Result<readonly Value[], Reason>;
export function all(
	values: Iterable<Result<unknown, unknown>>,
	options?: AggregateOptionsType,
): Result<readonly unknown[], unknown> {
	const maximum = aggregateLimit(values, options);
	const output: unknown[] = [];
	let count = 0;
	for (const result of values) {
		if (++count > maximum) throw new RangeError('Result source exceeds maximumItems.');
		if (!result.ok) return result;
		output.push(result.value);
	}
	return ok(Object.freeze(output));
}

/** Split borrowed payloads into success/failure arrays in encounter order, with explicit finite admission. */
export function partition<Value, Reason>(
	values: Iterable<Result<Value, Reason>>,
	options: AggregateOptionsType,
): Readonly<{ readonly values: readonly Value[]; readonly failures: readonly Reason[] }> {
	const maximum = aggregateLimit(values, options);
	const successes: Value[] = [];
	const failures: Reason[] = [];
	let count = 0;
	for (const result of values) {
		if (++count > maximum) throw new RangeError('Result source exceeds maximumItems.');
		if (result.ok) successes.push(result.value);
		else failures.push(result.failure);
	}
	return Object.freeze({ values: Object.freeze(successes), failures: Object.freeze(failures) });
}

/** Observe a success without replacing its result wrapper. Callback defects throw; use capture explicitly when intended. */
export function tap<Value, Reason>(
	value: Result<Value, Reason>,
	observe: (value: Value) => void,
): Result<Value, Reason> {
	if (value.ok) observe(value.value);
	return value;
}

/** Observe an expected failure without replacing its result wrapper. Callback defects remain exceptions. */
export function tapFailure<Value, Reason>(
	value: Result<Value, Reason>,
	observe: (reason: Reason) => void,
): Result<Value, Reason> {
	if (!value.ok) observe(value.failure);
	return value;
}

/** Arrays already have a finite count; never guess a bound for a potentially infinite iterator. */
function aggregateLimit(values: Iterable<unknown>, options?: AggregateOptionsType): number {
	const maximum = options?.maximumItems ?? (Array.isArray(values) ? values.length : undefined);
	if (maximum === undefined || !Number.isSafeInteger(maximum) || maximum < 0) {
		throw new TypeError('Result aggregation requires a non-negative safe maximumItems.');
	}
	return maximum;
}
