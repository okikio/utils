/** Parameterized PostgreSQL SELECT statements for checked collection queries. @module */
import { inspectExpression } from './expression.ts';
import type { QueryExpression } from './expression.ts';
import type { CursorCodec, QueryAdapterCapabilities, QueryFields, QueryFilter, QueryValue } from './types.ts';

/** Features implemented by this adapter; resource fieldsets still require an application projection. */
export const capabilities: QueryAdapterCapabilities = Object.freeze(
	{
		operators: 'all',
		expressions: Object.freeze(['all', 'any', 'not'] as const),
		pagination: Object.freeze(['offset', 'cursor'] as const),
		fieldSelection: Object.freeze(['simple'] as const),
	} satisfies QueryAdapterCapabilities,
);

/** Application-owned SQL relation and public-to-private column mapping. */
export interface Options<Fields extends QueryFields> {
	/** Relation segments, for example ['public', 'assets']; each is quoted separately. */
	readonly table: readonly [string, ...string[]];
	/** Allowlisted physical column name for every public field this relation exposes. */
	readonly columns: Readonly<Partial<Record<keyof Fields & string, string | Column>>>;
	/** Base relation alias. Required when joins or qualified base columns are used. */
	readonly alias?: string;
	/** At most sixteen trusted joins. Each must preserve at most one result row per base row. */
	readonly joins?: readonly Join[];
	/** Already authenticated, validated ordered key values. Omit on the first cursor page. */
	readonly continuation?: Continuation;
}

/** One trusted qualified column. Both names are quoted as identifiers, never treated as SQL fragments. */
export interface Column {
	/** Alias introduced by the base relation or an earlier join. */
	readonly relation: string;
	/** Physical column name selected by the application. */
	readonly column: string;
}

/** A trusted join whose target uniqueness is guaranteed by database constraints. */
export interface Join {
	/** Physical relation path, such as ['public', 'accounts']. */
	readonly table: readonly [string, ...string[]];
	/** Distinct alias introduced by this join. */
	readonly alias: string;
	/** LEFT retains a base row without a matching target; INNER removes it. */
	readonly kind: 'inner' | 'left';
	/** Assert a PK/UNIQUE target matching the ON keys. To-many joins must use a separate row query. */
	readonly cardinality: 'one';
	/** One to sixteen equality pairs connecting an earlier relation to this target. */
	readonly on: readonly Readonly<{ readonly left: Column; readonly right: Column }>[];
}

/** Trusted keyset boundary, aligned exactly with the query's order list. */
export interface Continuation {
	/** Decoded scalar keys, including nulls, in sort priority order. */
	readonly values: readonly unknown[];
	/** Before returns nearest previous rows in reverse order; inspect Statement.reversed. @default 'after' */
	readonly direction?: 'after' | 'before';
}

/** Inert driver input. Bind values separately; never concatenate them into text. */
export interface Statement {
	/** PostgreSQL text with numbered placeholders and quoted application-owned identifiers. */
	readonly text: string;
	/** Scalar parameters in placeholder order; query values never become SQL syntax. */
	readonly values: readonly unknown[];
	/** Present for backward keyset traversal. Reverse fetched rows before presenting canonical order. */
	readonly reversed?: true;
}

/**
 * Authenticate a cursor with the caller's existing codec, then compile its keyset.
 * Bind that codec to this query's order, filter/tenant context, schema revision,
 * and PostgreSQL semantics. A forged or mismatched token rejects before SQL is
 * returned. The caller owns keys and expiry policy; no token parser is added here.
 * Omit continuation.values: this function obtains them only from codec.decode().
 */
export async function compilePage<Fields extends QueryFields>(
	value: QueryValue<Fields>,
	options: Omit<Options<Fields>, 'continuation'> & Readonly<{ direction?: 'after' | 'before' }>,
	codec: CursorCodec<readonly unknown[]>,
): Promise<Statement> {
	if (value.pagination.kind !== 'cursor') throw new TypeError('compilePage requires cursor pagination.');
	if (options.direction !== undefined && options.direction !== 'after' && options.direction !== 'before') {
		throw new TypeError('Invalid cursor direction.');
	}
	const token = value.pagination.cursor;
	if (token === undefined && options.direction === 'before') {
		throw new TypeError('Backward traversal requires a cursor.');
	}
	return compile(value, {
		...options,
		...(token === undefined
			? {}
			: { continuation: { values: await codec.decode(token), direction: options.direction } }),
	});
}

