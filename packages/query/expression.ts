/**
 * Compose and inspect Boolean expressions without a query definition or storage.
 * Leaves retain the caller's domain meaning. and(), or(), and not() add only
 * Boolean structure; evaluate() delegates every leaf comparison to the caller.
 *
 * @example Apply alternatives to an ordinary value
 * ```ts
 * import { any, evaluate } from '@okikio/query/expression';
 * const names = any('Ada', 'Lin');
 * console.log(evaluate(names, (value): value is string => typeof value === 'string', (name) => name === 'Lin')); // true
 * ```
 *
 * @module
 */

/**
 * One Boolean group whose children can be leaves or other groups.
 * Nest groups to express parentheses: an AND with an OR child is different
 * from an OR with an AND child. Child order is the authored evaluation order.
 */
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

/** Limits for independently inspected or evaluated expressions. */
export interface QueryExpressionLimits {
	/** Maximum root-to-leaf depth, including the root. @default 64 */
	readonly maximumDepth?: number;
	/** Maximum number of leaf visits, counting repeated shared leaves. @default 10000 */
	readonly maximumLeaves?: number;
	/** Maximum children in an ALL or ANY group. @default 1000 */
	readonly maximumSiblings?: number;
}

/** Derive the domain leaf from a plain leaf or an already composed Boolean node. */
export type QueryExpressionLeaf<Value> = Value extends QueryBooleanExpression<infer Leaf> ? Leaf : Value;

/**
 * Require every supplied condition (Boolean AND). Also exported as and().
 * At least one condition is required; an empty group throws TypeError.
 * The child list is copied; child expressions are borrowed and retain their types.
 * An OR child stays grouped, as in and(or(a, b), c).
 * Use create() on a query definition to validate field values and enabled operators.
 * The application still owns authorization and record access.
 */
export function all<const Inputs extends readonly [unknown, ...unknown[]]>(
	...filters: Inputs
): QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>> {
	if (filters.length === 0) throw new TypeError('An ALL group requires at least one condition.');
	return { kind: 'all', filters: [...filters] } as QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>>;
}

/**
 * Match at least one supplied condition (inclusive Boolean OR). Also exported as or().
 * At least one condition is required. The child list is copied; child expressions
 * are borrowed. An AND child stays grouped, as in or(a, and(b, c)).
 */
export function any<const Inputs extends readonly [unknown, ...unknown[]]>(
	...filters: Inputs
): QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>> {
	if (filters.length === 0) throw new TypeError('An ANY group requires at least one condition.');
	return { kind: 'any', filters: [...filters] } as QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>>;
}

/** Negate one condition or group without changing its leaf values. */
export function not<const Input>(filter: Input): QueryBooleanExpression<QueryExpressionLeaf<Input>> {
	return { kind: 'not', filter } as QueryBooleanExpression<QueryExpressionLeaf<Input>>;
}

/**
 * Match when none of the supplied conditions match (Boolean NOR). Also exported as none().
 *
 * For example, nor(isSuspended, isDeleted) requires both conditions to be false.
 * This builds NOT around an OR group, so a query definition must enable any and not.
 * At least one condition is required. The child list is copied; leaves remain borrowed.
 */
export function nor<const Inputs extends readonly [unknown, ...unknown[]]>(
	...filters: Inputs
): QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>> {
	return not(any(...filters)) as QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>>;
}

/**
 * Match unless every supplied condition matches (Boolean NAND).
 *
 * For example, nand(isEditor, isOwner) rejects only an account matching both conditions.
 * This builds NOT around an AND group; it is different from NOR, which requires all
 * conditions to be false. A query definition must enable not. At least one condition
 * is required. The child list is copied; leaves remain borrowed.
 */
export function nand<const Inputs extends readonly [unknown, ...unknown[]]>(
	...filters: Inputs
): QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>> {
	return not(all(...filters)) as QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>>;
}

