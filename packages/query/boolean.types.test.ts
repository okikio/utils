// @installed-consumer: Check Boolean inference against packed declarations as well as source.
import * as query from '@okikio/query';
import * as expression from '@okikio/query/expression';

/** Check both assignability directions so widening or an unusable never result cannot pass silently. */
type Same<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2)
	? true
	: false;

/** Compile public call sites without creating or evaluating a query during test discovery. */
function booleanTypes(): void {
	const name = { kind: 'name', value: 'Ada' } as const;
	const score = { kind: 'score', minimum: 90 } as const;
	const removed = { kind: 'removed', value: false } as const;
	type Leaf = typeof name | typeof score | typeof removed;

	// Nested builders must preserve the domain leaves rather than infer Boolean nodes as leaves.
	const nested = query.and(expression.or(name, score), query.none(removed));
	const expected: query.QueryBooleanExpression<Leaf> = nested;
	const inferred: typeof nested = expected;
	const exactName: Extract<query.QueryExpressionLeaf<typeof nested>, { kind: 'name' }> = name;
	const exactScore: Extract<query.QueryExpressionLeaf<typeof nested>, { kind: 'score' }> = score;
	const exactRemoved: Extract<query.QueryExpressionLeaf<typeof nested>, { kind: 'removed' }> = removed;
	void [inferred, exactName, exactScore, exactRemoved];

	// Check both public entrypoints and every composed builder with heterogeneous leaves.
	const alternatives: readonly query.QueryBooleanExpression<Leaf>[] = [
		query.or(name, expression.nand(score, removed)),
		expression.and(query.nor(name, score), removed),
		query.xor(name, expression.not(score)),
		expression.xnor(query.xor(name, score), removed),
		query.all(name, expression.any(score, removed)),
		expression.none(name, score, removed),
	];
	void alternatives;
	const exclusive = query.xor(name, score);
	const equal = expression.xnor(exclusive, removed);
	const inverted = query.nand(name, score, removed);
	const excluded = expression.nor(name, score, removed);
	const inferredUnions: [
		Same<query.QueryExpressionLeaf<typeof exclusive>, typeof name | typeof score>,
		Same<query.QueryExpressionLeaf<typeof equal>, Leaf>,
		Same<query.QueryExpressionLeaf<typeof inverted>, Leaf>,
		Same<query.QueryExpressionLeaf<typeof excluded>, Leaf>,
	] = [true, true, true, true];
	void inferredUnions;

	// Literal values remain exact; widening them can hide a broken builder inference contract.
	// @ts-expect-error The name leaf preserves the literal Ada rather than a general string.
	const wrongName: typeof exactName = { kind: 'name', value: 'Lin' };
	// @ts-expect-error The score leaf preserves the literal minimum 90.
	const wrongScore: typeof exactScore = { kind: 'score', minimum: 91 };
	// @ts-expect-error Boolean nodes are not part of the inferred domain leaf union.
	const wrongLeaf: query.QueryExpressionLeaf<typeof nested> = { kind: 'not', filter: name };
	void [wrongName, wrongScore, wrongLeaf];

	// These compile-only failures protect the same arity rules JavaScript callers receive at runtime.
	// @ts-expect-error AND requires at least one condition.
	query.and();
	// @ts-expect-error OR requires at least one condition.
	expression.or();
	// @ts-expect-error NOR requires at least one condition.
	query.nor();
	// @ts-expect-error none is the same nonempty builder as NOR.
	expression.none();
	// @ts-expect-error NAND requires at least one condition.
	query.nand();
	// @ts-expect-error XOR is binary, not unary.
	query.xor(name);
	// @ts-expect-error XOR does not mean exactly one of an arbitrary list.
	expression.xor(name, score, removed);
	// @ts-expect-error XNOR requires two conditions.
	expression.xnor();
	// @ts-expect-error XNOR is binary, not unary.
	query.xnor(name);
	// @ts-expect-error XNOR does not accept a third condition.
	query.xnor(name, score, removed);
}

void booleanTypes;
