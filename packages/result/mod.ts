/**
 * Represent an expected success or failure as data and force call sites to choose a branch. Throwing for every missing value makes ordinary control flow indistinguishable from an unexpected provider fault.
 *
 * Use match() at a consumer that must handle both paths, or getOr()/getOrElse() for an intentional fallback. unwrap() turns a failure back into a thrown value when exception flow is appropriate. Result does not define a durable failure identity, retry policy or HTTP status; compose it with those packages when needed.
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
/** Successful result variant. */
export interface Success<Value> {
	/** Whether this result reached its successful protocol branch. */
	readonly ok: true;
	/** Value carried by this contract; its schema and owner define the accepted shape. */
	readonly value: Value;
}

/** Failed result variant. */
export interface Failure<Reason> {
	/** Whether this result reached its successful protocol branch. */
	readonly ok: false;
	/** Expected failure data retained under its declared contract. */
	readonly failure: Reason;
}

/** Explicit success-or-failure result. */
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

/** Transform either result variant without losing explicit control flow. */
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
