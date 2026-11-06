/** Context snapshot migration through a Storage slot, including validation and ownership. */
import { bench, do_not_optimize, group } from 'mitata';
import * as state from '@okikio/context/state';
import * as stores from '@okikio/storage/state';
import * as schema from '@okikio/schema';
import { run } from '#tools/bench/run.ts';
const LegacySchema = schema.object({ count: schema.number() });
const CurrentSchema = schema.object({ total: schema.number() });
const conversion = state.migration('bench.v1', LegacySchema, ({ count }) => ({ total: count }));
/** Fresh slot measures initial write, reopen/migration and joined cell ownership without persistent benchmark history. */
async function reopen(migrate: boolean): Promise<number> {
	const store = stores.memory();
	if (migrate) {
		await using _old = await state.open({
			store,
			contract: 'bench.v1',
			value: LegacySchema,
			initial: () => ({ count: 2 }),
		});
	} else {
		await using _current = await state.open({
			store,
			contract: 'bench.v2',
			value: CurrentSchema,
			initial: () => ({ total: 2 }),
		});
	}
	await using accepted = await state.open({
		store,
		contract: 'bench.v2',
		value: CurrentSchema,
		migrations: [conversion],
	});
	if (accepted.reader.get().total !== 2 || (await store.load())?.contract !== 'bench.v2') {
		throw new Error('Migration persistence oracle failed.');
	}
	return accepted.reader.get().total;
}
await reopen(true);
await reopen(false);
group('memory snapshot reopen: one value, validation and disposal', () => {
	bench('current contract, no conversion write', async () => do_not_optimize(await reopen(false)));
	bench('old contract, validated conversion and conditional save', async () => do_not_optimize(await reopen(true)));
});
await run();