/**
 * Match exactly one of two conditions (binary exclusive OR).
 *
 * For example, xor(hasEmail, hasPhone) matches one contact method, but not both.
 * Exactly two arguments are required; JavaScript callers also receive TypeError for
 * another arity. This is not a variadic odd-parity or exactly-one-of-many operation.
 *
 * The result uses only ALL, ANY and NOT nodes: (left AND NOT right) OR (NOT left AND right).
 * Each input occurs twice. Inspection and query limits count those repeated occurrences,
 * and evaluation can compare an input twice. Comparisons must be deterministic and free
 * of effects. Leaves remain borrowed. Query definitions must enable any and not.
 * PostgreSQL compilation retains SQL NULL/unknown semantics rather than converting NULL to false.
 */
export function xor<const Inputs extends readonly [unknown, unknown]>(
	...filters: Inputs
): QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>> {
	if (filters.length !== 2) throw new TypeError('XOR requires exactly two conditions.');
	const [left, right] = filters;
	// Reuse the existing representation so URL encoding, SQL compilation and safety
	// checks see the complete expression, including both occurrences of each input.
	return any(all(left, not(right)), all(not(left), right)) as QueryBooleanExpression<
		QueryExpressionLeaf<Inputs[number]>
	>;
}

/**
 * Match when two conditions have the same Boolean answer (binary exclusive NOR).
 *
 * xnor(hasEmail, hasPhone) matches both present or both absent. Exactly two arguments
 * are required. This builds NOT around xor(), with the same borrowed leaves, repeated
 * comparisons and expanded limit costs. SQL NULL remains unknown where SQL dictates;
 * this builder does not supply a two-valued database comparison policy.
 */
export function xnor<const Inputs extends readonly [unknown, unknown]>(
	...filters: Inputs
): QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>> {
	if (filters.length !== 2) throw new TypeError('XNOR requires exactly two conditions.');
	return not(xor(...filters)) as QueryBooleanExpression<QueryExpressionLeaf<Inputs[number]>>;
}

// These names are the same functions, not alternate evaluators or new serialized node kinds.
export { all as and, any as or, nor as none };

/**
 * Evaluate an expression with the caller's own leaf comparison.
 * The tree is checked for cycles, shape, and limits before comparisons begin.
 * ALL and ANY then short-circuit in authored order. The predicate and comparison
 * must be synchronous; comparison results must be booleans. This helper never
 * assigns equality, collation, or database semantics to a domain leaf.
 */
export function evaluate<Leaf>(
	value: QueryExpression<NoInfer<Leaf>>,
	isLeaf: (value: unknown) => value is Leaf,
	matches: (leaf: Leaf) => boolean,
	limits?: QueryExpressionLimits,
): boolean;
/** Evaluate a domain predicate that accepts the caller's already typed expression. */
export function evaluate<Leaf>(
	value: QueryExpression<Leaf>,
	isLeaf: QueryExpressionLeafPredicate<Leaf>,
	matches: (leaf: Leaf) => boolean,
	limits?: QueryExpressionLimits,
): boolean;
export function evaluate<Leaf>(
	value: QueryExpression<Leaf>,
	isLeaf: QueryExpressionLeafPredicate<Leaf>,
	matches: (leaf: Leaf) => boolean,
	limits: QueryExpressionLimits = {},
): boolean {
	// Validate the whole tree first. Short-circuit evaluation must not hide an invalid unvisited branch.
	inspectExpression(value, isLeaf, undefined, limits);
	return visit(value);
	/** Evaluate only after complete structural preflight, then short-circuit comparisons in authored order. */
	function visit(entry: QueryExpression<Leaf>): boolean {
		if (isLeaf(entry)) {
			const result = matches(entry);
			if (typeof result !== 'boolean') throw new TypeError('An expression leaf comparison must return a boolean.');
			return result;
		}
		const node = entry as QueryBooleanExpression<Leaf>;
		return node.kind === 'not'
			? !visit(node.filter)
			: node.kind === 'all'
			? node.filters.every(visit)
			: node.filters.some(visit);
	}
}

/**
 * Inspect one Boolean expression and optionally visit each leaf.
 *
 * This helper deliberately knows nothing about fields, operators, Facts, Lists,
 * or storage. Domain packages keep those semantics and can use the visit path
 * for precise validation errors.
 */
