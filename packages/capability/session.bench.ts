/**
 * Compare serial and shared admission for the same sixteen counter increments.
 * Each sample includes construction, seventeen borrows (one inspects the result),
 * deferred cleanup, physical close and removal of the retained authority record.
 * This memory-only workload does not measure transport, SQL or CPU parallelism.
 * @module
 */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as context from '@okikio/context';
import * as session from './resource/session/mod.ts';

/** Local mutable state; finished counts cleanup that must join before result inspection. */
interface CounterType {
	count: number;
	finished: number;
}

/** Same counter work; explicit sharing changes admission only. All owned cleanup remains inside timing. */
async function cycle(concurrency: number): Promise<void> {
	await using ctx = context.create({ id: 'session-bench' });
	const registry = session.registry(session.memory());
	let closed = 0;
	await using owner = session.owner({
		ctx,
		registry,
		owner: { id: 'bench', generation: 1 },
		resource: 'counter',
		maximum: 1,
		policy: { leaseMs: 30000, idleMs: 30000, borrowMs: 10000, maximumBorrows: concurrency },
		async create(): Promise<session.Resource<CounterType>> {
			return {
				value: { count: 0, finished: 0 },
				async [Symbol.asyncDispose]() {
					closed++;
				},
			};
		},
	});

	// Hold total work fixed. Sharing changes the number of simultaneous borrows,
	// not the number of increments or deferred cleanups charged to a sample.
	const reference = await owner.create();
	for (let start = 0; start < 16; start += concurrency) {
		await Promise.all(Array.from({ length: concurrency }, () =>
			owner.use(reference, (value, borrow) => {
				value.count++;
				borrow.defer(() => {
					value.finished++;
				});
			})));
	}

	const result = await owner.use(reference, (value) => ({ ...value }));
	if (result.count !== 16 || result.finished !== 16) throw new Error('Session work/cleanup oracle failed.');

	// Include resource close and retention removal in the measured lifetime.
	await owner.close(reference);
	if (closed !== 1 || owner.stats().sessions !== 0) throw new Error('Session ownership oracle failed.');
	await registry.remove(reference.id);
	do_not_optimize(result);
}

for (const concurrency of [1, 8]) {
	// --check still exercises every workload and its ownership oracle once.
	await cycle(concurrency);
	group(
		`sixteen counter borrows plus inspection, ${
			concurrency === 1 ? 'exclusive serial' : 'eight bounded shared'
		} admissions`,
		() => {
			bench('complete owned session lifetime', () => cycle(concurrency));
		},
	);
}
await run();
