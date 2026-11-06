/** Resource lifetimes and effect acceptance have distinct ownership costs; external provider I/O is excluded. */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as resource from './resource/mod.ts';
import * as effect from './effect/mod.ts';
import { run } from './fixtures/bench.ts';
const Value = resource.define<{ value: number }>()({ id: 'bench.value', description: 'A short-lived numeric value.' });
for (const count of [1, 32, 256]) {
	const cycle = async function (owned: boolean): Promise<number> {
		let sum = 0;
		let closed = 0;
		for (let index = 0; index < count; index++) {
			await using ctx = context.create({ id: 'resource', clock: new context.TestClock() });
			if (owned) {
				await using values = resource.create(
					resource.implementations(resource.implement(Value, {
						create: ({ ctx }) => {
							ctx.defer(() => {
								closed++;
							});
							return { value: index };
						},
					})),
					{ host: {}, ctx },
				);
				sum += (await values.get(ctx, Value)).value;
			} else {
				try {
					sum += ({ value: index }).value;
				} finally {
					closed++;
				}
			}
		}
		strictEqual(closed, count);
		return sum;
	};
	strictEqual(await cycle(true), count * (count - 1) / 2);
	strictEqual(await cycle(false), count * (count - 1) / 2);
	group(`resource ${count} acquire/use/dispose lifetimes`, () => {
		bench('owned validated definition lookup and cleanup', async () => do_not_optimize(await cycle(true)));
		bench(
			'direct value with same cleanup count, no collection contract',
			async () => do_not_optimize(await cycle(false)),
		);
	});
}
const Saved = effect.define({ id: 'bench.saved', value: schema.number() });
await using owner = context.create({ id: 'effects', clock: new context.TestClock() });
let accepted = 0;
const effects = effect.scope(owner, {
	effects: [Saved],
	emitter: {
		async emit() {
			accepted++;
		},
	},
});
await effect.emit(effects, Saved, 1, { key: 'one' });
strictEqual(accepted, 1);
group('effect acceptance, warm local emitter', () => {
	bench(
		'validated effect with definition and occurrence envelope',
		async () => do_not_optimize(await effect.emit(effects, Saved, 1, { key: 'one' })),
	);
	bench('direct accepting sink only, no validation or envelope', async () => {
		accepted++;
		do_not_optimize(accepted);
	});
});
await run();
