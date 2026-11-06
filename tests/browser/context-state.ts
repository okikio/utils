/** Native browser persistence and cross-document fixture actions through the public Context/Storage exports. @module */
import * as state from '@okikio/context/state';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { DateSchema } from '@okikio/schema/time';
import * as web from '@okikio/storage/state/web';

/** Fail at a browser-observable contract without depending on adapter implementation details. */
function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Native page-local checks own their temporary keys and always release held locks before returning. */
export async function contextState(): Promise<string[]> {
	const key = 'utils-state-browser-' + crypto.randomUUID();
	const checks: string[] = [];
	try {
		const migrationKey = key + '-migration';
		try {
			const store = web.open({ storage: localStorage, key: migrationKey, mode: 'locked', locks: navigator.locks });
			{
				await using _old = await state.open({
					store,
					contract: 'browser.v1',
					value: schema.number(),
					initial: () => 2,
				});
			}
			await using migrated = await state.open({
				store,
				contract: 'browser.v2',
				value: schema.object({ count: schema.number() }),
				migrations: [state.migration('browser.v1', schema.number(), (count) => ({ count }))],
			});
			assert(
				migrated.reader.get().count === 2 && (await store.load())?.contract === 'browser.v2',
				'Native locked Web Storage migration did not save before publication.',
			);
			checks.push('validated state migration through native locked Web Storage');
		} finally {
			localStorage.removeItem(migrationKey);
		}

		const value = codec.object({ cursor: codec.identity(schema.string()), at: DateSchema });
		for (const storage of [localStorage, sessionStorage]) {
			const store = web.open({ storage, key, mode: 'locked', locks: navigator.locks });
			{
				await using cell = await state.open({
					store,
					contract: 'cursor.v1',
					value,
					initial: () => ({ cursor: 'page-1', at: new Date('2026-11-01T00:00:00.000Z') }),
				});
				const observed: string[] = [];
				using _subscription = cell.reader.subscribe(({ value }) => observed.push(value.cursor));
				await cell.update((value) => ({ ...value, cursor: 'page-2' }));
				assert(observed.join() === 'page-2', 'A saved browser change was not observed exactly once.');
			}
			await using reopened = await state.open({ store, contract: 'cursor.v1', value });
			assert(reopened.reader.get().cursor === 'page-2', 'Reopening lost native stored state.');
			assert(reopened.reader.get().at instanceof Date, 'Reopening lost the application Date codec.');
			assert(reopened.reader.revision === 0, "A new reader inherited another owner's local revision.");
		}
		checks.push('native localStorage and sessionStorage save, dispose, reopen and decode Date state');
		localStorage.removeItem(key);
		const first = web.open({ storage: localStorage, key, mode: 'locked', locks: navigator.locks });
		const second = web.open({ storage: localStorage, key, mode: 'locked', locks: navigator.locks });
		await using a = await state.open({ store: first, contract: 'count.v1', value: schema.number(), initial: () => 0 });
		await using b = await state.open({ store: second, contract: 'count.v1', value: schema.number() });
		const outcomes = await Promise.allSettled([a.set(1), b.set(2)]);
		assert(
			outcomes.filter((result) => result.status === 'fulfilled').length === 1,
			'Native locks allowed two stale replacements.',
		);
		const conflict = outcomes.find((result) => result.status === 'rejected');
		assert(
			conflict?.status === 'rejected' && conflict.reason instanceof state.ConflictError,
			'A competing write did not expose conflict.',
		);
		await Promise.all([a.reload(), b.reload()]);
		assert(a.version === b.version && a.reader.get() === b.reader.get(), 'Reload did not reconcile browser writers.');
		checks.push('native Web Locks serialize conditional replacements and explicit reload reconciles readers');

		const lockName = 'utils-state-held-' + crypto.randomUUID();
		const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		const held = navigator.locks.request(lockName, async () => {
			entered.resolve();
			await release.promise;
		});
		await entered.promise;
		try {
			const controller = new AbortController();
			const blocked = web.open({ storage: localStorage, key, mode: 'locked', locks: navigator.locks, lockName });
			const waiting = blocked.load({ signal: controller.signal }).then(
				() => {
					throw new Error('A canceled pending lock was granted.');
				},
				(reason: unknown) => reason,
			);
			controller.abort('page closed');
			assert(await waiting === 'page closed', 'Native lock cancellation lost its reason.');
		} finally {
			release.resolve();
			await held;
		}
		checks.push('native pending lock cancellation settles without acquiring or retaining the held lock');
		return checks;
	} finally {
		localStorage.removeItem(key);
		sessionStorage.removeItem(key);
	}
}

/** Seed or update a caller-owned test key before the harness reloads the document or opens a second same-origin page. */
export async function writeBrowserState(key: string, value: number): Promise<{ value: number; version: string }> {
	await using cell = await state.open({
		store: web.open({ storage: localStorage, key, mode: 'locked', locks: navigator.locks }),
		contract: 'browser.restart.v1',
		value: schema.number(),
		initial: () => value,
	});
	await cell.set(value);
	return { value: cell.reader.get(), version: cell.version };
}

/** Require an existing snapshot in a fresh document; this action never supplies an initial value that could hide loss. */
export async function readBrowserState(key: string): Promise<{ value: number; version: string }> {
	await using cell = await state.open({
		store: web.open({ storage: localStorage, key, mode: 'locked', locks: navigator.locks }),
		contract: 'browser.restart.v1',
		value: schema.number(),
	});
	return { value: cell.reader.get(), version: cell.version };
}

/** Race this action from two independent same-origin pages with the same expected token; exactly one must return true. */
export async function replaceBrowserState(key: string, expectedVersion: string, value: number): Promise<boolean> {
	const store = web.open({ storage: localStorage, key, mode: 'locked', locks: navigator.locks });
	return await store.save(
		state.SnapshotSchema.parse({
			format: 1,
			contract: 'browser.restart.v1',
			version: crypto.randomUUID(),
			value,
		}),
		{ expectedVersion },
	);
}
