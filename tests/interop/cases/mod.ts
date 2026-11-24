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
	/** The first line of the error, or the cases that blocked this one. */
	readonly detail?: string;
	readonly ms: number;
}

/** The first line of an error that says something; Prisma starts its messages with a blank line. */
const short = (error: unknown): string =>
	String((error as Error | undefined)?.message ?? error).split('\n').map((
		line,
	) => line.trim()).find(Boolean)
		?.slice(0, 400) ?? String(error);

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
