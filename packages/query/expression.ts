/** One reusable Boolean node around a domain-owned query leaf. */
export type QueryBooleanExpression<Leaf> =
	| Readonly<{ kind: 'all'; filters: readonly QueryExpression<Leaf>[] }>
	| Readonly<{ kind: 'any'; filters: readonly QueryExpression<Leaf>[] }>
	| Readonly<{ kind: 'not'; filter: QueryExpression<Leaf> }>;

/**
 * Generic Boolean composition over a domain-owned query leaf.
 *
 * The leaf keeps its own business meaning and does not need a particular shape.
 * This utility owns only the reusable ALL / ANY / NOT expression mechanics so
 * products do not invent parallel Boolean languages.
 */
export type QueryExpression<Leaf> = Leaf | QueryBooleanExpression<Leaf>;

/** Path from the expression root to one domain-owned leaf. */
export type QueryExpressionPath = readonly PropertyKey[];

/** Information supplied while visiting one leaf in an expression. */
export interface QueryExpressionLeafVisit<Leaf> {
	/** Domain-owned leaf visited within a generic Boolean expression. */
	readonly leaf: Leaf;
	/** Source, route or expression path used to locate this value. */
	readonly path: QueryExpressionPath;
	/** Depth of this leaf, including the root node. */
	readonly depth: number;
	/** Zero-based position in the authored sequence. */
	readonly index: number;
}

/** Bounded structural measurements for one Boolean expression. */
export interface QueryExpressionInspection {
	/** Maximum expression depth including leaf nodes. */
	readonly maximumDepth: number;
	/** Number of domain-owned leaves observed in the expression. */
	readonly leafCount: number;
	/** Maximum immediate children observed or admitted in a Boolean group. */
	readonly maximumSiblings: number;
}

/** Runtime predicate that distinguishes the domain-owned leaf from Boolean nodes. */
export type QueryExpressionLeafPredicate<Leaf> = (value: QueryExpression<Leaf>) => value is Leaf;

/**
 * Inspect one Boolean expression and optionally visit each leaf.
 *
 * This helper deliberately knows nothing about fields, operators, Facts, Lists,
 * or storage. Domain packages keep those semantics and can use the visit path
 * for precise validation errors.
 */
export function inspectExpression<Leaf>(
	value: QueryExpression<Leaf>,
	isLeaf: QueryExpressionLeafPredicate<Leaf>,
	onLeaf?: (visit: QueryExpressionLeafVisit<Leaf>) => void,
): QueryExpressionInspection {
	const state = { maximumDepth: 0, leafCount: 0, maximumSiblings: 0 };
	inspect(value, isLeaf, onLeaf, [], 1, state);
	return Object.freeze({ ...state } satisfies QueryExpressionInspection);
}

/** Recursively inspect one validated expression node. */
function inspect<Leaf>(
	value: QueryExpression<Leaf>,
	isLeaf: QueryExpressionLeafPredicate<Leaf>,
	onLeaf: ((visit: QueryExpressionLeafVisit<Leaf>) => void) | undefined,
	path: QueryExpressionPath,
	depth: number,
	state: { maximumDepth: number; leafCount: number; maximumSiblings: number },
): void {
	state.maximumDepth = Math.max(state.maximumDepth, depth);
	if (isLeaf(value)) {
		const index = state.leafCount;
		state.leafCount += 1;
		onLeaf?.({ leaf: value, path, depth, index });
		return;
	}

	// The caller's leaf predicate establishes that the remaining value is one
	// of the three generic Boolean nodes. Keeping this cast here lets domain
	// leaves remain completely unconstrained.
	const node = value as QueryBooleanExpression<Leaf>;
	if (node.kind === 'not') {
		inspect(node.filter, isLeaf, onLeaf, [...path, 'filter'], depth + 1, state);
		return;
	}

	state.maximumSiblings = Math.max(state.maximumSiblings, node.filters.length);
	for (const [index, child] of node.filters.entries()) {
		inspect(child, isLeaf, onLeaf, [...path, 'filters', index], depth + 1, state);
	}
}
