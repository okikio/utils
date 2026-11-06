/** Compare complete lazy collection lifetimes; both variants create, borrow and close the same Map. @module */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '../fixtures/bench.ts';
import * as context from '@okikio/context';
import * as resource from './mod.ts';

const Notes = resource.define<Map<string, string>>()({ id: 'bench.notes', description: 'Save one note.' });
let opened = 0;
let closed = 0;
const binding = resource.implement(Notes, {
	create({ ctx }) {
		opened++;
		ctx.defer(() => {
			closed++;
		});
		return new Map<string, string>();
	},
});
const bindings = resource.implementations(binding);

/** The advanced path supplies the same lifetime explicitly; normalization is outside this baseline's timed work. */
async function explicit(): Promise<void> {
	await using ctx = context.create({ id: 'benchmark' });
	await using collection = resource.create(bindings, { ctx, host: undefined });
	const value = await collection.get(ctx, Notes);
	value.set('one', 'Hello');
	do_not_optimize(value.get('one'));
}
/** The common path also owns parent creation and binding normalization inside each measured lifetime. */
async function owned(): Promise<void> {
	await using collection = await resource.open(binding);
	const value = await collection.get(Notes);
	value.set('one', 'Hello');
	do_not_optimize(value.get('one'));
}

for (const operation of [explicit, owned]) {
	const before = opened;
	await operation();
	if (opened !== before + 1 || closed !== opened) throw new Error('Collection lifetime oracle failed.');
}
group('one Map acquisition, borrow and joined cleanup; no I/O', () => {
	bench('explicit collection and Context', explicit);
	bench('owned collection and normalized binding', owned);
});
await run();
