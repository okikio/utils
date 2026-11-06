/** Check generated treatment equivalence and the source hashes used in this experiment. */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { digest, provenance } from '#tools/bench/freeze/provenance.mjs';

/** Resolve ignored experiment output from the repository root, independent of the caller's working directory. */
const root = resolve(import.meta.dirname, '../../..');
const directory = resolve(root, '.tmp/artifacts/bench/freeze');
const options = process.argv.slice(2);
if (options.some((value) => value !== '--write')) {
	throw new TypeError('Only --write is supported; verification is read-only by default.');
}
/** The generator's manifest is the authority for which source bytes and treatment pairs are checked. */
const inventoryBytes = await readFile(resolve(directory, 'inventory.json'));
const inventory = JSON.parse(inventoryBytes.toString('utf8'));
if (inventory.schemaVersion !== 2) throw new Error('Run bench:freeze:prepare for this source checkpoint first.');
/** Use the source snapshot's compiler instead of introducing another parser version. */
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
const current = await provenance(root, directory, inventory.generated, ts, require);
if (JSON.stringify(current) !== JSON.stringify(inventory.provenance)) {
	throw new Error('Treatment dependencies or measurement controls changed. Prepare a new checkpoint before measuring.');
}

/** Canonicalize emitted JavaScript with exactly the documented freeze treatment. */
function canonicalize(text, removeFreeze) {
	const source = ts.createSourceFile(
		'variant.mjs',
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	const transformed = ts.transform(source, [(context) => {
		/** Normalize only the promised freeze treatment; any other runtime difference must fail equality. */
		function visit(node) {
			if (
				removeFreeze && ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				ts.isIdentifier(node.expression.expression) &&
				node.expression.expression.text === 'Object' &&
				node.expression.name.text === 'freeze'
			) return ts.visitNode(node.arguments[0], visit);
			return ts.visitEachChild(node, visit, context);
		}
		return (node) => ts.visitNode(node, visit);
	}]);
	const printed = ts.createPrinter().printFile(transformed.transformed[0]);
	transformed.dispose();
	return ts.transpileModule(printed, {
		compilerOptions: {
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.ESNext,
			removeComments: true,
		},
	}).outputText;
}

/** Keep source-integrity evidence separate from generated-pair equivalence evidence. */
const sourceChecks = [], treatmentChecks = [];
for (const name of new Set(inventory.generated.map((entry) => entry.name))) {
	/** Resolve a pair by its explicit treatment label rather than relying on array order. */
	const original = inventory.generated.find((entry) => entry.name === name && entry.variant === 'frozen');
	const control = inventory.generated.find((entry) => entry.name === name && entry.variant === 'plain');
	/** Hash current source bytes to detect drift since the treatment copies were prepared. */
	const source = await readFile(resolve(root, original.path));
	const sha256 = createHash('sha256').update(source).digest('hex');
	if (sha256 !== original.sourceSha256) {
		throw new Error(`Source changed: ${original.path}`);
	}
	sourceChecks.push({ path: original.path, sha256, unchanged: true });
	/** Comments and formatting are ignored; emitted runtime behavior must differ only by freeze calls. */
	const frozen = await readFile(resolve(directory, original.generated), 'utf8');
	const plain = await readFile(resolve(directory, control.generated), 'utf8');
	for (const entry of [original, control]) {
		if (
			digest(await readFile(resolve(directory, entry.generated))) !== entry.generatedSha256 ||
			digest(await readFile(resolve(directory, entry.declarations))) !== entry.declarationsSha256
		) {
			throw new Error(`Generated treatment bytes changed: ${entry.name}/${entry.variant}.`);
		}
	}
	if (canonicalize(frozen, true) !== canonicalize(plain, false)) {
		throw new Error(`Unexpected treatment difference: ${name}`);
	}
	if (
		name === 'progress' &&
		(frozen.includes('export const ProgressEffect') ||
			plain.includes('export const ProgressEffect'))
	) {
		throw new Error(
			'Unmeasured ProgressEffect registration was not removed symmetrically.',
		);
	}
	treatmentChecks.push({
		name,
		onlyFreezeCallsDiffer: true,
		importsAdaptedIdentically: true,
	});
}
/** Persist evidence only after every selected source file and treatment pair passes. */
const report = {
	inventorySha256: digest(inventoryBytes),
	provenance: current,
	sourceChecks,
	treatmentChecks,
	localObjectBindings: inventory.objectBindings,
	assertion:
		'Selected source, generated treatments, shared workspace runtime dependencies, manifests and measurement controls match their recorded bytes. Generated pairs have identical emitted runtime code after the documented freeze substitution. Import paths are adapted symmetrically; the unmeasured ProgressEffect declaration and effect import are omitted from both Progress variants.',
};
if (options.includes('--write')) {
	await writeFile(
		resolve(directory, 'verification.json'),
		JSON.stringify(report, null, 2) + '\n',
	);
}
console.log(
	JSON.stringify({
		sourceFiles: sourceChecks.length,
		generatedPairs: treatmentChecks.length,
		passed: true,
	}),
);
