import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { mapPooledOrdered, mapPooledUnordered, runBoundedQueue } from '@okikio/concurrency/bounded';

describe('pooled mapper failure values', () => {
	for (const operation of ['queue', 'ordered', 'unordered'] as const) {
		for (const kind of ['undefined', 'null', 'string', 'object'] as const) {
			it(`preserves a thrown ${kind} in ${operation} after joining its cancelled sibling`, async () => {
				const reason = kind === 'undefined'
					? undefined
					: kind === 'null'
					? null
					: kind === 'string'
					? 'provider unavailable'
					: Object.freeze({ code: 'provider-unavailable' });
				const siblingReady = Promise.withResolvers<void>();
				const started: number[] = [];
				let siblingSettled = false;
				let siblingReason: unknown;
				const map = async (value: number, { signal }: { readonly signal: AbortSignal }): Promise<number> => {
					started.push(value);
					if (value === 2) {
						await siblingReady.promise;
						throw reason;
					}
					await new Promise<void>((resolve) => {
						signal.addEventListener('abort', () => {
							siblingReason = signal.reason;
							resolve();
						}, { once: true });
						siblingReady.resolve();
					});
					siblingSettled = true;
					return value;
				};
				const input = { items: [1, 2, 3], concurrency: 2, map };
				const pending = operation === 'queue'
					? runBoundedQueue({
						...input,
						run: async (value, ctx) => {
							await map(value, ctx);
						},
					})
					: Array.fromAsync(operation === 'ordered' ? mapPooledOrdered(input) : mapPooledUnordered(input));
				await rejects(pending, (error: unknown) => Object.is(error, reason));
				deepStrictEqual(started, [1, 2]);
				strictEqual(siblingSettled, true);
				if (kind === 'undefined') {
					// Native abort() supplies its default reason for undefined. The
					// terminal mapper failure must still retain the thrown value.
					ok(siblingReason instanceof DOMException);
				} else {
					strictEqual(siblingReason, reason);
				}
			});
		}
	}
});

describe('runBoundedQueue', () => {
	it('keeps active operations within the configured std pool size', async () => {
		let active = 0;
		let maximumActive = 0;
		let admitted = 0;
		let release!: () => void;
		const overlap = new Promise<void>((resolve) => release = resolve);
		await runBoundedQueue({
			items: [1, 2, 3, 4, 5, 6],
			concurrency: 2,
			async run() {
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				admitted += 1;
				if (admitted === 2) release();
				await overlap;
				active -= 1;
			},
		});
		strictEqual(maximumActive, 2);
		strictEqual(active, 0);
	});

	it('stops scheduling new work after cooperative cancellation', async () => {
		const completed: number[] = [];
		let stopped = false;
		await runBoundedQueue({
			items: [1, 2, 3, 4],
			concurrency: 1,
			shouldStop: () => stopped,
			async run(value) {
				completed.push(value);
				stopped = true;
			},
		});
		deepStrictEqual(completed, [1]);
	});

	it('rejects invalid concurrency instead of silently coercing it', async () => {
		await rejects(
			runBoundedQueue({
				items: [1],
				concurrency: Number.NaN,
				run: () => Promise.resolve(),
			}),
			RangeError,
		);
	});

	it('processes undefined values as data', async () => {
		const values: Array<number | undefined> = [];
		await runBoundedQueue({
			items: [undefined, 1],
			concurrency: 1,
			async run(value) {
				values.push(value);
			},
		});
		deepStrictEqual(values, [undefined, 1]);
	});

	it('aborts an admitted sibling before returning the mapper failure', async () => {
		const started: number[] = [];
		let siblingSettled = false;
		let siblingReason: unknown;
		const reason = new Error('worker failed');
		await rejects(
			runBoundedQueue({
				items: [1, 2, 3, 4],
				concurrency: 2,
				async run(value, { signal }) {
					started.push(value);
					if (value === 2) throw reason;
					await new Promise<void>((_resolve, reject) => {
						signal.addEventListener('abort', () => {
							siblingReason = signal.reason;
							reject(signal.reason);
						}, { once: true });
					}).finally(() => {
						siblingSettled = true;
					});
				},
			}),
			(error: unknown) => Object.is(error, reason),
		);
		deepStrictEqual(started, [1, 2]);
		strictEqual(siblingSettled, true);
		strictEqual(siblingReason, reason);
	});
});

