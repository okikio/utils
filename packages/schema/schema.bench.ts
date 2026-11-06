/** Measure explicit decode and encode separately; both paths pay their own validation. */
import { bench, do_not_optimize, group } from 'mitata';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { run } from './fixtures/bench.ts';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
const NumberCodec = codec.define({
	decode: schema.transform(schema.string(), Number),
	encode: schema.transform(schema.number(), String),
});
for (const count of [2, 16]) {
	const Definition = codec.tuple(Array.from({ length: count }, () => NumberCodec));
	const wire = Array.from({ length: count }, (_, index) => String(index));
	const values = wire.map(Number);
	const decoded = await codec.decode(Definition, wire);
	// Compare full arrays: some() accepts an empty result and join() loses boundaries.
	deepStrictEqual(decoded, values);
	deepStrictEqual(await codec.encode(Definition, values), wire);
	group(`codec tuple length ${count}`, () => {
		bench('tuple decode', async () => {
			do_not_optimize(await codec.decode(Definition, wire));
		});
		bench('tuple encode', async () => {
			do_not_optimize(await codec.encode(Definition, values));
		});
		bench('manual sequential validated decode', async () => {
			const output = [];
			for (const value of wire) output.push(await codec.decode(NumberCodec, value));
			do_not_optimize(Object.freeze(output));
		});
	});
}

for (const count of [100, 10000]) {
	const InvalidSchema = schema.array(schema.object({ value: schema.number() }));
	const invalid = Array.from({ length: count }, () => ({ value: 'bad' }));
	const capped = await schema.validate(InvalidSchema, invalid, { maximumIssues: 2, maximumPathLength: 1 });
	if (capped.issues?.length !== 2 || capped.issues === undefined || !capped.truncated) {
		throw new Error('Native accumulation oracle failed.');
	}
	deepStrictEqual(capped.issues.map((issue) => issue.path), [[0], [1]]);
	const complete = await schema.validate(InvalidSchema, invalid);
	strictEqual(complete.issues?.length, count);
	deepStrictEqual(complete.issues?.map((issue) => issue.path), invalid.map((_, index) => [index, 'value']));
	group(`native invalid array ${count}`, () => {
		bench(
			'bounded native evidence, two issues',
			async () =>
				do_not_optimize(await schema.validate(InvalidSchema, invalid, { maximumIssues: 2, maximumPathLength: 1 })),
		);
		bench('complete native evidence', async () => do_not_optimize(await schema.validate(InvalidSchema, invalid)));
	});
}
await run();
