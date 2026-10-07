/** Record eight fresh native-runtime challenger reports before computing paired uncertainty. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { challengerCandidates, challengerNames } from './challenger-contract.ts';
import {
	challengerOrders,
	challengerWorkloads,
	compareChallengers,
	completeChallengers,
} from './challenger-compare.ts';
import { validateMitata } from './validate.ts';

const args = process.argv.slice(2);
for (const value of args) {
	if (value.startsWith('--') && !['--runtime=', '--executable='].some((prefix) => value.startsWith(prefix))) {
		throw new TypeError(`Unknown comparison option: ${value}`);
	}
}
const positional = args.filter((value) => !value.startsWith('--'));
if (positional.length > 1) throw new TypeError('Provide one comparison output directory.');
const runtime = args.find((value) => value.startsWith('--runtime='))?.slice(10) ?? 'deno';
if (!['deno', 'node', 'bun'].includes(runtime)) throw new TypeError('Select deno, node or bun.');
const executable = args.find((value) => value.startsWith('--executable='))?.slice(13) ??
	(runtime === 'node' ? process.execPath : runtime);
if (!executable) throw new TypeError('Runtime executable cannot be empty.');
const root = new URL('../', import.meta.url);
const program = fileURLToPath(new URL('./http-challengers.bench.ts', import.meta.url));
const output = resolve(
	positional[0] ?? `.artifacts/challengers/${runtime}-${new Date().toISOString().replaceAll(':', '-')}`,
);
// A failed rerun must never leave a successful comparison from an older run.
await mkdir(resolve(output, '..'), { recursive: true });
await mkdir(output);
const policy = { ...process.env, NODE_DISABLE_COLORS: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
const metadata = {
	status: 'running',
	createdAt: new Date().toISOString(),
	controller: process.version,
	workloadRuntime: runtime,
	workloadVersions: undefined,
	candidateConfiguration: undefined,
	platform: {
		platform: process.platform,
		arch: process.arch,
		osRelease: release(),
		cpu: cpus()[0]?.model,
		cpus: cpus().length,
		memoryBytes: totalmem(),
	},
	resourceLimits: {},
	inputs: await identity(),
	trials: [],
	failure: undefined,
	method:
		'Eight fresh processes; Williams orders balance candidate position and directed predecessors twice; setup/preflight/compilation/close excluded from Mitata dispatch trials.',
	limits:
		'Individual 95% paired log-ratio Student-t intervals (df=7), approximate independent normal log ratios. Shared host/systematic bias and multiple-comparison uncertainty remain; no timing gate. In-process Fetch, not native listening-server throughput.',
};
for (const name of ['cpu.max', 'memory.max', 'cpuset.cpus.effective', 'cpu.stat', 'memory.events']) {
	try {
		metadata.resourceLimits[name] = (await readFile(`/sys/fs/cgroup/${name}`, 'utf8')).trim();
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}
const rows = new Map(
	challengerWorkloads.map((id) => [id, Object.fromEntries(challengerCandidates.map((candidate) => [candidate, []]))]),
);

/** Save incomplete progress too; a failed native run cannot leave a success-looking comparison. */
async function save() {
	await writeFile(`${output}/meta.json`, `${JSON.stringify(metadata, null, 2)}\n`);
}

