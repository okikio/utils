/** Bounded traversal and exact wire conversion include their validation costs. @module */
import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as schema from './mod.ts';
import * as codec from './codec/mod.ts';
import { ElapsedSchema, InstantSchema } from './time.ts';
import { elapsedNanoseconds } from '@okikio/duration/conversion';

interface Branch {
	value: number;
	children: Branch[];
}
for (const depth of [2, 32]) {
	const Tree: schema.Reader<Branch, Branch> = schema.lazy<Branch>(
		() => schema.object({ value: schema.number(), children: schema.array(Tree) }),
		{ maximumDepth: 128, maximumNodes: 1000 },
	);
	let input: Branch = { value: 1, children: [] };
	for (let index = 1; index < depth; index++) input = { value: index, children: [input] };
	const parsed = Tree.parse(input);
	// A matching root value does not prove that deeper children were retained.
	// This finite JSON corpus compares values independently of the safe record prototype.
	deepStrictEqual(JSON.parse(JSON.stringify(parsed)), input);
	let original: Branch | undefined = input;
	let copied: Branch | undefined = parsed;
	while (original && copied) {
		strictEqual(Object.getPrototypeOf(copied), null);
		notStrictEqual(copied, original);
		notStrictEqual(copied.children, original.children);
		original = original.children[0];
		copied = copied.children[0];
	}
	const identity = schema.lazy(() => schema.unknown(), { maximumDepth: 128, maximumNodes: 1000 });
	group(`recursive tree depth ${depth}`, () => {
		bench('guard and validated fresh tree', () => do_not_optimize(Tree.parse(input)));
		bench('guard only; no child validation or copy', () => do_not_optimize(identity.parse(input)));
	});
}
const timestamp = '1969-12-31T23:59:59.999999999Z';
strictEqual(await codec.encode(InstantSchema, await codec.decode(InstantSchema, timestamp)), timestamp);
strictEqual(elapsedNanoseconds(await codec.decode(ElapsedSchema, 'P1D')), 86400000000000n);
group('exact Temporal wire validation', () => {
	bench('nanosecond instant decode', async () => do_not_optimize(await codec.decode(InstantSchema, timestamp)));
	bench(
		'fixed duration decode and normalization',
		async () => do_not_optimize(await codec.decode(ElapsedSchema, 'P1D')),
	);
});
await run();
