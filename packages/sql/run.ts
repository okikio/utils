/**
 * Running statements through any client.
 *
 * This package has no database client. An application passes an {@link Executor}: one `run` method that sends a
 * compiled statement on its current connection or transaction and returns the rows. Postgres.js, pg, Drizzle, Kysely,
 * Prisma and Bun SQL can each provide one in a few lines; `./postgres.ts` provides the Postgres.js one.
 *
 * @example Drizzle
 * ```ts ignore
 * import { sql as tag } from 'drizzle-orm';
 *
 * const executor = (tx) => ({
 * 	async run(query) {
 * 		const result = await tx.execute(tag(query.strings, ...query.values));
 * 		return Array.isArray(result) ? result : result.rows; // postgres-js or node-postgres driver
 * 	},
 * });
 * ```
 *
 * @module
 */
import type { CompiledType } from './fragment.ts';
import { type Ddl, isDdl, type IsolationType, toDdlQuery } from './ddl.ts';
import { type Statement, toQuery } from './statement.ts';

/** One row as a client returns it. */
export type RawRow = Readonly<Record<string, unknown>>;

/** Options for one statement. */
export interface RunOptions {
	/**
	 * Cancel the statement when this signal aborts. The run then rejects with the signal's reason. A client that cannot
	 * cancel may ignore the signal and let the statement finish.
	 */
	readonly signal?: AbortSignal;
}

/** Runs one compiled statement in the caller's connection or transaction. It never commits or ends either. */
export interface Executor {
	run(query: CompiledType, options?: RunOptions): Promise<readonly RawRow[]>;
}

/** Options for a new transaction. */
export interface BeginOptions {
	/** The isolation level. The client's default applies when this is omitted. */
	readonly isolation?: IsolationType;
}

/** An executor that can also open a transaction. */
export interface Database extends Executor {
	/** Run `work` in a new transaction; commit when it resolves and roll back when it rejects. */
	begin<T>(work: (tx: Executor) => Promise<T>, options?: BeginOptions): Promise<T>;
}

/** Decode one returned row with the statement's types. A missing or extra column is an error. */
export function decode<Row>(statement: Statement<Row>, raw: RawRow): Row {
	const shape = statement.shape as Readonly<Record<string, { decode(value: unknown): unknown }>>;
	const expected = Object.keys(shape);
	const received = Object.keys(raw);
	if (received.length !== expected.length || expected.some((key) => !(key in raw))) {
		throw new TypeError(`Expected columns ${expected.join(', ')}; received ${received.join(', ')}.`);
	}
	return Object.freeze(Object.fromEntries(expected.map((key) => [key, shape[key]!.decode(raw[key])]))) as Row;
}

/** Run a statement and decode every row. */
export async function rows<Row>(
	executor: Executor,
	statement: Statement<Row>,
	options?: RunOptions,
): Promise<Row[]> {
	const found = await executor.run(toQuery(statement), options);
	// A statement that returns no columns, such as an update without `returning`, may still report rows.
	if (Object.keys(statement.shape).length === 0) return [];
	return found.map((raw) => decode(statement, raw));
}

/** Run a statement and return its one row, or `undefined`. More than one row is an error. */
export async function one<Row>(
	executor: Executor,
	statement: Statement<Row>,
	options?: RunOptions,
): Promise<Row | undefined> {
	const found = await rows(executor, statement, options);
	if (found.length > 1) throw new TypeError('Expected at most one row.');
	return found[0];
}

/** Run a statement or schema statement and ignore any rows. */
export async function execute(
	executor: Executor,
	statement: Statement<unknown> | Ddl,
	options?: RunOptions,
): Promise<void> {
	await executor.run(isDdl(statement) ? toDdlQuery(statement) : toQuery(statement), options);
}
