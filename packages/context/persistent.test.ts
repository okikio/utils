import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { asyncDispose } from '@okikio/dispose';
import * as stores from '@okikio/storage/state';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { DateSchema } from '@okikio/schema/time';
import * as state from './state.ts';

/** Gates expose a real pending load/encode/save without depending on elapsed wall time. */
function gate() {
	return Promise.withResolvers<void>();
}

describe('stored Context state', () => {
	describe('opening and durable representation', () => {
		it('reopens encoded Dates and preserves ordinary synchronous reader composition', async () => {
			const store = stores.memory();
			const value = codec.object({ count: codec.identity(schema.number()), at: DateSchema });
			const at = new Date('2026-11-01T00:00:00.000Z');
			await using cell = await state.open({ store, contract: 'progress.v1', value, initial: () => ({ count: 0, at }) });
			const changes: number[] = [];
			using observed = cell.reader.subscribe(({ value }) => changes.push(value.count));
			await Promise.all([
				cell.update((value) => ({ ...value, count: value.count + 1 })),
				cell.update((value) => ({ ...value, count: value.count + 1 })),
			]);
			expect(cell.reader.get().count).toBe(2);
			expect(changes).toEqual([1, 2]);
			expect(cell.reader.revision).toBe(2);
			expect('set' in cell.reader).toBe(false);
			expect('emit' in cell.reader.changes).toBe(false);
			await cell[asyncDispose]();
			expect(observed.closed).toBe(true);
			at.setUTCFullYear(2000);
			await using restored = await state.open({
				store,
				contract: 'progress.v1',
				value,
				initial: () => {
					throw new Error('Existing state must win.');
				},
			});
			expect(restored.reader.get().at).toBeInstanceOf(Date);
			expect(restored.reader.get().at.toISOString()).toBe('2026-11-01T00:00:00.000Z');
			expect(restored.reader.get().count).toBe(2);
			expect(restored.version).toBe(cell.version);
			expect(restored.reader.revision).toBe(0);
			expect((await store.load())?.value).toEqual({ count: 2, at: '2026-11-01T00:00:00.000Z' });
		});

		it('keeps a custom decoder from changing the wire candidate that will be saved', async () => {
			const wire = schema.object({ count: schema.number() });
			const value = codec.define({
				decode: schema.define((input) => {
					const decoded = wire.parse(input);
					// Some supplied codecs consume or normalize mutable input while decoding.
					(input as { count: number }).count = 99;
					return decoded.count;
				}),
				encode: schema.define((input) => ({ count: schema.number().parse(input) })),
			});
			const store = stores.memory();
			await using first = await state.open({ store, contract: 'count.v1', value, initial: () => 1 });
			expect(first.reader.get()).toBe(1);
			expect((await store.load())?.value).toEqual({ count: 1 });
			await using second = await state.open({ store, contract: 'count.v1', value });
			expect(second.reader.get()).toBe(1);
		});

		it('waits for the initial write and loads the winner of a creation race', async () => {
			const backing = stores.memory();
			const entered = gate(), release = gate();
			let creations = 0;
			const store: state.Store = {
				...backing,
				async save(snapshot, options) {
					entered.resolve();
					await release.promise;
					return await backing.save(snapshot, options);
				},
			};
			let opened = false;
			const first = state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => ++creations })
				.then(
					(cell) => {
						opened = true;
						return cell;
					},
				);
			const second = state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => ++creations });
			await entered.promise;
			expect(opened).toBe(false);
			expect(await backing.load()).toBe(undefined);
			release.resolve();
			await using a = await first;
			await using b = await second;
			expect(a.reader.get()).toBe(b.reader.get());
			expect(a.version).toBe(b.version);
			expect(creations).toBe(2);
		});

		it('captures opening policy and validated envelope metadata before awaited callbacks', async () => {
			const primary = stores.memory(), secondary = stores.memory();
			const entered = gate(), release = gate();
			const options = {
				store: {
					...primary,
					async load() {
						entered.resolve();
						await release.promise;
						return undefined;
					},
				} as state.Store,
				contract: 'count.v1',
				value: schema.number(),
				initial: () => 2,
			};
			const opening = state.open(options);
			await entered.promise;
			options.store = secondary;
			options.initial = () => 9;
			release.resolve();
			await using cell = await opening;
			expect(cell.reader.get()).toBe(2);
			expect((await primary.load())?.value).toBe(2);
			expect(await secondary.load()).toBe(undefined);

			const decoding = gate(), decoded = gate();
			const offered = { format: 1 as const, contract: 'text.v1', version: 'original', value: 'kept' };
			const store: state.Store = { concurrency: 'atomic', load: async () => offered, save: async () => false };
			const value = codec.define({
				encode: schema.string(),
				decode: schema.defineAsync(async (input) => {
					decoding.resolve();
					await decoded.promise;
					return schema.string().parse(input);
				}),
			});
			const loading = state.open({ store, contract: 'text.v1', value });
			await decoding.promise;
			offered.version = 'changed-by-provider';
			offered.value = 'changed-by-provider';
			decoded.resolve();
			await using loaded = await loading;
			expect(loaded.version).toBe('original');
			expect(loaded.reader.get()).toBe('kept');
		});

		it('rejects malformed, missing, incompatible, oversized and one-way representations without creating state', async () => {
			const store = stores.memory();
			await expect(state.open({ store, contract: 'count.v1', value: schema.number() })).rejects.toBeInstanceOf(
				ReferenceError,
			);
			await expect(state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => NaN })).rejects
				.toBeInstanceOf(TypeError);
			expect(await store.load()).toBe(undefined);
			await expect(
				state.open({ store, contract: 'text.v1', value: schema.string(), initial: () => '€', maximumBytes: 4 }),
			).rejects.toBeInstanceOf(RangeError);
			await expect(
				state.open({ store, contract: 'count.v1', value: schema.transform(schema.string(), Number), initial: () => 1 }),
			).rejects.toBeInstanceOf(TypeError);
			await using _cell = await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 1 });
			await expect(state.open({ store, contract: 'count.v2', value: schema.number(), initial: () => 99 })).rejects
				.toBeInstanceOf(TypeError);
			expect((await store.load())?.value).toBe(1);
			const malformed: state.Store = {
				...store,
				load: async () => ({
					format: 2,
					contract: 'count.v1',
					version: 'future',
					value: 1,
				} as unknown as state.SnapshotType),
			};
			await expect(state.open({ store: malformed, contract: 'count.v1', value: schema.number(), initial: () => 99 }))
				.rejects.toBeInstanceOf(TypeError);
		});
	});

	describe('commit publication and conflict recovery', () => {
		it('keeps reads and observations at the previous commit while a save is pending', async () => {
			const backing = stores.memory();
			const entered = gate(), release = gate();
			let saved = 0;
			const store: state.Store = {
				...backing,
				async save(snapshot, options) {
					if (options.expectedVersion !== undefined) {
						entered.resolve();
						await release.promise;
					}
					const accepted = await backing.save(snapshot, options);
					if (accepted) saved++;
					return accepted;
				},
			};
			await using cell = await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 0 });
			const observed: [number, number][] = [];
			using _subscription = cell.reader.subscribe(({ value }) => observed.push([value, saved]));
			const pending = cell.set(1);
			await entered.promise;
			expect(cell.reader.get()).toBe(0);
			expect(cell.reader.revision).toBe(0);
			expect(observed).toEqual([]);
			release.resolve();
			await pending;
			expect(observed).toEqual([[1, 2]]);
		});

		it('reports conflict without replaying an updater, then reloads before further mutations', async () => {
			const store = stores.memory();
			await using a = await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 0 });
			await using b = await state.open({ store, contract: 'count.v1', value: schema.number() });
			const original = b.version;
			let updates = 0;
			await a.set(2);
			await expect(b.update((value) => {
				updates++;
				return value + 1;
			})).rejects.toBeInstanceOf(state.ConflictError);
			expect(updates).toBe(1);
			expect(b.reader.get()).toBe(0);
			expect(b.version).toBe(original);
			expect(b.needsReload).toBe(true);
			await expect(b.update((value) => {
				updates++;
				return value + 1;
			})).rejects.toBeInstanceOf(state.ReloadRequiredError);
			expect(updates).toBe(1);
			await b.reload();
			expect(b.reader.get()).toBe(2);
			expect(b.version).toBe(a.version);
			expect(b.needsReload).toBe(false);
			await b.update((value) => value + 1);
			expect((await store.load())?.value).toBe(3);
		});

		it('keeps a reported conflict authoritative when the same save also observes cancellation', async () => {
			const backing = stores.memory();
			const controller = new AbortController();
			const store: state.Store = {
				...backing,
				async save(snapshot, options) {
					if (options.expectedVersion !== undefined) {
						controller.abort('canceled after conflict');
						return false;
					}
					return await backing.save(snapshot, options);
				},
			};
			await using cell = await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 0 });
			await expect(cell.set(1, { signal: controller.signal })).rejects.toBeInstanceOf(state.ConflictError);
			expect(cell.needsReload).toBe(true);
			let invoked = false;
			await expect(cell.update((value) => {
				invoked = true;
				return value + 1;
			})).rejects.toBeInstanceOf(state.ReloadRequiredError);
			expect(invoked).toBe(false);
			await cell.reload();
			expect(cell.needsReload).toBe(false);

			const opening = new AbortController();
			let loads = 0;
			const initialConflict: state.Store = {
				concurrency: 'atomic',
				async load() {
					loads++;
					return undefined;
				},
				async save() {
					opening.abort(null);
					return false;
				},
			};
			await expect(
				state.open({
					store: initialConflict,
					contract: 'count.v1',
					value: schema.number(),
					initial: () => 0,
					signal: opening.signal,
				}),
			)
				.rejects.toBe(null);
			expect(loads).toBe(1);
		});

		it('preserves cancellation from an updater before a same-value comparison can skip saving', async () => {
			const controller = new AbortController();
			await using cell = await state.open({
				store: stores.memory(),
				contract: 'count.v1',
				value: schema.number(),
				initial: () => 0,
			});
			await expect(cell.update((value) => {
				controller.abort(null);
				return value;
			}, { signal: controller.signal }))
				.rejects.toBe(null);
			expect(cell.needsReload).toBe(false);
			await cell.set(1);
			expect(cell.reader.get()).toBe(1);
		});

		it('retains uncertain commit failures and does not mistake them for observer diagnostics', async () => {
			const backing = stores.memory();
			let fail = false;
			const store: state.Store = {
				...backing,
				async save(snapshot, options) {
					if (fail) {
						await backing.save(snapshot, options);
						throw undefined;
					}
					return await backing.save(snapshot, options);
				},
			};
			await using cell = await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 0 });
			using _observer = cell.reader.subscribe(() => {
				throw new Error('observer');
			});
			fail = true;
			const error: unknown = await cell.set(1).catch((error: unknown) => error);
			expect(error).toBeInstanceOf(state.CommitError);
			if (!(error instanceof state.CommitError)) throw error;
			expect(error.outcome).toBe('unknown');
			expect(Object.hasOwn(error, 'cause')).toBe(true);
			expect(error.cause).toBe(undefined);
			expect(cell.reader.get()).toBe(0);
			expect(cell.reader.revision).toBe(0);
			expect(cell.observerError).toBe(undefined);
			await cell.reload();
			expect(cell.reader.get()).toBe(1);
			expect(cell.observerError).toBeInstanceOf(Error);
			fail = false;
			await cell.set(2);
			expect(cell.reader.get()).toBe(2);
		});
	});

	describe('bounded admission and cancellation', () => {
		it('releases capacity before resolving or rejecting each completed operation', async () => {
			await using cell = await state.open({
				store: stores.memory(),
				contract: 'count.v1',
				value: schema.number(),
				initial: () => 0,
				maximumPending: 1,
			});
			await cell.set(1);
			await cell.update((value) => value + 1);
			await expect(cell.update(() => {
				throw null;
			})).rejects.toBe(null);
			await cell.set(3);
			await cell.reload();
			expect(cell.reader.get()).toBe(3);
		});

		it('bounds pending work and promptly removes a canceled waiting updater', async () => {
			const backing = stores.memory();
			const entered = gate(), release = gate();
			const store: state.Store = {
				...backing,
				async save(snapshot, options) {
					if (options.expectedVersion !== undefined) {
						entered.resolve();
						await release.promise;
					}
					return await backing.save(snapshot, options);
				},
			};
			await using cell = await state.open({
				store,
				contract: 'count.v1',
				value: schema.number(),
				initial: () => 0,
				maximumPending: 2,
			});
			const first = cell.set(1);
			await entered.promise;
			const controller = new AbortController();
			let invoked = false;
			const waiting = cell.update((value) => {
				invoked = true;
				return value + 1;
			}, { signal: controller.signal });
			const stopped = expect(waiting).rejects.toBe('waiting canceled');
			await expect(cell.set(9)).rejects.toBeInstanceOf(RangeError);
			controller.abort('waiting canceled');
			await stopped;
			const next = cell.update((value) => value + 1);
			release.resolve();
			await Promise.all([first, next]);
			expect(invoked).toBe(false);
			expect(cell.reader.get()).toBe(2);
		});

		it('leaves a cell usable when cancellation happens during encoding before save starts', async () => {
			const entered = gate(), release = gate();
			let delay = false, saves = 0;
			const value = codec.define({
				decode: schema.number(),
				encode: schema.defineAsync(async (input) => {
					if (delay) {
						entered.resolve();
						await release.promise;
					}
					return schema.number().parse(input);
				}),
			});
			const backing = stores.memory();
			const store: state.Store = {
				...backing,
				async save(snapshot, options) {
					saves++;
					return await backing.save(snapshot, options);
				},
			};
			await using cell = await state.open({ store, contract: 'count.v1', value, initial: () => 0 });
			delay = true;
			const controller = new AbortController();
			const pending = cell.set(1, { signal: controller.signal });
			const stopped = expect(pending).rejects.toBe(null);
			await entered.promise;
			controller.abort(null);
			release.resolve();
			await stopped;
			expect(saves).toBe(1);
			expect(cell.needsReload).toBe(false);
			expect(cell.reader.get()).toBe(0);
			delay = false;
			await cell.set(2);
			expect(saves).toBe(2);
		});
	});

	describe('disposal and late acknowledgement', () => {
		it('joins an uncooperative save and suppresses its late publication after disposal', async () => {
			const backing = stores.memory();
			const entered = gate(), release = gate();
			let reentered: Promise<void> | undefined;
			let borrowedDisposals = 0;
			const store = {
				...backing,
				[asyncDispose]: async () => {
					borrowedDisposals++;
				},
				async save(snapshot: state.SnapshotType, options: state.SaveOptions) {
					if (options.expectedVersion !== undefined) {
						options.signal?.addEventListener('abort', () => {
							reentered = cell[asyncDispose]();
						}, { once: true });
						entered.resolve();
						await release.promise;
					}
					return await backing.save(snapshot, { expectedVersion: options.expectedVersion });
				},
			};
			const cell: state.StoredCell<number> = await state.open({
				store,
				contract: 'count.v1',
				value: schema.number(),
				initial: () => 0,
			});
			const seen: number[] = [];
			let completed = 0;
			using _observer = cell.reader.changes.subscribe({
				next: ({ value }) => seen.push(value),
				complete: () => completed++,
			});
			const pending = cell.set(1).catch((error: unknown) => error);
			await entered.promise;
			const closing = cell[asyncDispose]();
			expect(reentered).toBe(closing);
			expect(cell[asyncDispose]()).toBe(closing);
			expect(cell.closed).toBe(true);
			let joined = false;
			void closing.then(() => {
				joined = true;
			});
			await Promise.resolve();
			expect(joined).toBe(false);
			release.resolve();
			const error = await pending;
			expect(error).toBeInstanceOf(state.CommitError);
			if (!(error instanceof state.CommitError)) throw error;
			expect(error.outcome).toBe('committed');
			await closing;
			expect(completed).toBe(1);
			expect(seen).toEqual([]);
			expect(cell.reader.get()).toBe(0);
			expect((await backing.load())?.value).toBe(1);
			expect(borrowedDisposals).toBe(0);
		});

		it('completes every observation and joins active I/O before rejecting a cleanup failure', async () => {
			const backing = stores.memory();
			const entered = gate(), release = gate();
			const store: state.Store = {
				...backing,
				async save(snapshot, options) {
					if (options.expectedVersion !== undefined) {
						entered.resolve();
						await release.promise;
					}
					return await backing.save(snapshot, { expectedVersion: options.expectedVersion });
				},
			};
			const cell = await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 0 });
			const controller = new AbortController();
			const failure = new Error('unlink failed after removal');
			const remove = controller.signal.removeEventListener.bind(controller.signal);
			Object.defineProperty(controller.signal, 'removeEventListener', {
				value: (...args: Parameters<AbortSignal['removeEventListener']>) => {
					remove(...args);
					throw failure;
				},
			});
			const first = cell.reader.subscribe(() => {}, { signal: controller.signal });
			const second = cell.reader.subscribe(() => {});
			let completed = 0;
			const observable = cell.reader.changes.subscribe({ complete: () => completed++ });
			const writing = cell.set(1).catch((error: unknown) => error);
			await entered.promise;
			const closing = cell[asyncDispose]();
			let settled = false;
			const result = closing.then(() => {
				settled = true;
			}, (error: unknown) => {
				settled = true;
				return error;
			});
			try {
				expect(cell[asyncDispose]()).toBe(closing);
				expect(cell.closed && first.closed && second.closed && observable.closed).toBe(true);
				expect(completed).toBe(1);
				await Promise.resolve();
				expect(settled).toBe(false);
			} finally {
				release.resolve();
			}
			expect(await writing).toBeInstanceOf(state.CommitError);
			expect(await result).toBe(failure);
			expect((await backing.load())?.value).toBe(1);
			expect(cell.reader.get()).toBe(0);
		});

		it('checks disposal again between storage acknowledgement and the publishing continuation', async () => {
			const backing = stores.memory();
			let closing: Promise<void> | undefined;
			const store: state.Store = {
				...backing,
				async save(snapshot, options) {
					const result = await backing.save(snapshot, options);
					if (options.expectedVersion !== undefined) {
						queueMicrotask(() =>
							queueMicrotask(() => {
								closing = cell[asyncDispose]();
							})
						);
					}
					return result;
				},
			};
			const cell: state.StoredCell<number> = await state.open({
				store,
				contract: 'count.v1',
				value: schema.number(),
				initial: () => 0,
			});
			const seen: number[] = [];
			using _observer = cell.reader.subscribe(({ value }) => seen.push(value));
			await expect(cell.set(1)).rejects.toBeInstanceOf(state.CommitError);
			await closing;
			expect(seen).toEqual([]);
			expect(cell.reader.get()).toBe(0);
			expect((await backing.load())?.value).toBe(1);
		});

		it('reports an acknowledged initial write when cancellation wins before open can return', async () => {
			const backing = stores.memory();
			const controller = new AbortController();
			const store: state.Store = {
				...backing,
				async save(snapshot, options) {
					const result = await backing.save(snapshot, options);
					queueMicrotask(() => queueMicrotask(() => controller.abort('open canceled')));
					return result;
				},
			};
			const error: unknown = await state.open({
				store,
				contract: 'count.v1',
				value: schema.number(),
				initial: () => 1,
				signal: controller.signal,
			}).catch((error: unknown) => error);
			expect(error).toBeInstanceOf(state.CommitError);
			if (!(error instanceof state.CommitError)) throw error;
			expect(error.outcome).toBe('committed');
			expect(error.cause).toBe('open canceled');
			expect((await backing.load())?.value).toBe(1);
		});
	});
});
