/** Compare isolated source projections in eight alternating pairs; never edit either source tree. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isDeepStrictEqual } from 'node:util';
import { parse } from '@std/jsonc';
import { challengerOrders } from './challenger-compare.ts';
import { challengerCandidates, challengerNames } from './challenger-contract.ts';
import { compareChallengers } from './challenger-compare.ts';
import { validateMitata } from './validate.ts';

const args = process.argv.slice(2);
for (const value of args) {
	if (
		value.startsWith('--') &&
		!['--baseline=', '--candidate=', '--runtime=', '--workload='].some((key) => value.startsWith(key))
	) {
		throw new TypeError(`Unknown source comparison option: ${value}`);
	}
}
const positional = args.filter((value) => !value.startsWith('--'));
const option = (name) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (positional.length !== 1 || !option('baseline') || !option('candidate')) {
	throw new TypeError('Provide a fresh output directory and --baseline=/source --candidate=/source.');
}
const roots = {
	baseline: await realpath(resolve(option('baseline'))),
	candidate: await realpath(resolve(option('candidate'))),
};
if (roots.baseline === roots.candidate) throw new TypeError('Source projections must be distinct.');
const runtime = option('runtime') ?? 'node';
if (!['deno', 'node', 'bun'].includes(runtime)) throw new TypeError('Select deno, node or bun.');
const workload = option('workload') ?? 'challenger-api';
const output = resolve(positional[0]);
await mkdir(resolve(output, '..'), { recursive: true });
await mkdir(output);
const environment = { ...process.env, NODE_DISABLE_COLORS: '1', NO_COLOR: '1' };
delete environment.FORCE_COLOR;
const rows = Object.fromEntries(
	Object.keys(roots).map((variant) => [variant, Object.fromEntries(challengerCandidates.map((name) => [name, []]))]),
);
const metadata = {
	status: 'running',
	runtime,
	workload,
	roots,
	inputs: {},
	trials: [],
	method:
		'Eight adjacent source pairs, alternating baseline/candidate order; equal Williams challenger orders within each pair. Native warm Mitata Fetch observations; no timing gate.',
	limits:
		'Individual paired log-ratio Student-t intervals; source pairs are separate processes. Shared host load, JIT/GC effects and multiple comparisons remain. Wire equality does not imply equal service ownership.',
};
let nativeIdentity;
const save = () => writeFile(resolve(output, 'meta.json'), `${JSON.stringify(metadata, null, 2)}\n`);

/** Hash source and compiler artifacts, excluding installed dependencies and unrelated evidence. */
async function identity(root) {
	const files = [];
	async function visit(directory) {
		for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
			if (['node_modules', '.git', '.artifacts', '.agents'].includes(entry.name)) continue;
			const name = `${directory}/${entry.name}`.replace(/^\//, '');
			if (entry.isDirectory()) await visit(name);
			else if (entry.isFile()) files.push(name);
		}
	}
	await visit('');
	files.push('.artifacts/challengers/vixeny.mjs', '.artifacts/challengers/vixeny-build.json');
	return Object.fromEntries(
		await Promise.all(
			files.sort().map(async (
				name,
			) => [name, createHash('sha256').update(await readFile(resolve(root, name))).digest('hex')]),
		),
	);
}

/** Per-trial pressure remains telemetry, not an excuse to discard a slow observation. */
async function pressure() {
	const values = {};
	for (const name of ['cpu.max', 'memory.max', 'cpu.stat', 'memory.events', 'cpu.pressure', 'memory.pressure']) {
		try {
			values[name] = (await readFile(`/sys/fs/cgroup/${name}`, 'utf8')).trim();
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}
	return values;
}

/** Tasks and presentation may differ; dependency, export and runtime interpretation must not. */
async function configuration(root) {
	const manifest = parse(await readFile(resolve(root, 'deno.jsonc'), 'utf8'));
	if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
		throw new TypeError('The Deno runtime configuration must be an object.');
	}
	return Object.fromEntries(Object.entries(manifest).filter(([name]) => !['tasks', 'fmt', 'lint'].includes(name)));
}

