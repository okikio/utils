/** Compare timed bookkeeping with the same bounded count-only stream. @module */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { batch } from './mod.ts';

/** Real cancellable host clock; every unused timer is cleared at a batch boundary. */
const clock = {
	sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const finish = (): void => {
				signal?.removeEventListener('abort', abort);
				resolve();
			};
			const timer = setTimeout(finish, milliseconds);
			const abort = (): void => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', abort);
				reject(signal?.reason);
			};
			signal?.addEventListener('abort', abort, { once: true });
			if (signal?.aborted) abort();
		});
	},
};
for (const count of [64, 1024]) {
	const source = Array.from({ length: count }, (_, index) => index);
	const consume = async function (timed: boolean, verify = false): Promise<number> {
		let total = 0;
		const collected: number[] | undefined = verify ? [] : undefined;
		for await (const values of batch(source, { maximumItems: 32, ...(timed ? { maximumDelay: 1000, clock } : {}) })) {
			total += values.length;
			collected?.push(...values);
		}
		if (verify) deepStrictEqual(collected, source);
		return total;
	};
	strictEqual(await consume(true, true), count);
	strictEqual(await consume(false, true), count);
	group(`batch ${count} immediately available items`, () => {
		bench('count and cancellable deadline', async () => do_not_optimize(await consume(true)));
		bench('count only; no time guarantee', async () => do_not_optimize(await consume(false)));
	});
}
await run();
