/** Retain serial native reports, exact inputs and failures; correctness gates never compare speed. */
import { cpus, release, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { programs } from './suite.ts';
import { validateMitata } from './validate.ts';
const root = new URL('../', import.meta.url);
const positional = Deno.args.filter((value) => !value.startsWith('--'));
const consumer = positional[1];
const available = consumer === undefined ? programs : [...programs, './npm-imports.bench.ts'];
const selector = Deno.args.find((value) => value.startsWith('--program='))?.slice('--program='.length);
if (selector !== undefined && !available.includes(selector)) throw new TypeError('Unknown benchmark program.');
const selected = selector === undefined ? available : [selector];
const output = positional[0] ?? `.artifacts/bench/${new Date().toISOString().replaceAll(':', '-')}`;
await Deno.mkdir(output, { recursive: true });
const policy = { NODE_DISABLE_COLORS: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
const metadata = {
	status: 'running' as 'running' | 'pass' | 'fail' | 'invalid',
	createdAt: new Date().toISOString(),
	runtime: Deno.version,
	resourceLimits: await limits(),
	platform: {
		...Deno.build,
		osRelease: release(),
		cpu: cpus()[0]?.model,
		cpus: cpus().length,
		memoryBytes: totalmem(),
	},
	color: policy,
	gc: 'manual GC exposed; workload selects once or inner; natural GC remains in timed work',
	cache: 'fresh program processes; dependency and OS caches may be warm',
	inputs: await identity(),
	inputsAfter: undefined as Record<string, string> | undefined,
	runs: [] as {
		program: string;
		args: string[];
		status: 'running' | 'pass' | 'fail';
		elapsedMs: number;
		report: string;
		stderr: string;
		failure?: string;
	}[],
	failure: undefined as string | undefined,
};
await save();
try {
	for (const [index, program] of selected.entries()) {
		const args = [
			'run',
			'--no-check',
			'--v8-flags=--expose-gc',
			'-A',
			new URL(program, import.meta.url).href,
			'--json',
			...(Deno.args.includes('--reverse') ? ['--reverse'] : []),
			...(program === './npm-imports.bench.ts' ? ['--consumer', consumer!] : []),
		];
		const report = `${output}/${index}.json`, stderr = `${output}/${index}.stderr`;
		const row = {
			program,
			args,
			status: 'running' as 'running' | 'pass' | 'fail',
			elapsedMs: 0,
			report,
			stderr,
			failure: undefined as string | undefined,
		};
		metadata.runs.push(row);
		await save();
		const started = performance.now();
		try {
			const child = new Deno.Command(Deno.execPath(), { args, env: policy, stdout: 'piped', stderr: 'piped' }).spawn();
			let expired = false;
			const watchdog = setTimeout(() => {
				expired = true;
				try {
					child.kill('SIGKILL');
				} catch { /* Child already exited. */ }
			}, 20 * 60_000);
			let result: Deno.CommandOutput;
			try {
				result = await child.output();
			} finally {
				clearTimeout(watchdog);
			}
			await Deno.writeFile(report, result.stdout);
			await Deno.writeFile(stderr, result.stderr);
			if (!result.success || expired) {
				throw new Error(`${program} ${expired ? 'exceeded watchdog' : `exited ${result.code}`}.`);
			}
			validateMitata(JSON.parse(new TextDecoder().decode(result.stdout)));
			row.status = 'pass';
			console.log(`Recorded ${program} (${Math.round(performance.now() - started)} ms).`);
		} catch (error) {
			row.status = 'fail';
			row.failure = String(error);
			throw error;
		} finally {
			row.elapsedMs = performance.now() - started;
			await save();
		}
	}
	metadata.inputsAfter = await identity();
	if (JSON.stringify(metadata.inputs) !== JSON.stringify(metadata.inputsAfter)) {
		metadata.status = 'invalid';
		throw new Error('Benchmark inputs changed during measurement. Discard timings.');
	}
	metadata.status = 'pass';
} catch (error) {
	if (metadata.status !== 'invalid') metadata.status = 'fail';
	metadata.failure = error instanceof Error ? error.stack ?? error.message : String(error);
	throw error;
} finally {
	await save();
}
console.log(`Validated all native reports in ${output}.`);

/** Save progress before each launch and after completion, retaining failed evidence. */
async function save(): Promise<void> {
	await Deno.writeTextFile(`${output}/meta.json`, `${JSON.stringify(metadata, null, 2)}\n`);
}
/** Hash production code, fixtures, registry and lockfiles; generated output and prose are excluded. */
async function identity(): Promise<Record<string, string>> {
	const paths = [
		'deno.jsonc',
		'deno.lock',
		'package.json',
		'pnpm-lock.yaml',
		'mise.toml',
		'.mise/tasks/bench',
		'.mise/tasks/bench-npm',
	];
	await visit(new URL('packages/', root), paths);
	await visit(new URL('bench/', root), paths);
	await visit(new URL('tests/fixtures/', root), paths);
	if (consumer !== undefined) {
		const archives = JSON.parse(await Deno.readTextFile(`${consumer}/archives.json`)) as string[];
		for (const path of archives) paths.push(path);
	}
	paths.sort();
	const entries: [string, string][] = [];
	for (const path of paths) {
		const hash = await crypto.subtle.digest(
			'SHA-256',
			await Deno.readFile(path.startsWith('/') ? path : new URL(path, root)),
		);
		entries.push([path, Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('')]);
	}
	return Object.fromEntries(entries);
}
/** Walk only source-bearing inputs, avoiding package-local dependency links and old artifacts. */
async function visit(directory: URL, paths: string[]): Promise<void> {
	for await (const entry of Deno.readDir(directory)) {
		if (entry.isSymlink || ['node_modules', 'dist', '.artifacts'].includes(entry.name)) continue;
		const url = new URL(entry.name + (entry.isDirectory ? '/' : ''), directory);
		if (entry.isDirectory) await visit(url, paths);
		else if (/\.(?:ts|jsonc?|csv|html|xml|txt)$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name)) {
			paths.push(fileURLToPath(url).slice(fileURLToPath(root).length));
		}
	}
}

/** Retain container quotas when present; host hardware fields alone do not describe a capped runner. */
async function limits(): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	if (Deno.build.os !== 'linux') return result;
	for (const name of ['memory.max', 'cpu.max', 'cpuset.cpus.effective']) {
		try {
			result[name] = (await Deno.readTextFile(`/sys/fs/cgroup/${name}`)).trim();
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) throw error;
		}
	}
	return result;
}
