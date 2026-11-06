import * as result from './mod.ts';
import * as asynchronous from './async.ts';

async function inference(value: result.Result<number, 'missing'>): Promise<void> {
	const mapped: result.Result<string, 'missing'> = await asynchronous.map(value, async (n) => String(n));
	const composed = await asynchronous.flatMap(
		value,
		async (n) => n > 0 ? result.ok(n) : result.fail('invalid' as const),
	);
	const exact: result.Result<number, 'missing' | 'invalid'> = composed;
	// @ts-expect-error The second callback's expected failure is part of the result.
	const erased: result.Result<number, 'missing'> = composed;
	void [mapped, exact, erased];
}
void inference;