describe('mapPooledOrdered', () => {
	it('joins a cancelled sibling before reporting source cleanup failure on consumer return', async (t) => {
		const cleanup = new Error('source cleanup failed');
		const siblingReady = Promise.withResolvers<void>();
		const releaseSibling = Promise.withResolvers<void>();
		const sourceReturned = Promise.withResolvers<void>();
		const events: string[] = [];
		let siblingSettled = false;
		let returnSettled = false;
		async function* source() {
			try {
				yield 1;
				yield 2;
				yield 3;
			} finally {
				sourceReturned.resolve();
				await Promise.reject(cleanup);
			}
		}
		const iterator = mapPooledOrdered({
			items: source(),
			concurrency: 2,
			async map(value, { signal }) {
				if (value === 1) {
					await siblingReady.promise;
					return value;
				}
				await new Promise<void>((resolve) => {
					signal.addEventListener('abort', () => resolve(), { once: true });
					siblingReady.resolve();
				});
				await releaseSibling.promise;
				siblingSettled = true;
				events.push('sibling settled');
				return value;
			},
		})[Symbol.asyncIterator]();
		t.after(() => releaseSibling.resolve());
		strictEqual((await iterator.next()).value, 1);
		const closing = iterator.return?.();
		if (closing === undefined) throw new Error('The ordered mapper must support consumer return.');
		const observed = closing.then(
			() => {
				returnSettled = true;
			},
			() => {
				returnSettled = true;
				events.push('consumer settled');
			},
		);
		t.after(async () => {
			releaseSibling.resolve();
			await observed;
		});
		await sourceReturned.promise;
		// Let queued return/rejection callbacks finish across an event-loop turn.
		// The sibling stays blocked on our gate; no elapsed-time limit is tested.
		await setImmediate();
		strictEqual(siblingSettled, false);
		strictEqual(returnSettled, false);
		releaseSibling.resolve();
		await rejects(closing, (error: unknown) => Object.is(error, cleanup));
		await observed;
		strictEqual(siblingSettled, true);
		deepStrictEqual(events, ['sibling settled', 'consumer settled']);
	});

	for (const kind of ['error', 'undefined'] as const) {
		it(`retains a primary ${kind} failure together with failed source cleanup`, async () => {
			const primary = kind === 'error' ? new Error('mapper failed') : undefined;
			const cleanup = new Error('source cleanup failed');
			let returned = false;
			async function* source() {
				try {
					yield 1;
					yield 2;
				} finally {
					returned = true;
					await Promise.reject(cleanup);
				}
			}
			const pending = Array.fromAsync(mapPooledOrdered({
				items: source(),
				concurrency: 1,
				async map() {
					throw primary;
				},
			}));
			await rejects(pending, AggregateError);
			const rejected = await pending.catch((error: unknown) => error);
			if (!(rejected instanceof AggregateError)) throw new Error('Both owned failures must remain observable.');
			deepStrictEqual(rejected.errors, [primary, cleanup]);
			strictEqual(rejected.errors[0], primary);
			strictEqual(rejected.errors[1], cleanup);
			strictEqual(rejected.cause, primary);
			strictEqual(returned, true);
		});
	}

	it('retains undefined when source cleanup is the sole failure', async () => {
		async function* source() {
			try {
				yield 1;
				yield 2;
			} finally {
				await Promise.reject(undefined);
			}
		}
		const iterator = mapPooledOrdered({
			items: source(),
			concurrency: 1,
			map: (value) => Promise.resolve(value),
		})[Symbol.asyncIterator]();
		strictEqual((await iterator.next()).value, 1);
		const closing = iterator.return?.();
		ok(closing !== undefined, 'The ordered mapper must support consumer return.');
		await rejects(closing, (error: unknown) => Object.is(error, undefined));
	});

	it('rethrows the concrete mapper failure after admitted siblings observe cancellation', async () => {
		let siblingAborted = false;
		let siblingReason: unknown;
		const reason = new TypeError('detector parse failed');
		const values = mapPooledOrdered({
			items: [1, 2],
			concurrency: 2,
			async map(value, { signal }) {
				if (value === 2) throw reason;
				try {
					await new Promise<void>((_resolve, reject) => {
						signal.addEventListener('abort', () => {
							siblingReason = signal.reason;
							reject(signal.reason);
						}, { once: true });
					});
				} finally {
					siblingAborted = true;
				}
				return value;
			},
		});
		await rejects(
			(async () => {
				for await (const _ of values) { /* drain */ }
			})(),
			(error: unknown) => Object.is(error, reason),
		);
		strictEqual(siblingAborted, true);
		strictEqual(siblingReason, reason);
	});
});

describe('mapPooledUnordered', () => {
	it('yields values in completion order while std pooledMap owns admission', async () => {
		const releases = new Map<number, () => void>();
		const admitted = Promise.withResolvers<void>();
		const values: number[] = [];
		const iterator = mapPooledUnordered({
			items: [1, 2, 3],
			concurrency: 3,
			async map(value) {
				await new Promise<void>((resolve) => {
					releases.set(value, resolve);
					if (releases.size === 3) admitted.resolve();
				});
				return value;
			},
		})[Symbol.asyncIterator]();

		const first = iterator.next();
		await admitted.promise;
		releases.get(3)?.();
		values.push((await first).value as number);
		releases.get(1)?.();
		values.push((await iterator.next()).value as number);
		releases.get(2)?.();
		values.push((await iterator.next()).value as number);
		await iterator.return?.();
		deepStrictEqual(values, [3, 1, 2]);
	});

	it('cancels admitted transforms when the consumer stops early', async () => {
		let secondAborted = false;
		for await (
			const value of mapPooledUnordered({
				items: [1, 2],
				concurrency: 2,
				async map(item, { signal }) {
					if (item === 1) return item;
					try {
						await new Promise<void>((_resolve, reject) => {
							signal.addEventListener('abort', () => reject(signal.reason), { once: true });
						});
					} catch {
						secondAborted = true;
					}
					return item;
				},
			})
		) {
			strictEqual(value, 1);
			break;
		}
		strictEqual(secondAborted, true);
	});
	it('does not reuse a pool slot until an acknowledged completion is consumed', async () => {
		const started: number[] = [];
		const iterator = mapPooledUnordered({
			items: [1, 2],
			concurrency: 1,
			acknowledgeCompletions: true,
			async map(value) {
				started.push(value);
				return value;
			},
		})[Symbol.asyncIterator]();

		strictEqual((await iterator.next()).value, 1);
		deepStrictEqual(started, [1]);
		const second = iterator.next();
		// The iterator result is the observable admission and completion signal.
		strictEqual((await second).value, 2);
		await iterator.return?.();
	});
});
