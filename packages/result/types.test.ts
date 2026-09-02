import * as result from './mod.ts';

const success: result.Result<() => number, Error> = result.ok(() => 1);
const failure: result.Result<() => number, Error> = result.fail(new Error('missing'));

const stored: () => number = result.getOr(success, () => 2);
const lazy: () => number = result.getOrElse(failure, () => () => 3);

void stored;
void lazy;

function checkFallbackTypes(value: result.Result<() => number, Error>): void {
	// A lazy factory for a function-valued result must be explicit.
	// @ts-expect-error `getOr` accepts the fallback value itself, not a factory that returns it.
	result.getOr(value, () => () => 4);

	// @ts-expect-error `getOrElse` must create the same value type carried by the result.
	result.getOrElse(value, () => 4);
}

void checkFallbackTypes;
