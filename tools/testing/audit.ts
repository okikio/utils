/** Inspect test registrations and runtime dependencies without executing test bodies. @module */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import type { TestFile } from '#tools/testing/discover.ts';

/** Reject unregistered tests and accidental Deno-only fixture code in the portable test family. */
export async function audit(root: string, files: readonly TestFile[]): Promise<void> {
	const problems: string[] = [];
	const counts: Record<string, number> = {};
	for (const file of files) {
		counts[file.family] = (counts[file.family] ?? 0) + 1;
		const source = ts.createSourceFile(
			file.path,
			await readFile(join(root, file.path), 'utf8'),
			ts.ScriptTarget.Latest,
			true,
		);
		const functions = new Set<string>();
		const namespaces = new Set<string>();
		const registrations = new Set(['test', 'it', 'describe', 'suite']);
		for (const statement of source.statements) {
			if (
				!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
				statement.moduleSpecifier.text !== 'node:test' || statement.importClause?.isTypeOnly
			) continue;
			const clause = statement.importClause;
			if (clause?.name) functions.add(clause.name.text);
			const bindings = clause?.namedBindings;
			if (bindings && ts.isNamespaceImport(bindings)) {
				namespaces.add(bindings.name.text);
			} else if (bindings && ts.isNamedImports(bindings)) {
				for (const binding of bindings.elements) {
					if (!binding.isTypeOnly && registrations.has(binding.propertyName?.text ?? binding.name.text)) {
						functions.add(binding.name.text);
					}
				}
			}
		}
		const registration = (node: ts.Expression): boolean => {
			if (ts.isIdentifier(node)) return functions.has(node.text);
			if (!ts.isPropertyAccessExpression(node)) return false;
			if (ts.isIdentifier(node.expression)) {
				if (node.expression.text === 'Deno' && node.name.text === 'test') return true;
				if (namespaces.has(node.expression.text) && registrations.has(node.name.text)) return true;
			}
			return ['only', 'skip', 'todo'].includes(node.name.text) && registration(node.expression);
		};
		let runner = false;
		let deno = false;
		const inspect = (node: ts.Node): void => {
			if (ts.isCallExpression(node) && registration(node.expression)) runner = true;
			if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Deno') {
				deno = true;
			}
			// Ambient host type annotations do not execute, so they cannot make a portable test runtime-specific.
			if (!ts.isTypeNode(node)) ts.forEachChild(node, inspect);
		};
		inspect(source);
		if (file.family === 'types' && runner) {
			problems.push(`${file.path}: runtime tests must not hide in a type-only fixture.`);
		}
		if (file.family !== 'types' && !runner) problems.push(`${file.path}: no native test registration call found.`);
		// This test deliberately runs child hosts with missing globals and guards its Deno.execPath branch.
		if (file.family === 'portable' && deno && file.path !== 'tests/compatibility.test.ts') {
			problems.push(`${file.path}: portable tests cannot require an unclassified Deno host API.`);
		}
	}
	if (problems.length) {
		throw new AggregateError(problems.map((problem) => new Error(problem)), 'Test ownership is incomplete.');
	}
	console.log(JSON.stringify({ files: files.length, families: counts, status: 'pass' }, null, 2));
}
