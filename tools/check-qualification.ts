/**
 * Check that every publishable package and canonical test has a qualification owner.
 *
 * The matrix describes claims and executable evidence selections. Passing this
 * check proves its references and coverage are maintained; runtime and artifact
 * receipts must still come from the referenced gates. Test names, prose, exact
 * timing, and assertion counts are deliberately outside this contract.
 * @module
 */
import { testFiles } from './audit-fragile-tests.ts';
import { nodeTests } from './check-node.ts';
import { parse } from '@std/jsonc';

/** A source-native package manifest owns publication identity and entrypoints. */
export interface ManifestType {
	readonly name: string;
	readonly file: string;
}

/** Validate matrix structure and references independently of filesystem discovery. */
export function qualify(
	input: unknown,
	manifests: readonly ManifestType[],
	files: ReadonlySet<string>,
): readonly string[] {
	const errors: string[] = [];
	const document = object(input, 'matrix', errors);
	if (document.schemaVersion !== 1) errors.push('Unsupported qualification schemaVersion.');
	const packages = objects(document.packages, 'packages', errors);
	const scenarios = objects(document.scenarios, 'scenarios', errors);
	const reviews = objects(document.testReview, 'testReview', errors);
	const names = new Set<string>();
	const scenarioIds = new Set<string>();
	const reviewed = new Set<string>();
	for (const scenario of scenarios) {
		const id = text(scenario.id, 'scenario.id', errors);
		if (scenarioIds.has(id)) errors.push(`Duplicate scenario: ${id}`);
		scenarioIds.add(id);
		for (const field of ['flow', 'failure', 'ownership', 'proof']) text(scenario[field], `${id}.${field}`, errors);
		const origins = objects(scenario.origins, `${id}.origins`, errors);
		if (origins.length === 0) errors.push(`${id} needs consumer or repository-supported provenance.`);
		for (const origin of origins) {
			text(origin.repository, `${id}.origin.repository`, errors);
			if (strings(origin.paths, `${id}.origin.paths`, errors).length === 0) {
				errors.push(`${id} needs a concrete source path.`);
			}
		}
		const tests = strings(scenario.tests, `${id}.tests`, errors);
		if (tests.length === 0) errors.push(`${id} needs an executable scenario or contract test.`);
		for (const file of tests) reference(file, files, errors);
	}
	for (const review of reviews) {
		const file = text(review.file, 'review.file', errors);
		if (reviewed.has(file)) errors.push(`Duplicate test review: ${file}`);
		reviewed.add(file);
		reference(file, files, errors);
		text(review.protects, `${file}.protects`, errors);
		if (!['retain', 'strengthen', 'consolidate', 'type-contract'].includes(String(review.disposition))) {
			errors.push(`Unknown test disposition: ${file}`);
		}
	}
	for (const item of packages) {
		const name = text(item.name, 'package.name', errors);
		if (names.has(name)) errors.push(`Duplicate package: ${name}`);
		names.add(name);
		const manifest = manifests.find((value) => value.name === name);
		if (!manifest) errors.push(`Unknown publishable package: ${name}`);
		if (item.manifest !== manifest?.file) errors.push(`Manifest owner mismatch: ${name}`);
		text(item.model, `${name}.model`, errors);
		for (const layer of ['behavior', 'invariants']) {
			const coverage = object(item[layer], `${name}.${layer}`, errors);
			const selected = strings(coverage.files, `${name}.${layer}.files`, errors);
			const properties = strings(coverage.properties, `${name}.${layer}.properties`, errors);
			if (selected.length === 0 || properties.length === 0) {
				errors.push(`${name}.${layer} needs a concrete property and evidence file.`);
			}
			const prefix = manifest?.file.slice(0, manifest.file.lastIndexOf('/') + 1);
			if (prefix && !selected.some((file) => file.startsWith(prefix))) {
				errors.push(`${name}.${layer} needs evidence from its own focused package.`);
			}
			for (const file of selected) reference(file, files, errors);
		}
		const scenario = object(item.scenarios, `${name}.scenarios`, errors);
		const ids = strings(scenario.ids, `${name}.scenarios.ids`, errors);
		if (ids.length === 0) text(scenario.reason, `${name}.scenarios.reason`, errors);
		for (const id of ids) if (!scenarioIds.has(id)) errors.push(`Unknown scenario ${id} for ${name}.`);
		const runtime = object(item.runtime, `${name}.runtime`, errors);
		for (const lane of ['sourceDeno', 'sourceNode', 'emittedNode']) {
			const evidence = object(runtime[lane], `${name}.${lane}`, errors);
			if (lane === 'emittedNode') {
				if (typeof evidence.reason === 'string') text(evidence.reason, `${name}.${lane}.reason`, errors);
				else {
					text(evidence.command, `${name}.${lane}.command`, errors);
					reference(text(evidence.checker, `${name}.${lane}.checker`, errors), files, errors);
					text(evidence.proves, `${name}.${lane}.proves`, errors);
					const hasSemantic = evidence.semantic !== undefined;
					const hasLimit = evidence.semanticLimit !== undefined;
					if (hasSemantic === hasLimit) {
						errors.push(`${name} needs exactly one emitted semantic selection or explicit import-only limit.`);
					}
					if (hasLimit) text(evidence.semanticLimit, `${name}.emitted semantic limit`, errors);
					if (hasSemantic) {
						const semantic = object(evidence.semantic, `${name}.${lane}.semantic`, errors);
						const selected = strings(semantic.files, `${name}.emitted semantic files`, errors);
						if (selected.length === 0) {
							errors.push(`${name} needs an emitted semantic selection or a named import-only limit.`);
						}
						for (const file of selected) reference(file, files, errors);
						text(semantic.proves, `${name}.emitted semantic contract`, errors);
					}
				}
			} else {
				const selected = strings(evidence.files, `${name}.${lane}.files`, errors);
				if (selected.length === 0) text(evidence.reason, `${name}.${lane}.reason`, errors);
				else text(evidence.command, `${name}.${lane}.command`, errors);
				for (const file of selected) reference(file, files, errors);
			}
		}
		const benchmark = object(item.benchmark, `${name}.benchmark`, errors);
		if (typeof benchmark.reason === 'string') text(benchmark.reason, `${name}.benchmark.reason`, errors);
		else {
			const programs = strings(benchmark.programs, `${name}.benchmark.programs`, errors);
			if (programs.length === 0) errors.push(`${name} needs benchmark programs or a justified N/A.`);
			for (const file of programs) reference(file, files, errors);
			text(benchmark.question, `${name}.benchmark.question`, errors);
		}
	}
	for (const manifest of manifests) if (!names.has(manifest.name)) errors.push(`Unqualified package: ${manifest.name}`);
	for (const file of files) {
		if (/(?:\.test|_test)\.ts$/.test(file) && !reviewed.has(file)) errors.push(`Unreviewed test: ${file}`);
	}
	return errors;
}