/** Join the native child on every exit path, retaining stderr and raw native stdout. */
async function trial(index) {
	const launch = runtime === 'deno'
		? ['run', '--no-check', '--v8-flags=--expose-gc', '-A', program, '--json', `--order=${index}`]
		: runtime === 'node'
		? ['--expose-gc', program, '--json', `--order=${index}`]
		: [program, '--json', `--order=${index}`];
	const row = {
		index,
		order: challengerOrders[index],
		executable,
		args: launch,
		status: 'running',
		stdout: `trial-${index}.json`,
		stderr: `trial-${index}.stderr`,
		elapsedMs: 0,
	};
	metadata.trials.push(row);
	await save();
	const start = performance.now();
	let stdout = '', stderr = '', expired = false;
	const child = spawn(executable, launch, { cwd: fileURLToPath(root), env: policy, stdio: ['ignore', 'pipe', 'pipe'] });
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	const watchdog = setTimeout(() => {
		expired = true;
		child.kill('SIGKILL');
	}, 20 * 60_000);
	try {
		await new Promise((settle, reject) => {
			child.on('error', reject);
			child.on(
				'close',
				(code, signal) =>
					code === 0 && !expired
						? settle()
						: reject(new Error(`Challenger trial exited ${code}/${signal}${expired ? ' after watchdog' : ''}.`)),
			);
		});
		const receipts = stderr.split('\n').flatMap((line) => {
			try {
				const value = JSON.parse(line);
				return value.phase === 'challenger-runtime' ? [value] : [];
			} catch {
				return [];
			}
		});
		if (
			receipts.length !== 1 || receipts[0].runtime?.name !== runtime ||
			JSON.stringify(receipts[0].order) !== JSON.stringify(row.order)
		) {
			throw new Error('Native child did not identify the requested runtime and candidate order.');
		}
		const receipt = receipts[0];
		const configuration = { elysia: receipt.elysia, vixeny: receipt.vixeny };
		if (
			metadata.workloadVersions !== undefined &&
			JSON.stringify(metadata.workloadVersions) !== JSON.stringify(receipt.runtime)
		) throw new Error('Workload runtime changed across trials.');
		if (
			metadata.candidateConfiguration !== undefined &&
			JSON.stringify(metadata.candidateConfiguration) !== JSON.stringify(configuration)
		) throw new Error('Candidate configuration changed across trials.');
		metadata.workloadVersions = receipt.runtime;
		metadata.candidateConfiguration = configuration;
		const report = JSON.parse(stdout);
		validateMitata(report);
		completeChallengers(report.benchmarks.flatMap((benchmark) => benchmark.runs.map(() => benchmark.alias)));
		for (const benchmark of report.benchmarks) {
			const match = /^(Utils|Hono|Elysia|Vixeny): (.+)$/u.exec(benchmark.alias);
			if (!match) throw new Error('Unknown challenger report alias.');
			const candidate = challengerCandidates.find((value) => challengerNames[value] === match[1]);
			const values = rows.get(match[2])?.[candidate];
			if (values === undefined || values.length !== index || benchmark.runs.length !== 1) {
				throw new Error('Incomplete challenger trial pairing.');
			}
			values.push(benchmark.runs[0].stats.avg);
		}
		row.status = 'pass';
	} catch (error) {
		row.status = 'fail';
		row.failure = String(error);
		throw error;
	} finally {
		clearTimeout(watchdog);
		row.elapsedMs = performance.now() - start;
		await writeFile(`${output}/${row.stdout}`, stdout);
		await writeFile(`${output}/${row.stderr}`, stderr);
		await save();
	}
}

try {
	await save();
	for (let index = 0; index < challengerOrders.length; index++) {
		if (JSON.stringify(await identity()) !== JSON.stringify(metadata.inputs)) {
			throw new Error('Challenger source inputs changed before a trial.');
		}
		await trial(index);
		if (JSON.stringify(await identity()) !== JSON.stringify(metadata.inputs)) {
			throw new Error('Challenger source inputs changed during a trial.');
		}
		console.log(`Recorded native ${runtime} challenger trial ${index + 1}/8.`);
	}
	metadata.inputsAfter = await identity();
	if (JSON.stringify(metadata.inputsAfter) !== JSON.stringify(metadata.inputs)) {
		throw new Error('Challenger source inputs changed before reporting.');
	}
	const comparisons = [...rows].flatMap(([id, row]) =>
		challengerCandidates.filter((candidate) => candidate !== 'utils').map((candidate) =>
			compareChallengers(id, challengerNames[candidate], row.utils, row[candidate])
		)
	);
	await writeFile(
		`${output}/comparison.json`,
		`${
			JSON.stringify(
				{
					runtime: metadata.workloadVersions,
					configuration: metadata.candidateConfiguration,
					method: metadata.method,
					limits: metadata.limits,
					comparisons,
				},
				null,
				2,
			)
		}\n`,
	);
	metadata.status = 'pass';
} catch (error) {
	metadata.status = 'fail';
	metadata.failure = error.stack ?? String(error);
	throw error;
} finally {
	metadata.finishedAt = new Date().toISOString();
	await save();
}

/** Hash production, benchmark and fixture inputs independently of elapsed profiler data or prose. */
async function identity() {
	const paths = [
		'deno.jsonc',
		'deno.lock',
		'package.json',
		'pnpm-lock.yaml',
		'mise.toml',
		'.artifacts/challengers/vixeny.mjs',
		'.artifacts/challengers/vixeny-build.json',
	];
	for (const directory of ['packages', 'bench', 'tests/fixtures']) await visit(directory);
	paths.sort();
	const entries = [];
	for (const path of paths) {
		entries.push([path, createHash('sha256').update(await readFile(new URL(path, root))).digest('hex')]);
	}
	return Object.fromEntries(entries);
	async function visit(directory) {
		for (const entry of await readdir(new URL(`${directory}/`, root), { withFileTypes: true })) {
			if (entry.isSymbolicLink() || ['node_modules', 'dist', '.artifacts'].includes(entry.name)) continue;
			const path = `${directory}/${entry.name}`;
			if (entry.isDirectory()) await visit(path);
			else if (/\.(?:ts|mjs|jsonc?|csv|html|xml|txt)$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name)) {
				paths.push(path);
			}
		}
	}
}
