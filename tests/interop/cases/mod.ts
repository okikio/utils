/**
 * Every compatibility case, in the order they run, and the runner each runtime shares.
 *
 * A case may read what an earlier case wrote, and names those cases in `after`. When one of them did not pass, the
 * case is reported as blocked instead of failing for a reason that is not its own.
 *
 * @module
 */
import type { Database } from '@okikio/sql/postgres';
import { types as postgres } from '@okikio/sql/postgres';
import { raw } from './check.ts';
import { adopt } from './adopt.ts';
import { edges } from './edges.ts';
import { tables } from './schema.ts';
import { setup } from './setup.ts';
import { statements } from './statements.ts';
import type { CaseType } from './types.ts';
import { values } from './values.ts';

export const cases: readonly CaseType[] = [
	...setup,
	...statements,
	...values,
	...edges,
	...adopt,
];

/** The types modules a target may need. */
/**
 * The types module each flavor of server reads with. A server's own module loads only for that server, so a change to
 * the CockroachDB types reruns only CockroachDB results.
 */
const flavors = {
	postgres: () => Promise.resolve(postgres),
	cockroach: async () => (await import('@okikio/sql/postgres/cockroach')).types,
} as const;
export type FlavorType = keyof typeof flavors;

/** One case's result. */
export interface OutcomeType {
	readonly case: string;
	readonly status: 'pass' | 'fail' | 'blocked';
	/** The bounded error/cause chain with SQLSTATE codes, or the cases that blocked this one. */
	readonly detail?: string;
	readonly ms: number;
}

/** Preserve the database cause hidden by transaction wrappers; bound cyclic or deeply nested errors. */
function short(error: unknown): string {
	const parts: string[] = [];
	const seen = new Set<unknown>();
	let current = error;
	while (current !== undefined && parts.length < 4 && !seen.has(current)) {
		seen.add(current);
		const item = current !== null && typeof current === 'object'
			? current as {
				readonly message?: unknown;
				readonly code?: unknown;
				readonly cause?: unknown;
				readonly fields?: { readonly code?: unknown };
			}
			: undefined;
		// Prisma starts some messages with a blank line; retain the first useful line at each level.
		const message = String(item?.message ?? current).split('\n').map((line) => line.trim()).find(Boolean) ?? '';
		const state = item?.code ?? item?.fields?.code;
		const code = typeof state === 'string' ? ` [${state.slice(0, 32)}]` : '';
		parts.push(`${message.slice(0, 360)}${code}`);
		current = item?.cause;
	}
	return parts.join(' <- ');
}

/** Run every case against one database in schema `name`, dropping the schema before and after. */
export async function runCases(
	db: Database,
	name: string,
	options: {
		readonly only?: ReadonlySet<string>;
		readonly flavor?: FlavorType;
	} = {},
): Promise<OutcomeType[]> {
	const types = await flavors[options.flavor ?? 'postgres']();
	const t = tables(name, types);
	const passed = new Set<string>();
	const outcomes: OutcomeType[] = [];
	await dropSchema(db, name);
	for (const item of cases) {
		if (options.only && !options.only.has(item.name)) continue;
		const missing = (item.after ?? []).filter((name) => !passed.has(name));
		if (missing.length) {
			outcomes.push({
				case: item.name,
				status: 'blocked',
				detail: `needs: ${missing.join('; ')}`,
				ms: 0,
			});
			continue;
		}
		const started = performance.now();
		try {
			await item.run({ db, name, t, types });
			passed.add(item.name);
			outcomes.push({
				case: item.name,
				status: 'pass',
				ms: Math.round(performance.now() - started),
			});
		} catch (error) {
			outcomes.push({
				case: item.name,
				status: 'fail',
				detail: short(error),
				ms: Math.round(performance.now() - started),
			});
		}
	}
	await dropSchema(db, name).catch(() => {});
	return outcomes;
}

/** Drop a client's schema and everything in it. */
async function dropSchema(db: Database, name: string): Promise<void> {
	await db.run(raw(`drop schema if exists "${name}" cascade`));
}
