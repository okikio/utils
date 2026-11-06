import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { batch } from './mod.ts';

/** Manual clock exposes pending waits so tests need no wall-clock guesses. */
class Clock {
	readonly waits = new Set<() => void>();
	sleep(_milliseconds: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const finish = (): void => {
				this.waits.delete(finish);
				signal?.removeEventListener('abort', abort);
				resolve();
			};
			const abort = (): void => {
				this.waits.delete(finish);
				signal?.removeEventListener('abort', abort);
				reject(signal?.reason);
			};
			this.waits.add(finish);
			signal?.addEventListener('abort', abort, { once: true });
			if (signal?.aborted) abort();
		});
	}
	flush(): void {
		for (const resolve of [...this.waits]) resolve();
	}
}
/** Drain only promise turns; a missing expected state fails instead of hanging. */
async function until(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 100 && !predicate(); index++) await Promise.resolve();
	expect(predicate()).toBe(true);
}

describe('clock-driven batching', () => {
	it('flushes a partial batch while preserving exactly one pending source read', async () => {
		const clock = new Clock();
		let reads = 0;
		let returned = 0;
		let release!: (value: IteratorResult<number>) => void;
		const source: AsyncIterable<number> = {
			[Symbol.asyncIterator]() {
				return {
					next() {
						reads++;
						return reads === 1
							? Promise.resolve({ done: false as const, value: 1 })
							: new Promise<IteratorResult<number>>((resolve) => {
								release = resolve;
							});
					},
					async return() {
						returned++;
						return { done: true as const, value: undefined };
					},
				};
			},
		};
		const batches = batch(source, { maximumItems: 3, maximumDelay: 10, clock });
		const first = batches.next();
		await until(() => reads === 2 && clock.waits.size === 1);
		clock.flush();
		expect((await first).value).toEqual([1]);
		expect(reads).toBe(2);
		const second = batches.next();
		release({ done: false, value: 2 });
		await until(() => reads === 3 && clock.waits.size === 1);
		clock.flush();
		expect((await second).value).toEqual([2]);
		await batches.return?.(undefined);
		await until(() => returned === 1);
		expect(clock.waits.size).toBe(0);
	});
	it('flushes on exact count, byte boundary and completion without residual timers', async () => {
		const clock = new Clock();
		expect(
			await Array.fromAsync(batch(['a', 'bb', 'c', 'd'], {
				maximumItems: 2,
				maximumBytes: 3,
				size: (v) => v.length,
				maximumDelay: 10,
				clock,
			})),
		).toEqual([['a', 'bb'], ['c', 'd']]);
		expect(
			await Array.fromAsync(
				batch(['aa', 'bb', 'c'], { maximumBytes: 3, size: (v) => v.length, maximumDelay: 10, clock }),
			),
		).toEqual([['aa'], ['bb', 'c']]);
		expect(clock.waits.size).toBe(0);
	});
	it('preserves abort reasons and observes late rejection while exposing source cleanup', async () => {
		const clock = new Clock();
		const controller = new AbortController();
		let reject!: (reason: unknown) => void;
		let returned = 0;
		let cleanup: Promise<unknown> | undefined;
		const source: AsyncIterable<number> = {
			[Symbol.asyncIterator]() {
				return {
					next: () =>
						new Promise((_resolve, fail) => {
							reject = fail;
						}),
					async return() {
						returned++;
						return { done: true as const, value: undefined };
					},
				};
			},
		};
		const batches = batch(source, {
			maximumItems: 2,
			maximumDelay: 10,
			clock,
			signal: controller.signal,
			onCleanup: (value) => {
				cleanup = value;
			},
		});
		const next = batches.next();
		await until(() => reject !== undefined);
		controller.abort(null);
		await expect(next).rejects.toBe(null);
		reject(new Error('late'));
		await until(() => returned === 1);
		expect(await cleanup).toEqual({ status: 'released' });
		expect(clock.waits.size).toBe(0);
	});
	it('rejects invalid timed policy before opening a source', async () => {
		let opened = false;
		const source = {
			*[Symbol.iterator]() {
				opened = true;
				yield 1;
			},
		};
		await expect(batch(source, { maximumItems: 1, maximumDelay: 1 }).next()).rejects.toThrow(TypeError);
		expect(opened).toBe(false);
	});
});
