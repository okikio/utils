/**
 * Checks that make statement mistakes fail before they run in production.
 *
 * - {@link render} turns a named set of statements into stable SQL text. Commit it next to the adapter and compare it
 *   in a test, so a review shows the real SQL that changed and an accidental change fails.
 * - {@link describe} asks PostgreSQL to parse and plan each statement against an installed schema, without running
 *   it, and compares the result columns with the statement's declared shape. A wrong table, column, parameter type or
 *   result name fails here.
 *
 * @module
 */
import type { CompiledType } from './fragment.ts';
import { type Ddl, isDdl, toDdlQuery } from './ddl.ts';
import { type Statement, toQuery } from './statement.ts';

/** Statements and schema statements by name. */
export type CatalogType = Readonly<Record<string, Statement<unknown> | Ddl>>;

/** The compiled form of a statement or schema statement. */
export function compiled(entry: Statement<unknown> | Ddl): CompiledType {
	return isDdl(entry) ? toDdlQuery(entry) : toQuery(entry);
}

/**
 * Stable SQL text for a catalog: each entry under a `-- name` comment, in name order, with its parameter casts.
 * Parameter values are not written; they vary per call.
 */
export function render(catalog: CatalogType): string {
	return Object.keys(catalog).sort().map((name) => `-- ${name}\n${compiled(catalog[name]!).text};\n`).join('\n');
}

/** What PostgreSQL reports for a statement: its parameter types and result column names. */
export interface DescriptionType {
	readonly parameters: number;
	readonly columns: readonly string[];
}

/** A mismatch found by {@link describe}. */
export interface ProblemType {
	readonly name: string;
	readonly problem: string;
}

/**
 * Describe every statement and report mismatches. `describe` must ask the database to prepare the text without
 * running it; with Postgres.js that is `(text) => sql.unsafe(text).describe()`, mapped to {@link DescriptionType}.
 * Schema statements are skipped, because PostgreSQL does not describe DDL; run them in a rolled-back transaction.
 */
export async function describe(
	catalog: CatalogType,
	describe: (text: string) => Promise<DescriptionType>,
): Promise<readonly ProblemType[]> {
	const problems: ProblemType[] = [];
	for (const name of Object.keys(catalog).sort()) {
		const entry = catalog[name]!;
		if (isDdl(entry)) continue;
		const query = toQuery(entry);
		let description: DescriptionType;
		try {
			description = await describe(query.text);
		} catch (error) {
			problems.push({ name, problem: error instanceof Error ? error.message : String(error) });
			continue;
		}
		if (description.parameters !== query.values.length) {
			problems.push({ name, problem: `expects ${description.parameters} parameters, sends ${query.values.length}` });
		}
		const declared = Object.keys(entry.shape);
		// A statement without a declared result may still return a placeholder column.
		if (declared.length && description.columns.join(',') !== declared.join(',')) {
			problems.push({ name, problem: `returns ${description.columns.join(', ')}, declares ${declared.join(', ')}` });
		}
	}
	return problems;
}
