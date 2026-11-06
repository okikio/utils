/** Inspect current source and generate isolated A/B modules for measurement. */
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { digest, provenance } from '#tools/bench/freeze/provenance.mjs';

/** Only the ignored experiment directory receives generated files. */
const root = resolve(import.meta.dirname, '../../..');
const output = resolve(root, '.tmp/artifacts/bench/freeze');
/** Use the compiler already installed by the selected source snapshot. */
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
/** Source paths under the package workspace, including tests for separate counts. */
const files = [];
/** Visit source folders without entering installed dependencies or generated products. */
async function visitDirectory(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) await visitDirectory(path);
		else if (/\.[cm]?tsx?$/.test(entry.name)) files.push(path);
	}
}
await visitDirectory(resolve(root, 'packages'));
/** Exact AST call sites; a site count is not an execution-frequency measurement. */
const sites = [];
/** A local Object binding would make a syntactic count ambiguous. */
const objectBindings = [];
/** File evidence makes each generated module attributable to immutable source bytes. */
const hashes = {};
/** Select a syntactic Object.freeze call, excluding comments and strings. */
function isFreeze(node) {
	return ts.isCallExpression(node) &&
		ts.isPropertyAccessExpression(node.expression) &&
		ts.isIdentifier(node.expression.expression) &&
		node.expression.expression.text === 'Object' &&
		node.expression.name.text === 'freeze';
}
for (const file of files.sort()) {
	/** Hash the exact bytes being inspected so generated treatments retain source provenance. */
	const text = await readFile(file, 'utf8');
	/** Repository-relative names keep the inventory useful after the checkout is moved. */
	const name = relative(root, file).split(sep).join('/');
	/** Parent links let the review distinguish callable code from initialization. */
	const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
	hashes[name] = createHash('sha256').update(text).digest('hex');
	/** Record each call with surrounding declarations and its immediate operand shape. */
	const inspect = (node) => {
		if (
			(ts.isVariableDeclaration(node) || ts.isParameter(node) ||
				ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
				ts.isImportClause(node) || ts.isImportSpecifier(node) ||
				ts.isNamespaceImport(node)) && node.name
		) {
			/** Destructured bindings can shadow Object just as a direct variable can. */
			const inspectBinding = (name) => {
				if (ts.isIdentifier(name) && name.text === 'Object') {
					objectBindings.push({
						file: relative(root, file).split(sep).join('/'),
						line: source.getLineAndCharacterOfPosition(name.getStart(source)).line +
							1,
					});
				} else if (
					ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)
				) {
					for (
						const element of name.elements
					) if (ts.isBindingElement(element)) inspectBinding(element.name);
				}
			};
			inspectBinding(node.name);
		}
		if (isFreeze(node)) {
			/** Preserve enclosing names for manual review without claiming complete value-escape analysis. */
			const owners = [];
			let current = node.parent;
			/** These independent lexical hints avoid treating private code or instance fields as startup-only work. */
			let insideFunction = false;
			let insidePrivateMethod = false;
			let insideExportedDeclaration = false;
			let insideInstanceInitializer = false;
			while (current && current !== source) {
				if (ts.isFunctionLike(current)) insideFunction = true;
				if (ts.canHaveModifiers(current)) {
					const modifiers = ts.getModifiers(current) ?? [];
					if (
						ts.isPropertyDeclaration(current) &&
						!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
					) insideInstanceInitializer = true;
					if (
						modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
					) insideExportedDeclaration = true;
					if (
						ts.isMethodDeclaration(current) &&
						modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)
					) insidePrivateMethod = true;
				}
				if (
					ts.isMethodDeclaration(current) &&
					ts.isPrivateIdentifier(current.name)
				) insidePrivateMethod = true;
				if (
					(ts.isFunctionDeclaration(current) ||
						ts.isMethodDeclaration(current) ||
						ts.isVariableDeclaration(current) ||
						ts.isClassDeclaration(current)) && current.name
				) owners.push(current.name.getText(source));
				current = current.parent;
			}
			const argument = node.arguments[0];
			sites.push({
				file: name,
				line: source.getLineAndCharacterOfPosition(node.getStart(source)).line +
					1,
				production: !/(?:\.test\.|\.bench\.|\/fixtures\/)/.test(name),
				owners: owners.reverse(),
				insideFunction,
				declarationHint: insidePrivateMethod
					? 'inside-private-method'
					: insideExportedDeclaration
					? 'inside-exported-declaration'
					: 'inside-unexported-declaration',
				executionHint: !insideFunction
					? insideInstanceInitializer ? 'instance-field-initialization' : 'module-initialization'
					: owners.some((owner) => /^(?:define(?:[A-Z]|$)|catalog$|protocol$)/.test(owner))
					? 'definition-factory-candidate'
					: 'invoked-code-unclassified',
				directReturn: ts.isReturnStatement(node.parent),
				operand: argument ? ts.SyntaxKind[argument.kind] : 'missing',
				snippet: node.getText(source).replace(/\s+/g, ' ').slice(0, 200),
			});
		}
		ts.forEachChild(node, inspect);
	};
	inspect(source);
}
/** Tests and fixtures remain in the evidence but do not inflate the production count. */
const production = sites.filter((s) => s.production);
/** Package totals identify review scope, not measured execution frequency. */
const packages = {};
for (const site of production) {
	const name = site.file.split('/')[1];
	packages[name] = (packages[name] ?? 0) + 1;
}
await mkdir(resolve(output, 'generated'), { recursive: true });
/** Resolve workspace imports to the inspected source, without loading a different package version. */
async function importsFor(source, file) {
	/** The same specifier substitutions are applied to both treatments. */
	const imports = new Map();
	for (const node of source.statements) {
		if (
			(!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
			!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)
		) continue;
		const spec = node.moduleSpecifier.text;
		let path;
		if (spec.startsWith('.')) path = resolve(dirname(file), spec);
		else {
			const match = /^@okikio\/([^/]+)(.*)$/.exec(spec);
			if (match) {
				const folder = resolve(root, 'packages', match[1]);
				try {
					const manifest = JSON.parse(
						await readFile(resolve(folder, 'package.json'), 'utf8'),
					);
					const target = manifest.exports[match[2] ? '.' + match[2] : '.'];
					if (typeof target === 'string') path = resolve(folder, target);
				} catch (error) {
					// Published owned packages can lack a workspace manifest; malformed local manifests must fail.
					if (error?.code !== 'ENOENT') throw error;
				}
			}
		}
		if (path) {
			/** Relative specifiers allow regeneration inside a relocated bench/freeze folder. */
			const portable = relative(resolve(output, 'generated'), path).split(sep)
				.join('/');
			imports.set(spec, portable.startsWith('.') ? portable : `./${portable}`);
		}
	}
	return imports;
}
/** Build a module copy that differs only at targeted freeze calls, plus import path adaptation. */
async function variant(name, path, freeze) {
	/** Read the selected source directly; neither treatment writes back to this path. */
	const file = resolve(root, path), text = await readFile(file, 'utf8');
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	/** Resolve imports before rewriting so treatment selection cannot change dependency versions. */
	const imports = await importsFor(source, file);
	/** Count substituted call sites as an auditable treatment description. */
	let removed = 0;
	const transformed = ts.transform(source, [(context) => {
		/** Rewrites are AST operations so doc examples and unrelated identifiers remain untouched. */
		const visitor = (node) => {
			if (path.endsWith('/progress.ts')) {
				// Registration is not timed; omit it identically to avoid loading the unrelated effect runtime.
				if (
					ts.isImportDeclaration(node) &&
					node.moduleSpecifier.text === '@okikio/capability/effect'
				) return undefined;
				if (
					ts.isVariableStatement(node) &&
					node.declarationList.declarations.some((d) => d.name.getText(source) === 'ProgressEffect')
				) return undefined;
			}
			if (
				ts.isImportDeclaration(node) && imports.has(node.moduleSpecifier.text)
			) {
				return ts.factory.updateImportDeclaration(
					node,
					node.modifiers,
					node.importClause,
					ts.factory.createStringLiteral(
						imports.get(node.moduleSpecifier.text),
					),
					node.attributes,
				);
			}
			if (
				ts.isExportDeclaration(node) && node.moduleSpecifier && imports.has(node.moduleSpecifier.text)
			) {
				// Namespace and named re-exports retain the same source owner in both generated treatments.
				return ts.factory.updateExportDeclaration(
					node,
					node.modifiers,
					node.isTypeOnly,
					node.exportClause,
					ts.factory.createStringLiteral(imports.get(node.moduleSpecifier.text)),
					node.attributes,
				);
			}
			if (!freeze && isFreeze(node)) {
				removed++;
				return ts.visitNode(node.arguments[0], visitor);
			}
			return ts.visitEachChild(node, visitor, context);
		};
		return (node) => ts.visitNode(node, visitor);
	}]);
	const printed = ts.createPrinter().printFile(transformed.transformed[0]);
	transformed.dispose();
	const emitted = ts.transpileModule(printed, {
		compilerOptions: {
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.ESNext,
			removeComments: false,
		},
	}).outputText;
	/** Each treatment has its own module instance and private metadata tables. */
	const target = resolve(
		output,
		'generated',
		`${name}-${freeze ? 'frozen' : 'plain'}.mjs`,
	);
	await writeFile(
		target,
		`// Research copy of ${path}. Baseline SHA256 ${hashes[path]}.\n// Freeze treatment: ${
			freeze ? 'original' : 'Object.freeze calls replaced by their argument; intentionally weaker mutation guarantees'
		}.\n` + emitted,
	);
	/** Sidecars preserve source types when the repository checks the harness with allowJs disabled. */
	const declarations = target.replace(/\.mjs$/, '.d.mts');
	/** Re-export from the same inspected source instead of maintaining a second hand-written type model. */
	const sourcePath = relative(dirname(target), file).split(sep).join('/');
	const sourceSpecifier = sourcePath.startsWith('.') ? sourcePath : `./${sourcePath}`;
	await writeFile(
		declarations,
		'/** Source types are shared; the plain runtime treatment intentionally weakens mutation guarantees. */\n' +
			`export ${name === 'progress' ? '{ ProgressSchema }' : '*'} from ${JSON.stringify(sourceSpecifier)};\n`,
	);
	return {
		name,
		path,
		sourceSha256: hashes[path],
		variant: freeze ? 'frozen' : 'plain',
		removedFreezeCalls: removed,
		generated: relative(output, target).split(sep).join('/'),
		declarations: relative(output, declarations).split(sep).join('/'),
		generatedSha256: digest(await readFile(target)),
		declarationsSha256: digest(await readFile(declarations)),
	};
}
/** Pair manifests record exact source hashes and the separately generated frozen/plain modules. */
const generated = [];
// Restrict treatment copies to inspected modules used by the harness; the rest of Utils stays unchanged.
for (
	const [name, path] of [
		['result', 'packages/result/mod.ts'],
		['record', 'packages/collection/record/mod.ts'],
		['catalog', 'packages/collection/catalog/mod.ts'],
		['progress', 'packages/task/progress.ts'],
	]
) {
	for (const freeze of [true, false]) {
		generated.push(await variant(name, path, freeze));
	}
}
/** Retain both aggregate review hints and individual locations so counts remain inspectable. */
const inventory = {
	schemaVersion: 2,
	sourceRoot: '.',
	provenance: await provenance(root, output, generated, ts, require),
	typescript: ts.version,
	files: files.length,
	productionSites: production.length,
	testAndBenchmarkSites: sites.length - production.length,
	productionFiles: new Set(production.map((s) => s.file)).size,
	/** Instance fields execute per construction, so they are excluded from module-initialization totals. */
	topLevelSites: production.filter((s) => s.executionHint === 'module-initialization').length,
	outsideFunctionSites: production.filter((s) => !s.insideFunction).length,
	instanceFieldSites: production.filter((s) => s.executionHint === 'instance-field-initialization').length,
	insideFunctionSites: production.filter((s) => s.insideFunction).length,
	objectBindings,
	/** Lexical visibility does not establish whether a frozen value escapes to a public consumer. */
	declarationHints: Object.fromEntries(
		[...new Set(production.map((site) => site.declarationHint))].map((
			hint,
		) => [
			hint,
			production.filter((site) => site.declarationHint === hint).length,
		]),
	),
	/** Factory names provide triage hints; runtime profiling is still needed to establish hotness. */
	executionHints: Object.fromEntries(
		[...new Set(production.map((site) => site.executionHint))].map((
			hint,
		) => [
			hint,
			production.filter((site) => site.executionHint === hint).length,
		]),
	),
	packages: Object.fromEntries(
		Object.entries(packages).sort((a, b) => b[1] - a[1]),
	),
	sites,
	generated,
	note:
		'Syntactic Object.freeze calls only. Binding names are checked for local Object shadowing; computed property calls and aliases are excluded. Declaration/execution hints describe lexical placement, not complete value-escape analysis. Private methods can return public values; exported factories may run only at startup. Static counts do not establish call frequency, import cost, or hotness. The scanner does not count freezes inside dependencies.',
};
await writeFile(
	resolve(output, 'inventory.json'),
	JSON.stringify(inventory, null, 2) + '\n',
);
console.log(JSON.stringify(
	{
		productionSites: inventory.productionSites,
		testAndBenchmarkSites: inventory.testAndBenchmarkSites,
		productionFiles: inventory.productionFiles,
		topLevelSites: inventory.topLevelSites,
		insideFunctionSites: inventory.insideFunctionSites,
		packages: inventory.packages,
		generated,
	},
	null,
	2,
));
