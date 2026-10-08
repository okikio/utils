import { pooledMap } from '@std/async';
import { Channel } from '#/channel.ts';

/** Cancellation context supplied to one pooled operation. */
export interface PooledOperationContext {
	/** Signal aborted when the caller cancels, a sibling fails, or the consumer stops early. */
	readonly signal: AbortSignal;
}

/**
 * Run values through Deno std's bounded async pool with structured sibling cancellation.
 *
 * `pooledMap()` owns concurrency and input backpressure. This adapter adds the
 * application lifecycle rule that one failed operation aborts already admitted sibling
 * work through the operation signal before the failure is returned to the caller.
 * The original thrown value is retained, including `undefined`; native abort
 * signals can normalize that value without changing the terminal rejection.
 */
export async function runBoundedQueue<T>(input: {
	readonly items: Iterable<T> | AsyncIterable<T>;
	readonly concurrency: number;
	readonly shouldStop?: () => boolean;
	readonly signal?: AbortSignal;
	readonly run: (item: T, context: PooledOperationContext) => Promise<void>;
}): Promise<void> {
	const concurrency = positiveInteger(input.concurrency, 'concurrency');
	input.signal?.throwIfAborted();

	const failureController = new AbortController();
	// AbortController replaces an undefined reason with a DOMException. Keep the
	// mapper failure separately so its terminal value can still be undefined.
	let failure: { readonly error: unknown } | undefined;
	const signal = input.signal ? AbortSignal.any([input.signal, failureController.signal]) : failureController.signal;
	const mapped = pooledMap(concurrency, input.items, async (item) => {
		signal.throwIfAborted();
		if (input.shouldStop?.()) return;
		try {
			await input.run(item, { signal });
		} catch (error) {
			if (!failureController.signal.aborted) {
				failure = { error };
				failureController.abort(error);
			}
			throw error;
		}
	});

	try {
		for await (const _ of mapped) {
			// Draining the std iterator is what applies its bounded scheduling and
			// aggregate failure semantics. The mapped value is intentionally void.
		}
	} catch (error) {
		if (failure !== undefined) throw failure.error;
		throw error;
	}
	input.signal?.throwIfAborted();
}

/**
 * Transform values concurrently and yield them in input order.
 *
 * Mapper promises settle into data before they enter the ordered queue. This is
 * intentional: a rejected background promise can become an unhandled rejection
 * while the consumer is still waiting for an earlier item. The first mapper
 * failure aborts admitted siblings, all admitted promises are drained, and only
 * then is that original failure rethrown to the caller. Source iteration is also
 * closed before settlement. If source cleanup fails, admitted mappers are still
 * joined. When an operation and its source cleanup both fail, an AggregateError
 * retains them in that order, with the operation failure as its cause. A sole
 * operation or cleanup failure keeps its exact value, including undefined.
 */
export async function* mapPooledOrdered<T, R>(input: {
	readonly items: Iterable<T> | AsyncIterable<T>;
	readonly concurrency: number;
	readonly signal?: AbortSignal;
	readonly map: (item: T, context: PooledOperationContext) => Promise<R>;
}): AsyncIterable<R> {
	const concurrency = positiveInteger(input.concurrency, 'concurrency');
	input.signal?.throwIfAborted();

	const operationController = new AbortController();
	let failure: { readonly error: unknown } | undefined;
	const signal = input.signal
		? AbortSignal.any([input.signal, operationController.signal])
		: operationController.signal;
	const iterator = iterate(input.items)[Symbol.asyncIterator]();
	type Settled = Readonly<{ ok: true; value: R }> | Readonly<{ ok: false; error: unknown }>;
	const pending: Promise<Settled>[] = [];
	let inputDone = false;
	let completedNormally = false;
	let primaryFailure: { readonly error: unknown } | undefined;

	const admit = async (): Promise<void> => {
		while (!inputDone && pending.length < concurrency && !signal.aborted) {
			const next = await iterator.next();
			if (next.done) {
				inputDone = true;
				break;
			}
			pending.push(
				Promise.resolve()
					.then(() => input.map(next.value, { signal }))
					.then<Settled, Settled>(
						(value) => ({ ok: true, value }),
						(error): Settled => {
							if (!operationController.signal.aborted) {
								failure = { error };
								operationController.abort(error);
							}
							return { ok: false, error };
						},
					),
			);
		}
	};

	/** Close source iteration and join admitted work; retain primary and cleanup failures together. */
	async function close(): Promise<void> {
		if (!completedNormally && !operationController.signal.aborted) {
			operationController.abort(new DOMException('The pooled-map consumer stopped before completion.', 'AbortError'));
		}
		let cleanupFailure: { readonly error: unknown } | undefined;
		try {
			await iterator.return?.();
		} catch (error) {
			cleanupFailure = { error };
		} finally {
			// Source return and mapper settlement are independent cleanup duties.
			// One failing return must not release ownership of the admitted work.
			await Promise.all(pending);
		}
		if (cleanupFailure !== undefined) {
			if (primaryFailure !== undefined) {
				throw new AggregateError(
					[primaryFailure.error, cleanupFailure.error],
					'The pooled operation and source cleanup both failed.',
					{ cause: primaryFailure.error },
				);
			}
			throw cleanupFailure.error;
		}
	}

	try {
		await admit();
		while (pending.length > 0) {
			const result = await pending.shift()!;
			if (!result.ok) {
				await Promise.all(pending);
				throw failure === undefined ? result.error : failure.error;
			}
			if (operationController.signal.aborted) {
				await Promise.all(pending);
				throw failure === undefined ? operationController.signal.reason : failure.error;
			}
			input.signal?.throwIfAborted();
			yield result.value;
			await admit();
		}
		input.signal?.throwIfAborted();
		completedNormally = true;
	} catch (error) {
		primaryFailure = { error };
		throw error;
	} finally {
		await close();
	}
}

