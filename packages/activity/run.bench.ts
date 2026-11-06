/** Direct validated attempts isolate Activity ownership from process/Worker provider startup. */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as activity from './mod.ts';
import * as engine from './engine.ts';
import { run } from './fixtures/bench.ts';
const NumberSchema = schema.number();
const Local = engine.define({ id: 'bench.local' });
const Add = activity.define({
	id: 'bench.add',
	version: '1',
	input: codec.identity(NumberSchema),
	result: codec.identity(NumberSchema),
	placement: engine.require(Local),
});
const live = activity.implement(Add, {
	async run(ctx) {
		return ctx.input + 1;
	},
});
await using parent = context.create({ id: 'activity-bench', clock: new context.TestClock() });
await using resources = resource.create(resource.implementations(), { host: {}, ctx: parent });
for (const count of [1, 100]) {
	const cycle = async function (mode: 'attempt' | 'call' | 'direct', verify = false): Promise<number> {
		let sum = 0;
		for (let index = 0; index < count; index++) {
			const result = mode === 'call'
				? await activity.call(live, index, { ctx: parent, engine: Local, resources })
				: mode === 'attempt'
				? await activity.run({
					implementation: live,
					engine: Local,
					input: index,
					ctx: parent,
					resources,
					jobId: 'bench:' + index,
					attempt: 1,
				})
				: await schema.parse(NumberSchema, (await schema.parse(NumberSchema, index)) + 1);
			if (verify) strictEqual(result, index + 1);
			sum += result;
		}
		return sum;
	};
	// All paths must produce the same answers before measurements begin. The call
	// facade includes identity/lifetime setup; the attempt path borrows that setup.
	for (const mode of ['attempt', 'call', 'direct'] as const) {
		strictEqual(await cycle(mode, true), count * (count + 1) / 2);
	}
	group(`Activity ${count} local validated attempts`, () => {
		bench('owned Activity input, operation and result', async () => do_not_optimize(await cycle('attempt')));
		bench('local call with generated identity and owned lifetime', async () => do_not_optimize(await cycle('call')));
		bench(
			'direct operation with same number validation, no attempt ownership',
			async () => do_not_optimize(await cycle('direct')),
		);
	});
}
await run();
