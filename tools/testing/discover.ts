/** Discover tests once; classify only capabilities that need a specific host or external resource. @module */
import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

/** Native source-test hosts. Browser behavior has its own Playwright task. */
export type Runtime = 'deno' | 'node' | 'bun';
/** Test ownership, kept separate from the runtime used to execute a test. */
export type Family =
	| 'portable'
	| 'comparison'
	| 'deno'
	| 'node'
	| 'web-worker'
	| 'postgres'
	| 'containers'
	| 'soak'
	| 'docs'
	| 'types';

/** A discovered source file and the reason it needs a particular test environment. */
export interface TestFile {
	readonly path: string;
	readonly family: Family;
	readonly reason: string;
}

/** Filesystem containers that cannot contain authored test programs. */
const Ignored = new Set(['node_modules', '.artifacts', '.tmp', '.git', 'fixtures', 'generated', 'baseline-20261031']);
/** These tools exercise Deno's compiler/module graph or Deno-hosted child fixtures. */
const DenoFiles = new Set([
	'tests/imports.test.ts',
	'tests/selective.test.ts',
	'tests/process-orchestration.test.ts',
	'tests/activity-providers.test.ts',
	'tests/worker-groups.test.ts',
	'packages/worker/process/mod.test.ts',
]);
/** Module Workers are native in Deno and Bun; Node uses the explicit worker_threads adapter. */
const WebWorkerFiles = new Set(['packages/runtime/web.test.ts', 'tests/restartable-worker.test.ts']);

/** Classify a test by its owned capability. Every new ordinary test defaults to every portable runtime. */
export function classify(path: string): TestFile {
	if (/(?:^|\.)types\.test\.ts$/u.test(path) || /\/types\.test\.ts$/u.test(path)) {
		return { path, family: 'types', reason: 'Compile-time consumer fixture; checked by the type task.' };
	}
	if (path === 'tests/workflows/postgres-soak.test.ts') {
		return { path, family: 'soak', reason: 'Opt-in multi-hour PostgreSQL load with owned Docker fixtures.' };
	}
	if (path === 'tests/workflows/duplex-browser.test.ts') {
		return {
			path,
			family: 'containers',
			reason: 'Requires real Playwright browser engines and one owned Docker HTTP host.',
		};
	}
	if (
		[
			'tests/workflows/duplex-containers.test.ts',
			'tests/workflows/containers.test.ts',
			'tests/workflows/nested-containers.test.ts',
			'tests/workflows/session-containers.test.ts',
			'tests/workflows/streaming-load.test.ts',
			'tests/workflows/postgres-failover.test.ts',
			'tests/workflows/postgres-load.test.ts',
			'tests/workflows/postgres-leases.test.ts',
		].includes(path)
	) {
		return {
			path,
			family: 'containers',
			reason: 'Owns Docker fixtures, real sockets, and fault-injected service lifetimes.',
		};
	}
	if (
		path.startsWith('tests/workflows/') || path === 'packages/storage/queue/postgres.test.ts' ||
		path === 'packages/storage/state/postgres.test.ts'
	) {
		return { path, family: 'postgres', reason: 'Requires a disposable PostgreSQL database and real child processes.' };
	}
	if (path === 'tests/docs.test.ts') {
		return { path, family: 'docs', reason: 'Compiles and executes authored documentation with the Deno CLI.' };
	}
	if (
		[
			'tests/alternatives.test.ts',
			'tests/http-parity.test.ts',
			'tests/elysia-parity.test.ts',
			'tests/http-vixeny.test.ts',
		].includes(path)
	) {
		return {
			path,
			family: 'comparison',
			reason: 'Compares independent libraries; its pinned Vixeny fixture requires explicit preparation.',
		};
	}
	if (path.startsWith('packages/runtime/deno/') || DenoFiles.has(path)) {
		return { path, family: 'deno', reason: 'Exercises a Deno host API or a Deno-specific repository tool.' };
	}
	if (
		path === 'tests/nested-hosts.test.ts' || path.startsWith('packages/runtime/node/') ||
		path === 'packages/worker/process/node.test.ts'
	) {
		return { path, family: 'node', reason: 'Exercises the native Node worker or process adapter.' };
	}
	if (WebWorkerFiles.has(path)) {
		return { path, family: 'web-worker', reason: 'Requires a native Web Worker with TypeScript module loading.' };
	}
	return { path, family: 'portable', reason: 'Same source test runs on Deno, Node and Bun.' };
}

/** Walk package tests, composition tests and tool tests in stable order without following dependency links. */
export async function discover(root: string): Promise<readonly TestFile[]> {
	const paths: string[] = [];
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.isSymbolicLink() || Ignored.has(entry.name)) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile() && /(?:\.test|_test)\.[cm]?[jt]s$/u.test(entry.name)) {
				paths.push(relative(root, path).split(sep).join('/'));
			}
		}
	}
	for (const directory of ['packages', 'tests', 'tools', 'bench']) {
		await visit(resolve(root, directory));
	}
	return paths.sort().map(classify);
}

/** Source suites include portable behavior and only the adapters their real runtime can execute. */
export function supports(file: TestFile, runtime: Runtime): boolean {
	return file.family === 'portable' || file.family === runtime ||
		(file.family === 'web-worker' && runtime !== 'node');
}

/** Select exact files or directory prefixes, rejecting typos instead of silently running an empty suite. */
export function select(files: readonly TestFile[], filters: readonly string[]): readonly TestFile[] {
	if (filters.length === 0) return files;
	const selected = new Set<TestFile>();
	for (const filter of filters) {
		const path = filter.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '');
		if (path === '' || path.split('/').some((part) => part === '..' || part === '.')) {
			throw new TypeError(`Use a repository-relative test file or directory: ${filter}`);
		}
		const matches = files.filter((file) => file.path === path || file.path.startsWith(`${path}/`));
		if (matches.length === 0) {
			throw new TypeError(
				`No selected test matches ${filter}. Run mise run test -- --suite list to inspect ownership.`,
			);
		}
		for (const match of matches) selected.add(match);
	}
	return [...selected].sort((a, b) => a.path.localeCompare(b.path));
}
