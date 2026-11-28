/** Discover tests once; classify only capabilities that need a specific host or external resource. @module */
import { glob, lstat } from 'node:fs/promises';
import { join, sep } from 'node:path';

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
	| 'interop'
	| 'soak'
	| 'docs'
	| 'types';

/** A discovered source file and the reason it needs a particular test environment. */
export interface TestFile {
	/** Repository-relative source path, independent of the caller's working directory. */
	readonly path: string;
	/** Required host or external resource; portable tests can run on every supported native host. */
	readonly family: Family;
	/** Human-readable reason this file belongs to its host or resource owner. */
	readonly reason: string;
}

/** Filesystem containers that cannot contain authored test programs. */
const Ignored = new Set(['node_modules', '.artifacts', '.tmp', '.git', 'fixtures', 'generated', 'baseline-20261031']);
/** Authored test filenames accepted by every selected native host. */
const TestPattern = '**/*{.test,_test}.{ts,mts,cts,js,mjs,cjs}';
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

/** Container tests that also drive Playwright browsers. Only a CI shard that runs one installs the engines. */
export const BrowserFiles: ReadonlySet<string> = new Set(['tests/workflows/duplex-browser.test.ts']);

/** Classify a test by its owned capability. Every new ordinary test defaults to every portable runtime. */
export function classify(path: string): TestFile {
	if (/(?:^|\.)types\.test\.ts$/u.test(path) || /\/types\.test\.ts$/u.test(path)) {
		return { path, family: 'types', reason: 'Compile-time consumer fixture; checked by the type task.' };
	}
	if (path.startsWith('tests/interop/')) {
		return {
			path,
			family: 'interop',
			reason:
				'Starts PostgreSQL, poolers, proxies and compatible servers in Docker and runs every client through them.',
		};
	}
	if (path === 'tests/workflows/postgres-soak.test.ts') {
		return { path, family: 'soak', reason: 'Opt-in multi-hour PostgreSQL load with owned Docker fixtures.' };
	}
	if (BrowserFiles.has(path)) {
		return {
			path,
			family: 'containers',
			reason: 'Requires real Playwright browser engines and one owned Docker HTTP host.',
		};
	}
	if (
		[
			'tests/workflows/duplex-containers.test.ts',
			'tests/workflows/duplex-proxy.test.ts',
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

/** Native globs traverse only selected source directories; this module classifies the discovered tests. */
export async function discover(root: string, filters: readonly string[] = []): Promise<readonly TestFile[]> {
	const selected = filters.map(testPath);
	const directories = selected.length === 0 || selected.includes('.')
		? ['packages', 'tests', 'tools', 'bench']
		: selected;
	const paths = new Set<string>();
	for (const directory of directories) {
		if (
			!/^(?:packages|tests|tools|bench)(?:\/|$)/u.test(directory) ||
			directory.split('/').some((part) => Ignored.has(part))
		) continue;
		const entry = await lstat(join(root, directory)).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return undefined;
			throw error;
		});
		if (entry?.isFile() && /(?:\.test|_test)\.(?:[cm]?[jt]s)$/u.test(directory)) paths.add(directory);
		if (!entry?.isDirectory()) continue;
		for await (
			const path of glob(TestPattern, {
				cwd: join(root, directory),
				exclude: [...Ignored].map((name) => `**/${name}/**`),
			})
		) paths.add(`${directory}/${path.split(sep).join('/')}`);
	}
	return [...paths].sort().map(classify);
}

/** Source suites include portable behavior and only the adapters their real runtime can execute. */
export function supports(file: TestFile, runtime: Runtime): boolean {
	return file.family === 'portable' || file.family === runtime ||
		(file.family === 'web-worker' && runtime !== 'node');
}

/** Normalize a caller-resolved repository path without allowing traversal outside the source roots. */
function testPath(filter: string): string {
	const path = filter.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '');
	if (path === '.') return path;
	if (path === '' || path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '.')) {
		throw new TypeError(`Use a repository-relative test file or directory: ${filter}`);
	}
	return path;
}

/**
 * Return the files for CI shard `index` of `total`, counting from 1. Files are sorted by path and
 * dealt in turn, so each shard's list is stable across runs and every file runs in exactly one shard.
 *
 * @example Three shards of the container tests
 * ```ts
 * const mine = shard(files.filter((file) => file.family === 'containers'), 2, 3);
 * ```
 */
export function shard(files: readonly TestFile[], index: number, total: number): readonly TestFile[] {
	if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(index) || index < 1 || index > total) {
		throw new RangeError(`A shard is <index>/<total> with 1 <= index <= total; received ${index}/${total}.`);
	}
	return files.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
		.filter((_, position) => position % total === index - 1);
}

/** Select exact files or directory prefixes, rejecting typos instead of silently running an empty suite. */
export function select(files: readonly TestFile[], filters: readonly string[]): readonly TestFile[] {
	if (filters.length === 0) return files;
	const selected = new Set<TestFile>();
	for (const filter of filters) {
		const path = testPath(filter);
		const matches = files.filter((file) => path === '.' || file.path === path || file.path.startsWith(`${path}/`));
		if (matches.length === 0) {
			throw new TypeError(
				`No selected test matches ${filter}. Run mise run test:list to inspect ownership.`,
			);
		}
		for (const match of matches) selected.add(match);
	}
	return [...selected].sort((a, b) => a.path.localeCompare(b.path));
}
