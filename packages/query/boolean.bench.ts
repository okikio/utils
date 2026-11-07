/**
 * Measure Boolean authoring, structural inspection and evaluation separately.
 *
 * Fixed leaves model repeated evaluation of an already authored policy. Native
 * JavaScript baselines return the same Boolean answer but omit expression shape,
 * cycle and budget preflight. These measurements do not establish a speedup,
 * retained-memory bound, SQL behavior or a performance threshold.
 * @module
 */
import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { all, and, any, evaluate, inspectExpression, nand, none, nor, or, xnor, xor } from './expression.ts';
import type { QueryExpression } from './expression.ts';

/** A policy-owned fact; its stored answer isolates traversal from external I/O and comparison costs. */
type Fact = Readonly<{ kind: 'fact'; id: number; matched: boolean }>;

/** Recognize the complete fixture leaf so malformed nodes cannot be accepted as domain data. */
function isFact(value: unknown): value is Fact {
	return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'fact' &&
		'id' in value && typeof value.id === 'number' && 'matched' in value && typeof value.matched === 'boolean';
}

/** Read only the fixture answer; no time, mutation or I/O can change a repeated comparison. */
const matches = (fact: Fact): boolean => fact.matched;

/** Require full flat traversal: AND fails last and OR succeeds last, using the same number of facts. */
function facts(width: number, operation: 'and' | 'or'): [Fact, ...Fact[]] {
	return Array.from({ length: width }, (_, id) => ({
		kind: 'fact' as const,
		id,
		matched: operation === 'and' ? id < width - 1 : id === width - 1,
	})) as [Fact, ...Fact[]];
}

/**
 * Build a left-nested binary policy from already allocated leaves.
 * Each exclusive level references its previous subtree twice, so inspection
 * counts 3 * 2^depth - 2 leaf occurrences even though only depth + 1 facts exist.
 */
function chain(values: readonly [Fact, ...Fact[]], exclusive: 'xor' | 'xnor'): QueryExpression<Fact> {
	let result: QueryExpression<Fact> = values[0];
	for (let index = 1; index < values.length; index++) {
		const next = values[index]!;
		result = exclusive === 'xor' ? xor(result, next) : xnor(result, next);
	}
	return result;
}

/** Compare the same left-nested answers without allocating or checking an expression tree. */
function nativeChain(values: readonly [Fact, ...Fact[]], exclusive: 'xor' | 'xnor'): boolean {
	let result = values[0].matched;
	for (let index = 1; index < values.length; index++) {
		const next = values[index]!.matched;
		result = exclusive === 'xor' ? result !== next : result === next;
	}
	return result;
}

// Conventional names are exact aliases, so a vocabulary change does not add a second execution path.
strictEqual(and, all);
strictEqual(or, any);
strictEqual(none, nor);

// Untimed truth rows also pin the lowering's actual comparison count. Structural
// inspection sees four occurrences; short-circuiting can compare fewer of them.
for (const left of [false, true]) {
	for (const right of [false, true]) {
		const a: Fact = { kind: 'fact', id: 0, matched: left };
		const b: Fact = { kind: 'fact', id: 1, matched: right };
		strictEqual(evaluate(and(a, b), isFact, matches), left && right);
		strictEqual(evaluate(or(a, b), isFact, matches), left || right);
		strictEqual(evaluate(nor(a, b), isFact, matches), !(left || right));
		strictEqual(evaluate(nand(a, b), isFact, matches), !(left && right));
		for (const builder of [xor, xnor]) {
			const value = builder(a, b);
			let calls = 0;
			const result = evaluate(value, isFact, (fact) => {
				calls++;
				return fact.matched;
			});
			strictEqual(result, builder === xor ? left !== right : left === right);
			strictEqual(calls, left && !right ? 2 : 3);
			strictEqual(inspectExpression(value, isFact).leafCount, 4);

			calls = 0;
			throws(() =>
				evaluate(value, isFact, (fact) => {
					calls++;
					return fact.matched;
				}, { maximumLeaves: 3 }), RangeError);
			strictEqual(calls, 0, 'Expanded leaf budgets must reject before any comparison.');
		}
	}
}

