/** Discover workload owners without maintaining a second list of benchmark files. @module */
import { globSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);

/** One independently launched program and the host policy declared beside it. */
export interface Workload {
	/** Repository-relative program path used by the selected runtime. */
	readonly path: string;
	/** Explicit resource experiments stay outside ordinary benchmark correctness checks. */
	readonly optional: boolean;
	/** A native Deno capability prevents this workload from running through another host. */
	readonly deno: boolean;
}

/** Registration-only modules and specialized experiments are not standalone Mitata programs. */
export function discoverBenchmarks(directory: URL = root): readonly Workload[] {
	const values: Workload[] = [];
	for (
		const path of globSync(['{packages,bench}/**/*.bench.ts', 'bench/mod.ts'], {
			cwd: directory,
			exclude: ['**/node_modules/**', '**/fixtures/**', '**/.*/**'],
		})
	) {
		const name = path.split(sep).join('/');
		const source = readFileSync(new URL(name, directory), 'utf8');
		if (/^\/\/ @benchmark (?:register-only|runner=)/mu.test(source)) continue;
		values.push({
			path: name,
			optional: /^\/\/ @benchmark optional$/mu.test(source),
			deno: /^\/\/ @benchmark deno$/mu.test(source),
		});
	}
	return values.sort((left, right) => left.path.localeCompare(right.path));
}

const workloads = discoverBenchmarks();
/** Package programs keep their fixtures and independent correctness checks beside their implementation. */
export const packagePrograms: readonly string[] = workloads.filter((value) =>
	value.path.startsWith('packages/') && !value.optional
).map((value) => value.path);
/** Root programs compose utilities or exercise real hosts. */
export const integrationPrograms: readonly string[] = workloads.filter((value) =>
	value.path.startsWith('bench/') && !value.optional
).map((value) => value.path);
/** Explicit resource workflows never enter the ordinary suite. */
export const optionalPrograms: readonly string[] = workloads.filter((value) => value.optional).map((value) =>
	value.path
);
/** A native host requirement is owned by the workload, not inferred from a runtime shim. */
export const denoPrograms: readonly string[] = workloads.filter((value) => value.deno).map((value) => value.path);
/** Each program starts with a fresh Mitata registration realm. */
export const programs: readonly string[] = [...packagePrograms, ...integrationPrograms];

/** Native package scripts run in their owner directory; repository tasks keep the complete workload set. */
export function selectPrograms(values: readonly string[], directory = '.'): readonly string[] {
	const path = relative(fileURLToPath(root), resolve(directory)).split(sep).join('/');
	if (path === '') return values;
	if (path.startsWith('../') || path === '..') {
		throw new TypeError('Benchmark ownership must stay inside the repository.');
	}
	const selected = values.filter((value) => value.startsWith(`${path}/`));
	if (selected.length === 0) throw new TypeError(`No benchmarks belong to ${path}.`);
	return selected;
}