/** Keep the source Node claims equal to the suites selected by the actual runtime gate. */
export function qualifyNodeSelection(input: unknown, selection: readonly string[]): readonly string[] {
	const errors: string[] = [];
	const packages = objects(object(input, 'matrix', errors).packages, 'packages', errors);
	const selected = new Set(selection);
	const reported = new Set<string>();
	for (const item of packages) {
		const name = text(item.name, 'package.name', errors);
		const runtime = object(item.runtime, `${name}.runtime`, errors);
		const node = object(runtime.sourceNode, `${name}.sourceNode`, errors);
		const files = strings(node.files, `${name}.sourceNode.files`, errors);
		for (const file of files) {
			reported.add(file);
			if (!selected.has(file)) errors.push(`${name} claims an unselected Node test: ${file}`);
		}
		const manifest = text(item.manifest, `${name}.manifest`, errors);
		const prefix = manifest.slice(0, manifest.lastIndexOf('/') + 1);
		for (const file of selected) {
			if (prefix && file.startsWith(prefix) && !files.includes(file)) {
				errors.push(`${name} omits a selected focused Node test: ${file}`);
			}
		}
	}
	for (const file of selected) {
		if (!reported.has(file)) errors.push(`Selected Node test has no qualification record: ${file}`);
	}
	return errors;
}

/** Keep every declared performance question tied to an existing executable program and a named comparison limit. */
export function qualifyBenchmarks(
	input: unknown,
	manifests: readonly ManifestType[],
	files: ReadonlySet<string>,
): readonly string[] {
	const errors: string[] = [];
	const document = object(input, 'benchmark registry', errors);
	if (document.schemaVersion !== 1) errors.push('Unsupported benchmark schemaVersion.');
	const packages = object(document.packages, 'benchmark packages', errors);
	const names = new Set(manifests.map((manifest) => manifest.name));
	for (const [name, selection] of Object.entries(packages)) {
		if (!names.has(name)) errors.push(`Unknown benchmark package: ${name}`);
		const entries = objects(selection, `${name}.benchmarks`, errors);
		if (entries.length === 0) errors.push(`${name} needs an executable performance question.`);
		const programs = new Set<string>();
		for (const entry of entries) {
			const program = text(entry.program, `${name}.program`, errors);
			if (programs.has(program)) errors.push(`Duplicate benchmark program ${program} for ${name}.`);
			programs.add(program);
			reference(program, files, errors);
			for (const field of ['question', 'comparison', 'limits']) text(entry[field], `${name}.${field}`, errors);
		}
	}
	for (const name of names) if (!Object.hasOwn(packages, name)) errors.push(`Unqualified benchmark package: ${name}`);
	return errors;
}

