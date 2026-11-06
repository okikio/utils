/** Cost of constructing one cleanup owner and joining concurrent close callers. @module */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { once } from './once.ts';

for (const count of [1, 100, 10_000]) {
	let calls = 0;
	const owner = once(() => {
		calls++;
	});
	const receipt = owner.close();
	await Promise.all(Array.from({ length: count }, () => owner.close()));
	strictEqual(calls, 1);
	strictEqual(owner.close(), receipt);
	group(`joined cleanup ${count} callers including construction`, () => {
		bench('once', async () => {
			const value = once(() => {});
			await Promise.all(Array.from({ length: count }, () => value.close()));
			do_not_optimize(value);
		});
		bench('explicit published promise', async () => {
			let completion: Promise<void> | undefined;
			const close = () => completion ??= Promise.resolve().then(() => {});
			await Promise.all(Array.from({ length: count }, close));
			do_not_optimize(completion);
		});
	});
}
await run();
