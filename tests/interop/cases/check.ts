/** Compare results in a form every runtime prints the same way, and build raw statements for set-up. @module */
import type { CompiledType, Database, Executor } from '@okikio/sql/postgres';

/**
 * A plain form of a value for comparison. Instants compare by epoch nanoseconds and other Temporal values by their
 * ISO text, because `toString` on an instant needs time zone rules that some hosts cannot load.
 */
export function plain(value: unknown): unknown {
	if (typeof value === 'bigint') return `${value}n`;
	if (typeof value === 'number') {
		if (Object.is(value, -0)) return '-0';
		return Number.isFinite(value) ? value : String(value);
	}
	if (value instanceof Uint8Array) return `bytes:${[...value].join(',')}`;
	if (value !== null && typeof value === 'object') {
		const instant = (value as { epochNanoseconds?: unknown }).epochNanoseconds;
		if (typeof instant === 'bigint') return `instant:${instant}`;
		const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
		if (typeof tag === 'string' && tag.startsWith('Temporal.')) {
			return `${tag}:${String(value)}`;
		}
		if (Array.isArray(value)) return value.map(plain);
		// Keys in a fixed order: a row's column order is not what the cases compare.
		return Object.fromEntries(
			Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map((
				[key, item],
			) => [key, plain(item)]),
		);
	}
	return value;
}

/** Throw when two values differ, showing both. */
export function same(actual: unknown, expected: unknown, what: string): void {
	const a = JSON.stringify(plain(actual));
	const e = JSON.stringify(plain(expected));
	if (a !== e) {
		throw new Error(
			`${what}: expected ${e.slice(0, 300)}, got ${a.slice(0, 300)}`,
		);
	}
}

/** A real template object, which some tags check for. */
function template(text: string): TemplateStringsArray {
	// `raw` must not be enumerable: Bun's tag checks for a real template object.
	return Object.freeze(
		Object.defineProperty([text], 'raw', { value: Object.freeze([text]) }),
	) as unknown as TemplateStringsArray;
}

/** A fixed statement with no values, for set-up the package does not build, such as `alter table … type`. */
export function raw(text: string): CompiledType {
	return { text, values: [], strings: template(text) };
}

/** What every case receives: the database under test and the schema it owns. */
export interface ContextType {
	readonly db: Database;
	/** The types module for this target. */
	readonly types: typeof import('@okikio/sql/postgres').types;
	/** A schema name unique to this client and target. */
	readonly name: string;
}

/** Run a fixed statement. */
export async function run(executor: Executor, text: string): Promise<void> {
	await executor.run(raw(text));
}
