import * as result from './mod.ts';
const tuple = result.all([result.ok(1 as const), result.ok('two' as const), result.fail('missing' as const)]);
if (tuple.ok) {
	const first: 1 = tuple.value[0];
	const second: 'two' = tuple.value[1];
	void first;
	void second;
} else {
	const reason: 'missing' = tuple.failure;
	void reason;
}
const iterable = new Set([result.ok(1)]);
// @ts-expect-error Unknown-size iterables require an explicit bound.
result.all(iterable);
