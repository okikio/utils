/** What a client adapter is: a library turned into the package's `Database` port. @module */
import type { CompiledType, Database, Executor, RunOptions } from '@okikio/sql/postgres';
import type { StartedType } from '../targets/types.ts';

/** An open client. `close` ends its pool. */
export interface OpenedType {
	readonly db: Database;
	close(): Promise<void>;
}

/** A PostgreSQL client library, ORM or driver, and how to open it against a started target. */
export interface ClientType {
	readonly name: string;
	/** One line for the report: the library and the path statements take through it. */
	readonly about: string;
	/** What it connects to: a wire-protocol URL, Neon's proxy, or a database in the same process. */
	readonly reach: 'url' | 'neon' | 'embedded';
	/** Where it runs. Bun and Deno clients run in a child process of that runtime. */
	readonly runtime: 'node' | 'bun' | 'deno';
	/** Open the client in this process. Absent for Bun and Deno clients. */
	readonly open?: (started: StartedType) => Promise<OpenedType>;
}

/** The isolation statements for clients that need them spelled out. */
export const upper = {
	'read committed': 'READ COMMITTED',
	'repeatable read': 'REPEATABLE READ',
	serializable: 'SERIALIZABLE',
} as const;

/** `?` placeholders for knex-style clients: escape each literal `?`, such as jsonb's `?&`, then join the pieces. */
export const positional = (query: CompiledType): string =>
	query.strings.map((piece) => piece.replaceAll('?', '\\?')).join('?');

/** A real template object for one fixed text. */
export function template(text: string): TemplateStringsArray {
	// `raw` must not be enumerable: Bun's tag checks for a real template object.
	return Object.freeze(
		Object.defineProperty([text], 'raw', { value: Object.freeze([text]) }),
	) as unknown as TemplateStringsArray;
}

/** A `Database` from a run function and a transaction function, for libraries without a binding. */
export function port(
	run: (
		query: CompiledType,
		options?: RunOptions,
	) => Promise<readonly Record<string, unknown>[]>,
	begin: Database['begin'],
): Database {
	return Object.freeze({ run, begin });
}

/**
 * Pass a run's signal to a library that takes one, and reject with the signal's reason when it aborts, as the
 * package's bindings do.
 */
export async function aborting<T>(
	options: RunOptions | undefined,
	call: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
	const signal = options?.signal;
	signal?.throwIfAborted();
	try {
		return await call(signal);
	} catch (error) {
		if (signal?.aborted) throw signal.reason;
		throw error;
	}
}

/** The URL of a started target, or an error naming what the client needs. */
export function urlOf(started: StartedType): string {
	if (!started.url) throw new Error('This target has no wire-protocol URL.');
	return started.url;
}

export type { Executor };