/** Iterate sync and async sources through one async-iterator contract. */
async function* iterate<T>(items: Iterable<T> | AsyncIterable<T>): AsyncIterable<T> {
	for await (const item of items) yield item;
}

/**
 * Transform values with Deno std's bounded pool and yield successful results in
 * completion order.
 *
 * `pooledMap()` deliberately yields in input order. Browser capture needs the
 * opposite delivery policy so a completed route can be persisted immediately
 * instead of waiting behind a slower earlier route. A bounded std `Channel`
 * carries completions while `pooledMap()` continues to own admission. No custom
 * semaphore or Promise-race scheduler is maintained here.
 */
export async function* mapPooledUnordered<T, R>(input: {
	readonly items: Iterable<T> | AsyncIterable<T>;
	readonly concurrency: number;
	readonly shouldStop?: () => boolean;
	readonly signal?: AbortSignal;
	/** Wait for the consumer to finish handling one completion before reusing that pool slot. */
	readonly acknowledgeCompletions?: boolean;
	readonly map: (item: T, context: PooledOperationContext) => Promise<R>;
}): AsyncIterable<R> {
	const concurrency = positiveInteger(input.concurrency, 'concurrency');
	input.signal?.throwIfAborted();

	const operationController = new AbortController();
	let failure: { readonly error: unknown } | undefined;
	const signal = input.signal
		? AbortSignal.any([input.signal, operationController.signal])
		: operationController.signal;
	type Completion = Readonly<{ value: R; acknowledge?: () => void }>;
	await using completions = new Channel<Completion>({ capacity: concurrency });
	let completedNormally = false;

	const driver = (async () => {
		try {
			const mapped = pooledMap(concurrency, input.items, async (item) => {
				signal.throwIfAborted();
				if (input.shouldStop?.()) return;
				try {
					const value = await input.map(item, { signal });
					if (!input.acknowledgeCompletions) {
						await completions.send({ value }, { signal });
					} else {
						let acknowledge!: () => void;
						const acknowledged = new Promise<void>((resolve) => {
							acknowledge = resolve;
						});
						await completions.send({ value, acknowledge }, { signal });
						await waitForAcknowledgement(acknowledged, signal);
					}
				} catch (error) {
					if (!operationController.signal.aborted) {
						failure = { error };
						operationController.abort(error);
					}
					throw error;
				}
			});
			for await (const _ of mapped) {
				// Results travel through `completions`; the ordered std output is only
				// drained to drive the pool to completion.
			}
			completions.close();
		} catch (error) {
			const reason = failure !== undefined
				? failure.error
				: operationController.signal.aborted
				? operationController.signal.reason
				: error;
			completions.close(reason);
			throw reason;
		}
	})();
	void driver.catch(() => undefined);

	try {
		for await (const completion of completions) {
			try {
				yield completion.value;
			} finally {
				completion.acknowledge?.();
			}
		}
		await driver;
		input.signal?.throwIfAborted();
		completedNormally = true;
	} finally {
		if (!completedNormally && !operationController.signal.aborted) {
			operationController.abort(new DOMException('The pooled-map consumer stopped before completion.', 'AbortError'));
		}
		completions.close(operationController.signal.reason);
		await driver.catch(() => undefined);
	}
}

/** Release a blocked producer on acknowledgement or cancellation while retaining the exact signal cause. */
function waitForAcknowledgement(acknowledged: Promise<void>, signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		return Promise.reject(signal.reason);
	}
	return new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener('abort', onAbort);
			reject(signal.reason);
		};
		signal.addEventListener('abort', onAbort, { once: true });
		void acknowledged.then(
			() => {
				signal.removeEventListener('abort', onAbort);
				resolve();
			},
			(error) => {
				signal.removeEventListener('abort', onAbort);
				reject(error);
			},
		);
	});
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}