for (const width of [1, 8, 64]) {
	const every = facts(width, 'and');
	const some = facts(width, 'or');
	const conjunction = and(...every);
	const disjunction = or(...some);
	deepStrictEqual(conjunction, all(...every));
	deepStrictEqual(disjunction, any(...some));
	strictEqual(evaluate(conjunction, isFact, matches), every.every(matches));
	strictEqual(evaluate(disjunction, isFact, matches), some.some(matches));
	strictEqual(inspectExpression(conjunction, isFact).leafCount, width);
	strictEqual(inspectExpression(disjunction, isFact).leafCount, width);
	for (const value of [conjunction, disjunction]) {
		let calls = 0;
		evaluate(value, isFact, (fact) => {
			calls++;
			return fact.matched;
		});
		strictEqual(calls, width, 'Flat workloads must perform the comparison count in their label.');
	}

	group(`Boolean construction: ${width} borrowed facts; leaf allocation excluded`, () => {
		bench('all: copy child list', () => do_not_optimize(all(...every)));
		bench('and: exact all alias', () => do_not_optimize(and(...every)));
		bench('any: copy child list', () => do_not_optimize(any(...some)));
		bench('or: exact any alias', () => do_not_optimize(or(...some)));
		bench('nor: NOT around OR', () => do_not_optimize(nor(...some)));
		bench('nand: NOT around AND', () => do_not_optimize(nand(...every)));
	});

	group(`Boolean inspection only: ${width} facts; authored trees reused`, () => {
		bench('AND shape, cycles and budgets', () => do_not_optimize(inspectExpression(conjunction, isFact)));
		bench('OR shape, cycles and budgets', () => do_not_optimize(inspectExpression(disjunction, isFact)));
	});

	group(`Boolean evaluation: ${width} comparisons; trees reused; preflight included`, () => {
		bench('AND inspected evaluation', () => do_not_optimize(evaluate(conjunction, isFact, matches)));
		bench('OR inspected evaluation', () => do_not_optimize(evaluate(disjunction, isFact, matches)));
		bench('native every: no tree or structural preflight', () => do_not_optimize(every.every(matches)));
		bench('native some: no tree or structural preflight', () => do_not_optimize(some.some(matches)));
	});
}

for (const depth of [1, 3, 6]) {
	const values = Array.from({ length: depth + 1 }, (_, id) => ({
		kind: 'fact' as const,
		id,
		matched: id % 3 === 1,
	})) as [Fact, ...Fact[]];
	for (const exclusive of ['xor', 'xnor'] as const) {
		const value = chain(values, exclusive);
		const occurrences = 3 * 2 ** depth - 2;
		const inspection = inspectExpression(value, isFact);
		strictEqual(inspection.leafCount, occurrences);
		strictEqual(evaluate(value, isFact, matches), nativeChain(values, exclusive));
		throws(() => inspectExpression(value, isFact, undefined, { maximumLeaves: occurrences - 1 }), RangeError);
		throws(
			() => inspectExpression(value, isFact, undefined, { maximumDepth: inspection.maximumDepth - 1 }),
			RangeError,
		);

		group(`${exclusive.toUpperCase()} depth ${depth}: ${values.length} facts, ${occurrences} expanded visits`, () => {
			bench('construction only: borrowed facts', () => do_not_optimize(chain(values, exclusive)));
			bench('inspection only: reused expanded tree', () => do_not_optimize(inspectExpression(value, isFact)));
			bench('evaluation and full structural preflight', () => do_not_optimize(evaluate(value, isFact, matches)));
			bench('native fold: no tree or structural preflight', () => do_not_optimize(nativeChain(values, exclusive)));
		});
	}
}

await run();
