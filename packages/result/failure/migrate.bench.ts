/** Measure checked saved-failure conversion; construction and fixture validation stay outside timing. */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize } from 'mitata';
import * as schema from '@okikio/schema';
import * as failure from './mod.ts';
import { migrate } from './migrate.ts';
import { run } from '../fixtures/bench.ts';

const Previous = failure.define({
	id: 'asset.v1',
	description: 'Missing',
	data: schema.object({ path: schema.string() }),
});
const Current = failure.define({
	id: 'asset.v2',
	description: 'Missing',
	data: schema.object({ id: schema.string() }),
});
const saved = { id: Previous.id, data: { path: 'asset-7' }, message: 'Missing' };
const transition = { from: Previous, to: Current, convert: ({ path }: { path: string }) => ({ id: path }) };
strictEqual(
	JSON.stringify(await migrate(saved, transition)),
	JSON.stringify({ id: Current.id, data: { id: 'asset-7' }, message: 'Missing' }),
);

bench('validate historical failure, convert data, validate and encode replacement', async () => {
	do_not_optimize(await migrate(saved, transition));
});
await run();