/** Stream native reports to disk, join the child and both pipes, then validate every measured candidate. */
async function trial(variant, index) {
	const root = roots[variant];
	const receipt = { variant, index, status: 'running', before: await pressure(), order: challengerOrders[index] };
	metadata.trials.push(receipt);
	await save();
	const stem = `${variant}-${index}`;
	const stdout = resolve(output, `${stem}.json`), stderr = resolve(output, `${stem}.stderr`);
	const program = resolve(root, 'bench/http-challengers.bench.ts');
	const flags = ['--json', `--order=${index}`, `--workload=${workload}`];
	const launch = runtime === 'deno'
		? ['run', '--no-check', '--v8-flags=--expose-gc', '-A', program, ...flags]
		: runtime === 'node'
		? ['--expose-gc', program, ...flags]
		: [program, ...flags];
	const child = spawn(runtime === 'node' ? process.execPath : runtime, launch, {
		cwd: root,
		env: environment,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	receipt.pid = child.pid;
	let spawnError, expired = false;
	child.on('error', (error) => {
		spawnError = error;
	});
	const closed = new Promise((settle) => child.once('close', (code, signal) => settle({ code, signal })));
	// Attach rejection handlers immediately; a pipe failure must also stop and join the child.
	const pipes = Promise.allSettled(
		[pipeline(child.stdout, createWriteStream(stdout)), pipeline(child.stderr, createWriteStream(stderr))].map(
			async (pipe) => {
				try {
					await pipe;
				} catch (error) {
					child.kill('SIGKILL');
					throw error;
				}
			},
		),
	);
	const watchdog = setTimeout(() => {
		expired = true;
		child.kill('SIGKILL');
	}, 5 * 60_000);
	try {
		const exit = await closed;
		const streams = await pipes;
		const failure = streams.find((value) => value.status === 'rejected');
		if (spawnError || failure || expired || exit.code !== 0) {
			throw spawnError ??
				(failure?.reason ?? new Error(`Native source trial exited ${exit.code}/${exit.signal}; timeout=${expired}.`));
		}
		const records = (await readFile(stderr, 'utf8')).split('\n').flatMap((line) => {
			try {
				const row = JSON.parse(line);
				return row.phase === 'challenger-runtime' ? [row] : [];
			} catch {
				return [];
			}
		});
		if (
			records.length !== 1 || records[0].runtime?.name !== runtime ||
			JSON.stringify(records[0].order) !== JSON.stringify(receipt.order)
		) {
			throw new Error('Native trial did not identify its requested runtime and order.');
		}
		const identity = JSON.stringify({
			runtime: records[0].runtime,
			elysia: records[0].elysia,
			vixeny: records[0].vixeny,
		});
		if (nativeIdentity !== undefined && identity !== nativeIdentity) {
			throw new Error('Runtime or challenger configuration changed across source pairs.');
		}
		nativeIdentity = identity;
		receipt.runtime = records[0].runtime;
		const report = JSON.parse(await readFile(stdout, 'utf8'));
		validateMitata(report);
		const remaining = new Set(challengerCandidates.map((name) => `${challengerNames[name]}: ${workload}`));
		for (const benchmark of report.benchmarks) {
			if (!remaining.delete(benchmark.alias) || benchmark.runs.length !== 1) {
				throw new Error('Duplicate, unexpected or missing source trial measurement.');
			}
			const name = challengerCandidates.find((name) => benchmark.alias === `${challengerNames[name]}: ${workload}`);
			rows[variant][name].push(benchmark.runs[0].stats.avg);
		}
		if (remaining.size) throw new Error('Incomplete source trial matrix.');
		receipt.status = 'pass';
	} catch (error) {
		receipt.status = 'fail';
		receipt.failure = error.stack ?? String(error);
		throw error;
	} finally {
		clearTimeout(watchdog);
		receipt.after = await pressure();
		await save();
	}
}

try {
	for (const [variant, root] of Object.entries(roots)) metadata.inputs[variant] = await identity(root);
	// Changes to Utils are the treatment. The harness, literal oracle, competitors
	// and dependency locks must remain identical across the source projections.
	for (
		const name of [
			'bench/http-challengers.bench.ts',
			'bench/challenger-compare.ts',
			'bench/challenger-contract.ts',
			'bench/challenger-run.ts',
			'bench/fixtures/http-challengers.ts',
			'pnpm-lock.yaml',
			'deno.lock',
			'package.json',
			'mise.toml',
			'tests/fixtures/http-parity/corpus.ts',
			'tests/fixtures/http-parity/hono.ts',
			'tests/fixtures/http-parity/elysia.ts',
			'tests/fixtures/http-parity/vixeny.ts',
			'tests/fixtures/http-parity/vixeny-runtime.ts',
			'.artifacts/challengers/vixeny.mjs',
		]
	) {
		if (!metadata.inputs.baseline[name] || metadata.inputs.baseline[name] !== metadata.inputs.candidate[name]) {
			throw new Error(`Source pairs have different control inputs: ${name}`);
		}
	}
	if (!isDeepStrictEqual(await configuration(roots.baseline), await configuration(roots.candidate))) {
		throw new Error('Source pairs have different Deno runtime configuration.');
	}
	await save();
	for (let index = 0; index < 8; index++) {
		for (const variant of index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) {
			if (JSON.stringify(await identity(roots[variant])) !== JSON.stringify(metadata.inputs[variant])) {
				throw new Error('Source inputs changed before a trial.');
			}
			await trial(variant, index);
			if (JSON.stringify(await identity(roots[variant])) !== JSON.stringify(metadata.inputs[variant])) {
				throw new Error('Source inputs changed during a trial.');
			}
			console.log(`Recorded ${runtime} ${variant} pair ${index + 1}/8.`);
		}
	}
	const comparisons = [
		compareChallengers(workload, 'baseline Utils (candidate/baseline)', rows.candidate.utils, rows.baseline.utils),
		compareChallengers(workload, 'Hono control (candidate/baseline)', rows.candidate.hono, rows.baseline.hono),
		...challengerCandidates.filter((name) => name !== 'utils').map((name) =>
			compareChallengers(workload, challengerNames[name], rows.candidate.utils, rows.candidate[name])
		),
	];
	const adjustedNs = rows.candidate.utils.map((value, index) =>
		value * rows.baseline.hono[index] / rows.candidate.hono[index]
	);
	const adjusted = compareChallengers(workload, 'Hono-normalized source effect', adjustedNs, rows.baseline.utils);
	const normalized = {
		ratio: adjusted.ratio,
		interval95: adjusted.interval95,
		derivedCandidateNs: adjustedNs,
		method:
			'(candidate Utils/candidate Hono)/(baseline Utils/baseline Hono), paired by source pair. These derived nanoseconds are not observed times; a shared multiplicative host effect is an assumption.',
	};
	await writeFile(
		resolve(output, 'comparison.json'),
		`${JSON.stringify({ runtime, workload, comparisons, normalized, rows }, null, 2)}\n`,
	);
	metadata.status = 'pass';
} catch (error) {
	metadata.status = 'fail';
	metadata.failure = error.stack ?? String(error);
	throw error;
} finally {
	await save();
}
