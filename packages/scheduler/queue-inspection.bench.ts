/** Bounded metadata pages and idempotent redrive; retained payloads are excluded from reports. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as context from '@okikio/context';
import * as queue from '@okikio/scheduler/queue';
await using ctx = context.create({ id: 'queue-inspection-bench' });
await using owners = new AsyncDisposableStack();
for (const count of [1000, 10000]) {
	const jobs = owners.use(queue.memory<number, number>({
		capacity: count,
		retention: { limit: count, duration: { hours: 1 } },
	}));
	let source!: queue.QueueRef;
	for (let index = 0; index < count; index++) {
		source = await jobs.add(ctx, index);
		if (index % 2 === 0) await jobs.cancel(ctx, source);
	}
	await jobs.cancel(ctx, source);
	const copy = await jobs.redrive(ctx, source, { key: 'copy' });
	if ((await jobs.redrive(ctx, source, { key: 'copy' })).id !== copy.id) {
		throw new Error('Redrive idempotency oracle failed.');
	}
	for (const size of [20, 100]) {
		const options = { state: 'cancelled' as const, limit: size, maximumScanned: size * 2 };
		const page = await jobs.inspect(options);
		if (page.entries.length !== size || page.scanned > size * 2 || !page.cursor) {
			throw new Error('Page bounds oracle failed.');
		}
		group(`memory queue ${count} mixed items, page ${size}`, () => {
			bench('first bounded filtered page', async () => do_not_optimize(await jobs.inspect(options)));
			bench(
				'continued bounded filtered page',
				async () => do_not_optimize(await jobs.inspect({ ...options, cursor: page.cursor! })),
			);
		});
	}
	group(`memory redrive ${count} retained items`, () => {
		bench('existing-key deduplication', async () => do_not_optimize(await jobs.redrive(ctx, source, { key: 'copy' })));
	});
}
await run();
