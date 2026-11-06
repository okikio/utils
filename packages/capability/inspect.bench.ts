/** Inspection must not acquire configured resources; compare bounded live reports with static graph documents. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { AsyncDisposableStack } from '@okikio/dispose';
import * as resource from './resource/mod.ts';
import * as context from '@okikio/context';
await using owner = context.create({ id: 'resource-inspect', clock: new context.TestClock() });
await using reportOwners = new AsyncDisposableStack();
for (const count of [10, 100, 1000]) {
	const implementations = resource.implementations(...Array.from({ length: count }, (_, index) => {
		const Definition = resource.define<number>()({
			id: `bench.resource.${index}`,
			description: 'Unacquired diagnostic fixture.',
		});
		return resource.implement(Definition, {
			create() {
				throw new Error('Inspection must not acquire.');
			},
		});
	}));
	const collection = reportOwners.use(resource.create(implementations, { ctx: owner, host: {} }));
	if (resource.inspect(collection, { maximumResources: count }).resources.some((item) => item.state !== 'configured')) {
		throw new Error('Resource inspection acquired a value.');
	}
	group(`resource inspection ${count} definitions`, () => {
		bench(
			'bounded 20-entry lifetime report',
			() => do_not_optimize(resource.inspect(collection, { maximumResources: 20 })),
		);
		bench(
			'static full graph document, different information',
			() =>
				do_not_optimize(
					resource.document(implementations.implementations.map((entry) => entry.definition), implementations),
				),
		);
	});
}
await run();
