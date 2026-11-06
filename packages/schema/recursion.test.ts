import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from './mod.ts';

interface Branch {
	value: number;
	children: Branch[];
}
const limits = { maximumDepth: 16, maximumNodes: 100 };

describe('bounded native recursion', () => {
	it('resolves once and parses self recursion with exact paths and fresh containers', async () => {
		let calls = 0;
		const Tree: schema.Reader<Branch, Branch> = schema.lazy<Branch>(() => {
			calls++;
			return schema.object({ value: schema.number(), children: schema.array(Tree) });
		}, limits);
		expect(calls).toBe(0);
		const value = { value: 1, children: [{ value: 2, children: [] }] };
		const parsed = Tree.parse(value);
		expect(parsed.children[0]?.value).toBe(2);
		expect(parsed).not.toBe(value);
		expect(calls).toBe(1);
		const invalid = await schema.validate(Tree, { value: 1, children: [{ value: 'bad', children: [] }] });
		expect(invalid.issues?.[0]?.path).toEqual(['children', 0, 'value']);
		expect(calls).toBe(1);
	});
	it('rejects cycles, depth, node overflow and accessors before user validators run', () => {
		let calls = 0;
		const Tree = schema.lazy(() => {
			calls++;
			return schema.unknown();
		}, { maximumDepth: 2, maximumNodes: 3 });
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		for (
			const value of [
				cyclic,
				{ a: { b: {} } },
				[1, 2, 3],
				Object.defineProperty({}, 'secret', {
					enumerable: true,
					get() {
						throw new Error('must not execute');
					},
				}),
			]
		) {
			expect(() => Tree.parse(value)).toThrow(schema.SchemaValidationError);
		}
		expect(calls).toBe(0);
	});
	it('allows shared acyclic references but counts visits and keeps invocation budgets independent', () => {
		const shared = { value: 1 };
		const Tree = schema.lazy(() => schema.unknown(), { maximumDepth: 3, maximumNodes: 4 });
		expect(() => Tree.parse([shared, shared])).toThrow(schema.SchemaValidationError);
		expect(Tree.parse([shared])).toEqual([shared]);
		expect(Tree.parse([shared])).toEqual([shared]);
	});
	it('preflights separate sibling roots even when the same lazy definition already succeeded', async () => {
		const Leaf = schema.lazy(() => schema.unknown(), { maximumDepth: 2, maximumNodes: 2 });
		const Pair = schema.object({ a: Leaf, b: Leaf });
		const value = await schema.validate(Pair, { a: {}, b: [1, 2] });
		expect(value.issues?.[0]?.path).toEqual(['b']);
	});
	it('bounds mutual factories without a data-consuming schema and does not resolve factories for projection', () => {
		const A: schema.Reader<unknown> = schema.lazy(() => B, limits);
		const B: schema.Reader<unknown> = schema.lazy(() => A, limits);
		expect(() => A.parse(1)).toThrow(schema.SchemaValidationError);
		let calls = 0;
		const Tree = schema.lazy(() => {
			calls++;
			return schema.string();
		}, limits);
		expect(schema.inspect(Tree)).toEqual({
			input: { supported: false, reason: 'rejected' },
			output: { supported: false, reason: 'rejected' },
		});
		expect(calls).toBe(0);
		const transformed = schema.transform(schema.string(), Number);
		expect(schema.inspect(transformed).input.supported).toBe(true);
		expect(schema.inspect(transformed).output.supported).toBe(false);
	});
});