/**
 * Compile a QueryValue obtained from a trusted definition's parse() or create().
 *
 * Call definition.validateAdapter(capabilities) when binding an endpoint so that
 * unsupported resource-fieldset policies fail before accepting traffic.
 * This compiler performs no I/O and borrows no connection. Execute the returned
 * statement with a PostgreSQL driver's parameter binding on a caller-owned client.
 * SQL comparisons retain PostgreSQL collation and NULL semantics; equality uses
 * IS [NOT] DISTINCT FROM, so equality with null is explicit and deterministic.
 * Canonical order uses NULLS LAST. Backward traversal physically reverses order
 * and sets Statement.reversed. The final cursor key must be immutable, unique,
 * and non-null in the database; compile checks shape, not database constraints.
 * Callers own transaction snapshots and consistency across concurrent writes.
 */
export function compile<Fields extends QueryFields>(value: QueryValue<Fields>, options: Options<Fields>): Statement {
	if (value.pagination.kind !== 'offset' && value.pagination.kind !== 'cursor') {
		throw new TypeError('Unsupported pagination.');
	}
	if (value.pagination.kind === 'offset' && options.continuation !== undefined) {
		throw new TypeError('Offset pages cannot use a continuation.');
	}
	if (
		value.pagination.kind === 'cursor' && value.pagination.cursor !== undefined && options.continuation === undefined
	) {
		throw new TypeError('Authenticate the cursor with compilePage or supply a trusted decoded continuation.');
	}
	if (value.fields.kind !== 'simple') throw new TypeError('PostgreSQL adapter requires simple field selection.');
	if (options.table.length === 0 || value.fields.fields.length === 0) {
		throw new TypeError('A relation and at least one selected field are required.');
	}
	const values: unknown[] = [];
	const aliases = new Set<string>();
	if (options.alias !== undefined) aliases.add(options.alias);
	/** Require aliases to be declared before a qualified column can enter SQL. */
	function qualified(reference: Column): string {
		if (!aliases.has(reference.relation)) {
			throw new TypeError(`Unknown PostgreSQL relation alias ${reference.relation}.`);
		}
		return `${identifier(reference.relation)}.${identifier(reference.column)}`;
	}
	let relation = options.table.map(identifier).join('.');
	if (options.alias !== undefined) relation += ` AS ${identifier(options.alias)}`;
	if ((options.joins?.length ?? 0) > 16) throw new RangeError('PostgreSQL queries support at most sixteen joins.');
	for (const join of options.joins ?? []) {
		if (options.alias === undefined) throw new TypeError('Joined queries require a base alias.');
		if (join.cardinality !== 'one') throw new TypeError('PostgreSQL joins require cardinality one.');
		if (join.kind !== 'inner' && join.kind !== 'left') throw new TypeError('Unsupported PostgreSQL join kind.');
		if (aliases.has(join.alias)) throw new TypeError('PostgreSQL relation aliases must be distinct.');
		if (join.table.length === 0 || join.on.length === 0 || join.on.length > 16) {
			throw new RangeError('Join requires a relation and one to sixteen equality pairs.');
		}
		const pairs = join.on.map(({ left, right }) => {
			// Resolve the old side before adding the new alias. A disconnected/self-referencing
			// target cannot accidentally turn a paged base-row query into a Cartesian product.
			const existing = qualified(left);
			if (right.relation !== join.alias) throw new TypeError('Join right columns must belong to the new alias.');
			return `${existing} = ${identifier(right.relation)}.${identifier(right.column)}`;
		});
		aliases.add(join.alias);
		relation += ` ${join.kind.toUpperCase()} JOIN ${join.table.map(identifier).join('.')} AS ${
			identifier(join.alias)
		} ON (${pairs.join(' AND ')})`;
	}
	/** Bind only portable PostgreSQL scalar operands; reject objects rather than relying on driver coercion. */
	function bind(operand: unknown): string {
		if (values.length >= 60_000) throw new RangeError('PostgreSQL query exceeds 60000 bound parameters.');
		if (
			operand !== null && typeof operand !== 'string' && typeof operand !== 'boolean' &&
			typeof operand !== 'bigint' && !(typeof operand === 'number' && Number.isFinite(operand))
		) {
			throw new TypeError('PostgreSQL query operands must be finite scalar values or null.');
		}
		values.push(operand);
		return `$${values.length}`;
	}
	/** Resolve only own allowlisted columns, preventing prototype names from selecting hidden data. */
	function column(field: string, ordering = false): string {
		if (!Object.hasOwn(options.columns, field)) throw new TypeError(`No PostgreSQL column is mapped for ${field}.`);
		const name = options.columns[field];
		if (name === undefined) throw new TypeError(`No PostgreSQL column is mapped for ${field}.`);
		if (typeof name !== 'string') return qualified(name);
		if (options.alias !== undefined) return `${identifier(options.alias)}.${identifier(name)}`;
		// ORDER BY resolves an unqualified output alias before a same-named source
		// column. Qualify source ordering so public renames cannot change its meaning.
		return ordering ? `${options.table.map(identifier).join('.')}.${identifier(name)}` : identifier(name);
	}
	/** Lower checked Boolean structure; preflight below protects recursion and total parameter count. */
	function expression(node: QueryExpression<QueryFilter<Fields>>): string {
		if ('kind' in node) {
			if (node.kind === 'not') return `(NOT ${expression(node.filter)})`;
			return `(${node.filters.map(expression).join(node.kind === 'all' ? ' AND ' : ' OR ')})`;
		}
		const name = column(node.field);
		if (node.operator === 'isNull') return `(${name} IS NULL)`;
		if (node.operator === 'isNotNull') return `(${name} IS NOT NULL)`;
		if (node.operator === 'in' || node.operator === 'nin' || node.operator === 'between') {
			if (!Array.isArray(node.value) || node.value.length === 0 || node.value.length > 1000) {
				throw new RangeError('PostgreSQL list operands require 1 to 1000 values.');
			}
			if (node.operator === 'between') {
				if (node.value.length !== 2) throw new TypeError('BETWEEN requires two operands.');
				return `(${name} BETWEEN ${bind(node.value[0])} AND ${bind(node.value[1])})`;
			}
			// Distinctness gives list membership the same null-safe equality as eq.
			const comparisons = node.value.map((item) => `${name} IS NOT DISTINCT FROM ${bind(item)}`);
			const included = `(${comparisons.join(' OR ')})`;
			return node.operator === 'nin' ? `(NOT ${included})` : included;
		}
		if (['contains', 'icontains', 'startsWith', 'endsWith'].includes(node.operator) && typeof node.value !== 'string') {
			throw new TypeError('PostgreSQL text comparisons require string operands.');
		}
		const operand = bind(node.value);
		switch (node.operator) {
			case 'eq':
				return `(${name} IS NOT DISTINCT FROM ${operand})`;
			case 'ne':
				return `(${name} IS DISTINCT FROM ${operand})`;
			case 'gt':
				return `(${name} > ${operand})`;
			case 'gte':
				return `(${name} >= ${operand})`;
			case 'lt':
				return `(${name} < ${operand})`;
			case 'lte':
				return `(${name} <= ${operand})`;
			case 'contains':
				return `(strpos(${name}, ${operand}) > 0)`;
			case 'icontains':
				return `(strpos(lower(${name}), lower(${operand})) > 0)`;
			case 'startsWith':
				return `(starts_with(${name}, ${operand}))`;
			case 'endsWith':
				return `(right(${name}, length(${operand})) = ${operand})`;
			default:
				throw new TypeError('Unsupported PostgreSQL query operator.');
		}
	}
	const selected = value.fields.fields.map((field) => `${column(field)} AS ${identifier(field)}`).join(', ');
	let text = `SELECT ${selected} FROM ${relation}`;
	const predicates: string[] = [];
	if (value.filter !== undefined) {
		inspectExpression(
			value.filter,
			(node): node is QueryFilter<Fields> =>
				typeof node === 'object' && node !== null && !('kind' in node) && 'field' in node && 'operator' in node,
			undefined,
			{ maximumLeaves: 1000, maximumDepth: 32, maximumSiblings: 1000 },
		);
		predicates.push(expression(value.filter));
	}
	const before = options.continuation?.direction === 'before';
	if (value.pagination.kind === 'cursor') {
		if (
			value.order.length === 0 || value.order.length > 32 || value.order.at(-1)?.tiebreaker !== true ||
			value.order.filter((entry) => entry.tiebreaker).length !== 1 ||
			new Set(value.order.map((entry) => entry.field)).size !== value.order.length
		) {
			throw new TypeError(
				'Cursor ordering requires distinct fields and exactly one final unique tiebreaker (at most 32 keys).',
			);
		}
		const continuation = options.continuation;
		if (continuation !== undefined) {
			if (
				continuation.direction !== undefined && continuation.direction !== 'after' &&
				continuation.direction !== 'before'
			) throw new TypeError('Invalid cursor direction.');
			if (!Array.isArray(continuation.values) || continuation.values.length !== value.order.length) {
				throw new TypeError('Cursor key count must match ordering.');
			}
			if (continuation.values.at(-1) === null) throw new TypeError('The unique final cursor key must not be null.');
			const keys = continuation.values.map(bind);
			const alternatives = value.order.map((entry, index) => {
				const name = column(entry.field);
				const key = continuation.values[index];
				// Under NULLS LAST, every non-null key precedes null. Reverse traversal
				// changes both this boundary test and the physical ordering below.
				// The final key is guaranteed non-null. Avoid a redundant OR IS NULL
				// there: PostgreSQL can then plan a single-key boundary as an index range.
				const compare = key === null
					? (before ? `${name} IS NOT NULL` : 'FALSE')
					: `(${name} ${(entry.direction === 'asc') !== before ? '>' : '<'} ${keys[index]}${
						before || entry.tiebreaker ? '' : ` OR ${name} IS NULL`
					})`;
				const equalPrefix = value.order.slice(0, index).map((prior, priorIndex) =>
					`${column(prior.field)} IS NOT DISTINCT FROM ${keys[priorIndex]}`
				);
				return `(${[...equalPrefix, compare].join(' AND ')})`;
			});
			predicates.push(`(${alternatives.join(' OR ')})`);
		}
	}
	if (predicates.length > 0) text += ` WHERE ${predicates.join(' AND ')}`;
	if (value.order.length > 100) throw new RangeError('PostgreSQL ordering supports at most 100 fields.');
	if (value.order.length > 0) {
		text += ` ORDER BY ${
			value.order.map((entry) => {
				if (entry.direction !== 'asc' && entry.direction !== 'desc') throw new TypeError('Invalid sort direction.');
				const direction = before ? (entry.direction === 'asc' ? 'desc' : 'asc') : entry.direction;
				return `${column(entry.field, true)} ${direction.toUpperCase()} NULLS ${before ? 'FIRST' : 'LAST'}`;
			}).join(', ')
		}`;
	}
	for (
		const count of [value.pagination.limit, ...(value.pagination.kind === 'offset' ? [value.pagination.offset] : [])]
	) {
		if (!Number.isSafeInteger(count) || count < 0) {
			throw new RangeError('Pagination requires nonnegative safe integers.');
		}
	}
	text += ` LIMIT ${bind(value.pagination.limit)}`;
	if (value.pagination.kind === 'offset') text += ` OFFSET ${bind(value.pagination.offset)}`;
	if (values.length > 60_000) throw new RangeError('PostgreSQL query exceeds 60000 bound parameters.');
	return Object.freeze({ text, values: Object.freeze(values), ...(before ? { reversed: true as const } : {}) });
}

/** Quote one trusted identifier segment; embedded quotes are escaped, never interpreted as SQL. */
function identifier(value: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
		throw new TypeError('PostgreSQL identifiers must be nonempty and contain no NUL.');
	}
	return `"${value.replaceAll('"', '""')}"`;
}
