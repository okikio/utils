import type { Observable } from '@okikio/observables';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { DateSchema } from '@okikio/schema/time';
import * as state from './state.ts';

/** Compile caller inference independently of any selected storage adapter. This fixture never executes. */
async function storedTypes(store: state.Store): Promise<void> {
	const definition = codec.object({ count: codec.identity(schema.number()), at: DateSchema });
	await using cell = await state.open({
		store,
		contract: 'checkpoint.v1',
		value: definition,
		initial: () => ({ count: 0, at: new Date() }),
	});
	const reader: state.Reader<{ count: number; at: Date }> = cell.reader;
	const observations: Observable<state.Change<{ count: number; at: Date }>> = reader.changes;
	const saved: Promise<void> = cell.set({ count: 1, at: new Date() });
	const changed: Promise<void> = cell.update((previous) => ({ ...previous, count: previous.count + 1 }));
	const loaded: Promise<void> = cell.reload();
	void observations;
	void saved;
	void changed;
	void loaded;
	// @ts-expect-error Stored writes must be awaited; they do not return a synchronous Cell result.
	const synchronous: void = cell.set({ count: 2, at: new Date() });
	void synchronous;
	// @ts-expect-error An updater derives one value synchronously; asynchronous work happens before admission.
	cell.update(async (previous) => ({ ...previous, count: 2 }));
	// @ts-expect-error Application output contains a Date even though the wire representation contains text.
	cell.set({ count: 3, at: '2026-11-01T00:00:00.000Z' });
	// @ts-expect-error A borrowed reader cannot persist a replacement.
	reader.set({ count: 4, at: new Date() });
	// @ts-expect-error Local notification batches cannot imply database transactions.
	cell.batch(() => {});
	// @ts-expect-error The read facade does not confer disposal authority over the owner.
	reader[Symbol.asyncDispose]();
	await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 0 });
	// @ts-expect-error The initial factory returns the schema's application output.
	await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 'zero' });
	// @ts-expect-error Save must report conflict or acknowledged persistence explicitly.
	const invalidStore: state.Store = { concurrency: 'atomic', load: async () => undefined, save: async () => {} };
	void invalidStore;
}
void storedTypes;
