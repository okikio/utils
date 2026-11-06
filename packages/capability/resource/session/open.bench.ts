/** Compare one retained counter lifetime through explicit composition and the owned default. No I/O or transport. @module */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '../../fixtures/bench.ts';
import * as context from '@okikio/context';
import { AsyncDisposableStack } from '@okikio/dispose';
import * as resource from '../mod.ts';
import * as session from './mod.ts';

/** The same binding is used by both paths; each acquisition gets independent state. */
const Counter = resource.define<{ value: number }>()({ id: 'bench.counter', description: 'Retain one counter.' });
let acquired = 0;
let closed = 0;
const binding = resource.implement(Counter, {
	create({ ctx }) {
		acquired++;
		ctx.defer(() => {
			closed++;
		});
		return { value: 0 };
	},
});

/** Measure the same creation, two borrows and cleanup regardless of owner construction. */
async function use(owner: session.Owner<{ value: number }>): Promise<void> {
	const reference = await owner.create();
	await owner.use(reference, (counter) => {
		counter.value++;
	});
	const result = await owner.use(reference, (counter) => counter.value);
	if (result !== 1) throw new Error('Retained state oracle failed.');
	await owner.close(reference);
	do_not_optimize(result);
}
/** Explicit configuration is useful when the application already owns authority and a host lifetime. */
async function explicit(): Promise<void> {
	await using ctx = context.create({ id: 'session-bench' });
	await using owner = session.owner({
		ctx,
		registry: session.registry(session.memory()),
		owner: { id: 'bench', generation: 1 },
		resource: Counter.id,
		maximum: 100,
		policy: { leaseMs: 30000, borrowMs: 30000, idleMs: 300000, maximumBorrows: 1 },
		async create() {
			await using construction = new AsyncDisposableStack();
			const collection = construction.use(await resource.open(binding, { ctx }));
			const value = await collection.get(Counter);
			// Transfer ownership beyond factory return; failure before move still closes partial work.
			const cleanup = construction.move();
			return { value, [Symbol.asyncDispose]: () => cleanup.disposeAsync() };
		},
	});
	await use(owner);
}
/** The owned path includes default authority, Context and resource composition inside timing. */
async function owned(): Promise<void> {
	await using owner = await session.open(binding);
	await use(owner);
}

for (const operation of [explicit, owned]) {
	const before = acquired;
	await operation();
	if (acquired !== before + 1 || closed !== acquired) throw new Error('Session lifetime oracle failed.');
}
group('one retained counter, two borrows and joined close; no I/O', () => {
	bench('explicit authority and acquisition', explicit);
	bench('owned local defaults', owned);
});
await run();
