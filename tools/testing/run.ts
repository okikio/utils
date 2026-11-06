/** Select authored tests and delegate execution to the native runtime, without maintaining per-runtime file lists. @module */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { discover, select, supports } from '#tools/testing/discover.ts';
import type { Runtime, TestFile } from '#tools/testing/discover.ts';

const Root = fileURLToPath(new URL('../../', import.meta.url));
/** Browser installation and PostgreSQL are explicit tasks; ordinary source tests never provision either. */
const Help = `Usage: run.ts <deno|node|bun|postgres|containers|soak|docs|list|check> [file-or-directory ...]
       run.ts comparisons <deno|node|bun> [file-or-directory ...]

Source tests use one discovered file set with declared host/resource requirements.
Postgres requires UTILS_TEST_DATABASE_URL for a disposable database.
Containers owns Docker fixtures. Soak owns opt-in multi-hour Docker runs. Docs compiles runnable examples with Deno.
Comparisons uses prepared competitor fixtures on the selected native runtime.
List prints ownership without executing tests. Check validates test registration and ownership.
Selectors are repository-relative files or directories; unmatched selectors fail.
`;

let execution = 0;
const invocation = `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`;

/** Stream native diagnostics to console and disk, preserving failure receipts without buffering the whole suite. */
async function execute(
	binary: string,
	args: readonly string[],
	label: string,
	selection: readonly string[],
	environment?: NodeJS.ProcessEnv,
): Promise<void> {
	const reports = new URL('../../.tmp/tests/native/', import.meta.url);
	await mkdir(reports, { recursive: true });
	const name = `${label}-${invocation}-${++execution}`;
	const startedAt = new Date().toISOString();
	const started = performance.now();
	const env = environment === undefined ? process.env : { ...process.env, ...environment };
	const version = spawnSync(binary, ['--version'], {
		cwd: Root,
		env,
		encoding: 'utf8',
		timeout: 5000,
		maxBuffer: 64 * 1024,
	});
	const report = {
		status: 'running',
		startedAt,
		runtime: { executable: binary, version: version.stdout?.trim() ?? '', versionExitCode: version.status },
		arguments: args,
		files: selection,
		log: `${name}.log`,
	};
	const receipt = new URL(`${name}.json`, reports);
	await writeFile(receipt, `${JSON.stringify(report, null, 2)}\n`);
	if (version.error || version.status !== 0) {
		const error = version.error ?? new Error(`Cannot inspect ${binary}: ${version.stderr}`);
		await writeFile(receipt, `${JSON.stringify({ ...report, status: 'failed', error: String(error) }, null, 2)}\n`);
		throw error;
	}
	const child = spawn(binary, [...args], {
		cwd: Root,
		stdio: ['inherit', 'pipe', 'pipe'],
		env,
	});
	const log = createWriteStream(new URL(report.log, reports));
	let logError: unknown;
	const saved = finished(log).catch((error: unknown) => {
		logError = error;
		child.kill('SIGTERM');
	});
	child.stdout.pipe(process.stdout, { end: false });
	child.stderr.pipe(process.stderr, { end: false });
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
		child.once('error', (error) => resolve({ code: null, signal: null, error }));
		// close follows closed stdio, so the final diagnostic cannot arrive after the receipt is completed.
		child.once('close', (code, signal) => resolve({ code, signal }));
	});
	log.end();
	await saved;
	const error = result.error ?? logError;
	await writeFile(
		receipt,
		`${
			JSON.stringify(
				{
					...report,
					status: result.code === 0 && error === undefined && result.signal === null ? 'passed' : 'failed',
					exitCode: result.code,
					signal: result.signal,
					elapsedMs: performance.now() - started,
					...(error === undefined ? {} : { error: String(error) }),
				},
				null,
				2,
			)
		}\n`,
	);
	if (error !== undefined) throw error;
	if (result.signal !== null) throw new Error(`${binary} stopped with ${result.signal}.`);
	if (result.code !== 0) process.exit(result.code ?? 1);
}