/** Discover the current manifest set; additions and removals cannot escape the matrix. */
export async function manifests(root: string): Promise<readonly ManifestType[]> {
	const result: ManifestType[] = [];
	for await (const directory of Deno.readDir(`${root}/packages`)) {
		if (!directory.isDirectory) continue;
		for (const name of ['deno.json', 'deno.jsonc']) {
			const file = `packages/${directory.name}/${name}`;
			let source: string;
			try {
				source = await Deno.readTextFile(`${root}/${file}`);
			} catch (error) {
				if (error instanceof Deno.errors.NotFound) continue;
				throw error;
			}
			const value = parse(source) as { readonly name?: unknown; readonly exports?: unknown };
			if (typeof value.name === 'string' && value.exports !== undefined) result.push({ name: value.name, file });
		}
	}
	return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Select a JSON object while retaining useful field context for failures. */
function object(value: unknown, label: string, errors: string[]): Readonly<Record<string, unknown>> {
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return value as Readonly<Record<string, unknown>>;
	}
	errors.push(`${label} must be an object.`);
	return {};
}

/** Select a JSON array of objects without silently dropping invalid members. */
function objects(value: unknown, label: string, errors: string[]): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) {
		errors.push(`${label} must be an array.`);
		return [];
	}
	return value.map((item, index) => object(item, `${label}[${index}]`, errors));
}

/** Require concrete explanatory text rather than an empty or vague pass marker. */
function text(value: unknown, label: string, errors: string[]): string {
	if (typeof value === 'string' && value.trim().length > 0 && !/^(?:tested|covered|pass)$/i.test(value.trim())) {
		return value;
	}
	errors.push(`${label} needs concrete text.`);
	return '';
}

/** Validate a complete string array and preserve duplicate evidence as a review error. */
function strings(value: unknown, label: string, errors: string[]): readonly string[] {
	if (!Array.isArray(value)) {
		errors.push(`${label} must be an array.`);
		return [];
	}
	const result = value.map((item, index) => text(item, `${label}[${index}]`, errors));
	if (new Set(result).size !== result.length) errors.push(`${label} contains duplicate entries.`);
	return result;
}

/** Verify a repository reference and forbid hidden or escaping investigation paths. */
function reference(file: string, files: ReadonlySet<string>, errors: string[]): void {
	if (
		file.startsWith('/') || file.split('/').some((part) => part === '..' || part.startsWith('.')) || !files.has(file)
	) {
		errors.push(`Missing or non-canonical evidence file: ${file}`);
	}
}

if (import.meta.main) {
	const root = Deno.cwd();
	const document = JSON.parse(await Deno.readTextFile(`${root}/docs/qualification.json`)) as unknown;
	const benchmarks = JSON.parse(await Deno.readTextFile(`${root}/bench/coverage.json`)) as unknown;
	const selected = await manifests(root);
	const files = new Set<string>(await Array.fromAsync(testFiles(root)));
	// Matrix references may also identify canonical benchmark and artifact checkers.
	for (const item of objects(object(document, 'matrix', []).packages, 'packages', [])) {
		const runtime = object(item.runtime, 'runtime', []);
		const emitted = object(runtime.emittedNode, 'emitted', []);
		const benchmark = object(item.benchmark, 'benchmark', []);
		const references = [emitted.checker, ...strings(benchmark.programs ?? [], 'programs', [])];
		for (const file of references) {
			if (typeof file !== 'string' || file.startsWith('/') || file.split('/').some((part) => part.startsWith('.'))) {
				continue;
			}
			try {
				if ((await Deno.stat(`${root}/${file}`)).isFile) files.add(file);
			} catch (error) {
				if (!(error instanceof Deno.errors.NotFound)) throw error;
			}
		}
	}
	const registry = object(object(benchmarks, 'benchmark registry', []).packages, 'benchmark packages', []);
	for (const selection of Object.values(registry)) {
		for (const entry of objects(selection, 'selection', [])) {
			const file = entry.program;
			if (typeof file !== 'string' || file.startsWith('/') || file.split('/').some((part) => part.startsWith('.'))) {
				continue;
			}
			try {
				if ((await Deno.stat(`${root}/${file}`)).isFile) files.add(file);
			} catch (error) {
				if (!(error instanceof Deno.errors.NotFound)) throw error;
			}
		}
	}
	const errors = [
		...qualify(document, selected, files),
		...qualifyBenchmarks(benchmarks, selected, files),
		...qualifyNodeSelection(document, nodeTests),
	];
	for (const error of errors) console.error(error);
	console.log(
		`Qualification references: ${selected.length} packages, ${
			[...files].filter((file) => file.endsWith('.test.ts')).length
		} tests.`,
	);
	if (errors.length > 0) Deno.exit(1);
}