export function inspectExpression<Leaf>(
	value: QueryExpression<NoInfer<Leaf>>,
	isLeaf: (value: unknown) => value is Leaf,
	onLeaf?: (visit: QueryExpressionLeafVisit<Leaf>) => void,
	limits?: QueryExpressionLimits,
): QueryExpressionInspection;
/** Inspect a domain predicate that accepts the caller's already typed expression. */
export function inspectExpression<Leaf>(
	value: QueryExpression<Leaf>,
	isLeaf: QueryExpressionLeafPredicate<Leaf>,
	onLeaf?: (visit: QueryExpressionLeafVisit<Leaf>) => void,
	limits?: QueryExpressionLimits,
): QueryExpressionInspection;
export function inspectExpression<Leaf>(
	value: QueryExpression<Leaf>,
	isLeaf: QueryExpressionLeafPredicate<Leaf>,
	onLeaf?: (visit: QueryExpressionLeafVisit<Leaf>) => void,
	limits: QueryExpressionLimits = {},
): QueryExpressionInspection {
	// These are observed counts. Keep them separate from the caller-selected rejection limits below.
	const state = { maximumDepth: 0, leafCount: 0, maximumSiblings: 0 };
	const bounds = {
		maximumDepth: limits.maximumDepth ?? 64,
		maximumLeaves: limits.maximumLeaves ?? 10_000,
		maximumSiblings: limits.maximumSiblings ?? 1_000,
	};
	for (const [name, count] of Object.entries(bounds)) {
		if (!Number.isSafeInteger(count) || count < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	}
	inspect(value, isLeaf, onLeaf, [], 1, state, bounds, new Set());
	return { ...state } satisfies QueryExpressionInspection;
}

/** Check node shape, active-path cycles, and bounds before visiting its descendants or admitting a leaf. */
function inspect<Leaf>(
	value: QueryExpression<Leaf>,
	isLeaf: QueryExpressionLeafPredicate<Leaf>,
	onLeaf: ((visit: QueryExpressionLeafVisit<Leaf>) => void) | undefined,
	path: QueryExpressionPath,
	depth: number,
	state: { maximumDepth: number; leafCount: number; maximumSiblings: number },
	limits: Required<QueryExpressionLimits>,
	active: Set<object>,
): void {
	if (depth > limits.maximumDepth) throw new RangeError(`Expression depth exceeds ${limits.maximumDepth}.`);
	state.maximumDepth = Math.max(state.maximumDepth, depth);
	if (isLeaf(value)) {
		const index = state.leafCount;
		state.leafCount += 1;
		if (state.leafCount > limits.maximumLeaves) {
			throw new RangeError(`Expression leaf count exceeds ${limits.maximumLeaves}.`);
		}
		onLeaf?.({ leaf: value, path, depth, index });
		return;
	}

	// The caller's leaf predicate establishes that the remaining value is one
	// of the three generic Boolean nodes. Keeping this cast here lets domain
	// leaves remain completely unconstrained.
	const node = value as QueryBooleanExpression<Leaf>;
	if (typeof node !== 'object' || node === null || active.has(node)) {
		throw new TypeError('Boolean groups must be acyclic objects.');
	}
	active.add(node);
	try {
		if (node.kind === 'not') {
			inspect(node.filter, isLeaf, onLeaf, [...path, 'filter'], depth + 1, state, limits, active);
			return;
		}
		if ((node.kind !== 'all' && node.kind !== 'any') || !Array.isArray(node.filters) || node.filters.length === 0) {
			throw new TypeError('An ALL or ANY group requires a nonempty array of conditions.');
		}
		if (node.filters.length > limits.maximumSiblings) {
			throw new RangeError(`Expression siblings exceed ${limits.maximumSiblings}.`);
		}
		state.maximumSiblings = Math.max(state.maximumSiblings, node.filters.length);
		for (const [index, child] of node.filters.entries()) {
			inspect(child, isLeaf, onLeaf, [...path, 'filters', index], depth + 1, state, limits, active);
		}
	} finally {
		// Shared subtrees are valid repeated occurrences; only ancestry cycles are forbidden.
		active.delete(node);
	}
}

export { inspectExpression as inspect };
