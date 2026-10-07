/** Record genuine JavaScriptCore CPU graphs for the existing qualified HTTP operations. */
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { profileReceipt } from './profile-startup.mjs';

const args = process.argv.slice(2);
for (const value of args) {
	if (value.startsWith('--') && !['--match=', '--duration='].some((prefix) => value.startsWith(prefix))) {
		throw new TypeError(`Unknown Bun profile option: ${value}.`);
	}
}
const positional = args.filter((value) => !value.startsWith('--'));
if (positional.length !== 1) throw new TypeError('Provide one Bun profile output directory.');
const output = resolve(positional[0]);
const match = args.find((value) => value.startsWith('--match='))?.slice(8) ?? 'challenger-';
const duration = args.find((value) => value.startsWith('--duration='))?.slice(11) ?? '3000';
if (!Number.isFinite(Number(duration)) || Number(duration) < 1) throw new TypeError('Invalid profile duration.');
const env = { ...process.env, NODE_DISABLE_COLORS: '1', NO_COLOR: '1' };
delete env.FORCE_COLOR;
// Never allow stale native graphs to satisfy a later capture.
await mkdir(resolve(output, '..'), { recursive: true });
await mkdir(output);
const files = process.env.UTILS_PROFILE_INPUTS
	? JSON.parse(await readFile(process.env.UTILS_PROFILE_INPUTS, 'utf8'))
	: execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
		.toString().split('\0').filter(Boolean);
for (const name of ['.artifacts/challengers/vixeny.mjs', '.artifacts/challengers/vixeny-build.json']) {
	if (!files.includes(name)) files.push(name);
}
const inputs = {};
for (const name of files.sort()) {
	if (!/\.(?:ts|mjs|jsonc?|yaml|toml)$/.test(name)) continue;
	try {
		inputs[name] = createHash('sha256').update(await readFile(name)).digest('hex');
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}
const workloads = JSON.parse(execFileSync('bun', ['bench/profile-http.ts', '--list'], { env, timeout: 120_000 }))
	.filter((value) => value.id.includes(match));
if (workloads.length === 0) throw new Error('No Bun profile operations match the selection.');
const coverage = {
	status: 'running',
	runtime: execFileSync('bun', ['--version'], { env }).toString().trim(),
	engine: 'JavaScriptCore',
	boundary:
		'Native CLI profiler includes process startup, construction, literal validation, warmup and gated warm dispatch.',
	limits:
		'Sampled JavaScriptCore stacks, not guaranteed active CPU attribution: native profiler idle-gap billing can affect deltas. Profiled elapsed values are diagnostic, not throughput estimates. No native HTTP listener.',
	inputs,
	resourceLimits: {},
	planned: workloads.flatMap((value) => value.candidates.map((candidate) => `${value.id}-${candidate}`)),
	completed: [],
};
for (const name of ['cpu.max', 'memory.max', 'cpu.stat', 'memory.events']) {
	try {
		coverage.resourceLimits[name] = (await readFile(`/sys/fs/cgroup/${name}`, 'utf8')).trim();
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}
const save = () => writeFile(`${output}/coverage.json`, `${JSON.stringify(coverage, null, 2)}\n`);

/** Gates exercise the same operations as V8; the CLI graph deliberately retains its broader process boundary. */
async function record(workload, candidate) {
	const id = `${workload.id}-${candidate}`;
	const command = [
		'--cpu-prof',
		'--cpu-prof-interval=100',
		`--cpu-prof-dir=${output}`,
		`--cpu-prof-name=${id}.cpuprofile`,
		'bench/profile-http.ts',
		workload.id,
		candidate,
		duration,
	];
	const child = spawn('bun', command, { env, stdio: ['pipe', 'pipe', 'pipe'] });
	let stderr = '', ready, done, failure;
	let bytes = 0;
	const stop = (error) => {
		failure ??= error;
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
	};
	const joined = new Promise((settle) => {
		child.once('error', (error) => failure ??= error);
		child.once('close', (code, signal) => settle({ code, signal }));
	});
	// A child can close its input between a gate and our reply. Own EPIPE like
	// other child failures so the close join and evidence writes still run.
	child.stdin.on('error', stop);
	const lines = [];
	child.stderr.on('data', (chunk) => {
		bytes += chunk.length;
		if (bytes > 8 * 1024 * 1024) stop(new Error('Profile child exceeded its output budget.'));
		else stderr += chunk;
	});
	// Count chunks before readline buffers them; a missing newline cannot bypass
	// the child's output bound. Stderr shares the same byte budget.
	child.stdout.on('data', (chunk) => {
		bytes += chunk.length;
		if (bytes > 8 * 1024 * 1024) stop(new Error('Profile child exceeded its output budget.'));
	});
	createInterface({ input: child.stdout }).on('line', (line) => {
		if (bytes > 8 * 1024 * 1024) {
			stop(new Error('Profile child exceeded its output budget.'));
			return;
		}
		lines.push(line);
		let value;
		try {
			value = JSON.parse(line);
		} catch {
			return;
		}
		if (value.phase === 'ready') {
			if (ready || done) {
				stop(new Error('Duplicate or out-of-order ready gate.'));
				return;
			}
			ready = value;
			child.stdin.write('start\n');
		} else if (value.phase === 'done') {
			if (!ready || done) {
				stop(new Error('Duplicate or out-of-order done gate.'));
				return;
			}
			done = value;
			child.stdin.end('stop\n');
		}
	});
	const watchdog = setTimeout(() => stop(new Error('Profile child exceeded its watchdog.')), 20 * 60_000);
	try {
		const terminal = await joined;
		if (failure) throw failure;
		if (terminal.code !== 0) throw new Error(`${id} exited ${terminal.code}/${terminal.signal}: ${stderr}`);
		if (
			!ready || !done || ready.id !== workload.id || ready.candidate !== candidate ||
			ready.runtime?.bun !== coverage.runtime ||
			!Number.isSafeInteger(ready.units) || ready.units < 1 || !Number.isSafeInteger(done.batches) ||
			done.batches < 1 ||
			done.units !== ready.units * done.batches || !Number.isFinite(done.elapsedMs) || done.elapsedMs <= 0
		) {
			throw new Error(`${id} did not qualify and identify a complete native Bun operation.`);
		}
		const graph = profileReceipt(JSON.parse(await readFile(`${output}/${id}.cpuprofile`, 'utf8')));
		const receipt = { id, command, ready, done, graph, boundary: coverage.boundary };
		await writeFile(`${output}/${id}.json`, `${JSON.stringify(receipt, null, 2)}\n`);
		coverage.completed.push(receipt);
		await save();
		console.log(`Recorded JavaScriptCore ${id}`);
	} finally {
		clearTimeout(watchdog);
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
		await joined;
		await writeFile(`${output}/${id}.stderr`, stderr);
		await writeFile(`${output}/${id}.stdout`, `${lines.join('\n')}\n`);
	}
}
try {
	for (const workload of workloads) for (const candidate of workload.candidates) await record(workload, candidate);
	for (const [name, hash] of Object.entries(inputs)) {
		if (createHash('sha256').update(await readFile(name)).digest('hex') !== hash) {
			throw new Error(`Profile input changed: ${name}`);
		}
	}
	coverage.status = 'pass';
} catch (error) {
	coverage.status = 'fail';
	coverage.failure = error.stack ?? String(error);
	throw error;
} finally {
	coverage.finishedAt = new Date().toISOString();
	await save();
}