/** Fail missing fixture admission before launching tests, so a selected resource suite cannot become a skip. */
function postgresEnvironment(): NodeJS.ProcessEnv {
	const value = process.env.UTILS_TEST_DATABASE_URL;
	if (value === undefined || value.trim() === '') {
		throw new TypeError('test:postgres requires UTILS_TEST_DATABASE_URL for a disposable PostgreSQL database.');
	}
	const parsed = new URL(value);
	if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname.length < 2) {
		throw new TypeError('UTILS_TEST_DATABASE_URL must select a disposable PostgreSQL database.');
	}
	return {
		UTILS_QUEUE_DATABASE_URL: value,
		UTILS_WORKFLOW_TEST_DATABASE_URL: value,
		UTILS_WORKFLOW_OPERATIONS_DATABASE_URL: value,
		UTILS_INSPECTION_TEST_DATABASE_URL: value,
	};
}

/** Deno tests need fixture files, local sockets and owned native children; no unrestricted external network. */
const DenoPermissions = [
	'--allow-read',
	'--allow-write',
	'--allow-env',
	'--allow-run',
	'--allow-sys',
	'--allow-ffi',
	'--allow-net=127.0.0.1,localhost,[::1]',
];

/** Keep runtime flags separate from test selectors so a misspelled option cannot silently alter coverage. */
function runtime(value: string | undefined): value is Runtime {
	return value === 'deno' || value === 'node' || value === 'bun';
}

if (import.meta.main) {
	const [command, ...filters] = process.argv.slice(2);
	if (command === '--help' || command === '-h' || command === undefined) {
		console.log(Help);
		if (command === undefined) process.exitCode = 2;
	} else {
		const host = command === 'comparisons' ? filters.shift() : runtime(command) ? command : undefined;
		if (command === 'comparisons' && !runtime(host)) throw new TypeError('Comparisons requires deno, node or bun.');
		const files = await discover(Root);
		if (files.length === 0) throw new Error('No authored test files were discovered.');
		if (command === 'list') {
			console.log(JSON.stringify(select(files, filters), null, 2));
		} else if (command === 'check') {
			if (filters.length) throw new TypeError('Test ownership checks inspect the complete test inventory.');
			const { audit } = await import('#tools/testing/audit.ts');
			await audit(Root, files);
		} else {
			let selected: readonly TestFile[];
			if (runtime(command)) selected = files.filter((file) => supports(file, command));
			else if (command === 'comparisons') selected = files.filter((file) => file.family === 'comparison');
			else if (['postgres', 'containers', 'soak', 'docs'].includes(command)) {
				selected = files.filter((file) => file.family === command);
			} else throw new TypeError(`Unknown test command ${command}.\n${Help}`);
			selected = select(selected, filters);
			if (selected.length === 0) throw new Error(`No ${command} tests were selected.`);
			console.log(
				`${command}: ${selected.length} discovered test files. Type fixtures and other resource owners are separate tasks.`,
			);
			const label = command === 'comparisons' ? `comparisons-${host}` : command;
			if (host === 'deno' || command === 'docs') {
				const proxy = 'packages/runtime/deno/proxy.network.test.ts';
				const ordinary = selected.filter((file) => file.path !== proxy).map((file) => file.path);
				const args = ['test', '--frozen', '--unstable-worker-options', ...DenoPermissions];
				if (ordinary.length) await execute(process.env.DENO_BIN ?? 'deno', [...args, ...ordinary], label, ordinary);
				if (selected.some((file) => file.path === proxy)) {
					// This fixture explicitly selects its local SOCKS server. Inherited proxy bypass would change its contract.
					await execute(process.env.DENO_BIN ?? 'deno', [...args, proxy], label, [proxy], {
						NO_PROXY: '',
						no_proxy: '',
					});
				}
			} else if (host === 'bun') {
				await execute(
					process.env.UTILS_BUN ?? 'bun',
					[
						'test',
						'--timeout',
						'30000',
						'--preload',
						'./packages/duration/polyfill.ts',
						'--preload',
						'./packages/dispose/polyfill.ts',
						...selected.map((file) => `./${file.path}`),
					],
					label,
					selected.map((file) => file.path),
				);
			} else {
				await execute(
					process.env.UTILS_TEST_NODE ?? 'node',
					[
						'--import',
						'./packages/duration/polyfill.ts',
						'--import',
						'./packages/dispose/polyfill.ts',
						'--test',
						command === 'soak' ? '--test-timeout=90000000' : '--test-timeout=300000',
						`--test-concurrency=${host === 'node' ? 4 : 1}`,
						...selected.map((file) => file.path),
					],
					label,
					selected.map((file) => file.path),
					command === 'postgres' ? postgresEnvironment() : undefined,
				);
			}
		}
	}
}
