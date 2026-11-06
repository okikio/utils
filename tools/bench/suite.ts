/** Discover workload owners without maintaining a second list of benchmark files. @module */
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);

/** One independently launched program and the host policy declared beside it. */
export interface Workload {
	readonly path: string;
	readonly optional: boolean;
	readonly deno: boolean;
}

/** Registration-only modules and specialized experiments are not standalone Mitata programs. */
export function discoverBenchmarks(directory: URL = root): readonly Workload[] {
	const values: Workload[] = [];
	/** Walk owned source directories without following dependency or fixture trees. */
	function visit(path: string): void {
		for (const entry of readdirSync(new URL(path, directory), { withFileTypes: true })) {
			if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['node_modules', 'fixtures'].includes(entry.name)) {
				continue;
			}
			const name = `${path}${entry.name}`;
			if (entry.isDirectory()) visit(`${name}/`);
			else if (entry.name.endsWith('.bench.ts') || name === 'bench/mod.ts') {
				const source = readFileSync(new URL(name, directory), 'utf8');
				if (/^\/\/ @benchmark (?:register-only|runner=)/mu.test(source)) continue;
				values.push({
					path: name,
					optional: /^\/\/ @benchmark optional$/mu.test(source),
					deno: /^\/\/ @benchmark deno$/mu.test(source),
				});
			}
		}
	}
	visit('packages/');
	visit('bench/');
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

/** Match a package name or directory, failing rather than silently measuring the full suite. */
export function selectPrograms(values: readonly string[], project?: string): readonly string[] {
	if (project === undefined) return values;
	const name = project.replace(/^@okikio\//u, '').replace(/^packages\//u, '').replace(/\/$/u, '');
	const selected = values.filter((value) => value.startsWith(`packages/${name}/`));
	if (selected.length === 0) throw new TypeError(`No benchmarks match project ${project}.`);
	return selected;
}
