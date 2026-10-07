/** Record serial external-inspector profiles, immutable source identities and explicit coverage receipts. */
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { programs } from './suite.ts';
import { profileReceipt } from './profile-startup.mjs';

const arguments_ = process.argv.slice(2);
for (const argument of arguments_) {
	if (
		argument.startsWith('--') && !['--npm', '--list'].includes(argument) &&
		!['--section=', '--match=', '--candidate=', '--duration=', '--runtime='].some((prefix) =>
			argument.startsWith(prefix)
		)
	) {
		throw new TypeError(`Unknown profile option: ${argument}.`);
	}
}
const positional = arguments_.filter((value) => !value.startsWith('--'));
if (positional.length > 1) throw new TypeError('Provide one profile output directory.');
const output = resolve(positional[0] ?? `.artifacts/profile/${new Date().toISOString().replaceAll(':', '-')}`);
const selector = arguments_.find((value) => value.startsWith('--section='))?.slice(10);
const filter = arguments_.find((value) => value.startsWith('--match='))?.slice(8);
const candidateFilter = arguments_.find((value) => value.startsWith('--candidate='))?.slice(12);
const duration = arguments_.find((value) => value.startsWith('--duration='))?.slice(11) ?? '400';
const runtime = arguments_.find((value) => value.startsWith('--runtime='))?.slice(10) ?? 'deno';
if (selector !== undefined && !['http', 'suite'].includes(selector)) {
	throw new TypeError('Select --section=http or suite.');
}
if (!['deno', 'node'].includes(runtime)) throw new TypeError('Select --runtime=deno or node.');
if (
	candidateFilter !== undefined &&
	(!['utils', 'hono', 'elysia', 'vixeny'].includes(candidateFilter) || selector !== 'http')
) {
	throw new TypeError('Candidate selection requires --section=http and an exact fixture candidate.');
}
if (runtime === 'node' && selector !== 'http') {
	throw new TypeError(
		'Native Node profiling requires --section=http. The benchmark suite uses Deno-only host fixtures.',
	);
}
if (arguments_.includes('--npm') && (runtime === 'node' || selector === 'http')) {
	throw new TypeError('--npm selects a Deno suite program; use profile-startup.mjs for native npm import children.');
}
if (!Number.isFinite(Number(duration)) || Number(duration) < 1) throw new TypeError('Invalid profile duration.');

/** List the selected runtime's same fixture IDs without starting an inspector or writing a profile result. */
if (arguments_.includes('--list')) {
	if (selector !== 'http') throw new TypeError('Profile listing requires --section=http.');
	const environment = { ...process.env, NODE_DISABLE_COLORS: '1', NO_COLOR: '1' };
	delete environment.FORCE_COLOR;
	const executable = runtime === 'node' ? process.execPath : 'deno';
	const args = runtime === 'node'
		? ['bench/profile-http.ts', '--list']
		: ['run', '--no-check', '-A', 'bench/profile-http.ts', '--list'];
	const list = select(JSON.parse(execFileSync(executable, args, { env: environment, timeout: 120_000 }).toString()));
	await new Promise((settle, reject) => {
		process.stdout.write(`${JSON.stringify(list)}\n`, (error) => error ? reject(error) : settle());
	});
	process.exit(0);
}
// An earlier graph must not satisfy a later capture after its child fails.
await mkdir(resolve(output, '..'), { recursive: true });
await mkdir(output);
// An isolated source projection has no Git database. Its copier supplies the
// exact Git-visible manifest; ordinary checkouts discover that manifest directly.
const sources = process.env.UTILS_PROFILE_INPUTS
	? JSON.parse(await readFile(process.env.UTILS_PROFILE_INPUTS, 'utf8'))
	: execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
		.toString().split('\0').filter(Boolean);
const hashes = {};
for (const name of sources.sort()) {
	if (!/\.(?:ts|mjs|jsonc?|yaml|toml)$/.test(name)) continue;
	try {
		hashes[name] = createHash('sha256').update(await readFile(name)).digest('hex');
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}
// The portable Vixeny candidate loads a verified emitted archive projection.
// Its bytes and build receipt are inputs even though .artifacts is Git-ignored.
const challengerArtifacts = ['.artifacts/challengers/vixeny.mjs', '.artifacts/challengers/vixeny-build.json'];
for (const name of challengerArtifacts) {
	try {
		hashes[name] = createHash('sha256').update(await readFile(name)).digest('hex');
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}
const metadata = {
	status: 'running',
	controller: process.version,
	workloadRuntime: runtime,
	workloadVersions: undefined,
	samplingIntervalUs: 100,
	startedAt: new Date().toISOString(),
	inputs: hashes,
	resourceLimits: {},
	planned: [],
	completed: [],
	failure: undefined,
};
for (const name of ['cpu.max', 'memory.max', 'cpu.stat', 'memory.events']) {
	try {
		metadata.resourceLimits[name] = (await readFile(`/sys/fs/cgroup/${name}`, 'utf8')).trim();
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}
async function save() {
	await writeFile(`${output}/coverage.json`, JSON.stringify(metadata, null, 2));
}
const policy = { ...process.env, NODE_DISABLE_COLORS: '1', NO_COLOR: '1' };
delete policy.FORCE_COLOR;

/** Filter explicit capability membership; a challenger never falls back to a paired fixture. */
function select(list) {
	return list.filter((workload) => !filter || workload.id.includes(filter)).map((workload) => ({
		...workload,
		candidates: workload.candidates.filter((candidate) =>
			candidateFilter === undefined || candidate === candidateFilter
		),
	})).filter((workload) => workload.candidates.length > 0);
}

/** Join the diagnostic child on every path; a timeout cannot leave a profiler or worker owner running. */
async function record(id, args) {
	if (
		(args[0].includes('http-challengers.bench.ts') ||
			args[0] === 'bench/profile-http.ts' && args[1].startsWith('challenger-')) &&
		challengerArtifacts.some((name) => hashes[name] === undefined)
	) throw new Error('Prepare the portable challenger artifact and build receipt before profiling challengers.');
	const executable = runtime === 'node' ? process.execPath : 'deno';
	const launch = runtime === 'node'
		? ['--inspect=127.0.0.1:0', '--expose-gc', ...args]
		: ['run', '--no-check', '--v8-flags=--expose-gc', '--inspect=127.0.0.1:0', '-A', ...args];
	const child = spawn(executable, launch, {
		stdio: ['pipe', 'pipe', 'pipe'],
		env: policy,
	});
	let stderr = '', websocket, sequence = 0, sample, ready;
	const pending = new Map();
	let resolveUrl;
	const url = new Promise((resolve) => {
		resolveUrl = resolve;
	});
	let rejectExit;
	const failed = new Promise((_, reject) => {
		rejectExit = reject;
	});
	failed.catch(() => {});
	const joined = new Promise((resolve, reject) => {
		child.on('error', (error) => {
			rejectExit(error);
			reject(error);
		});
		// close also joins stdout/stderr, retaining the child's final diagnostics.
		child.on('close', (code, signal) => {
			if (code === 0) resolve();
			else {
				const error = new Error(`${id} exited ${code}/${signal}: ${stderr}`);
				rejectExit(error);
				reject(error);
			}
		});
	});
	joined.catch(() => {});
	child.stdin.on('error', (error) => {
		rejectExit(error);
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
	});
	const watchdog = setTimeout(() => child.kill('SIGKILL'), 20 * 60_000);
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
		const found = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/);
		if (found) resolveUrl(found[0]);
	});
	const messages = [], waiters = [];
	createInterface({ input: child.stdout }).on('line', (line) => {
		let value;
		try {
			value = JSON.parse(line);
		} catch {
			return;
		}
		if (!['ready', 'done', 'finished'].includes(value.phase)) return;
		if (waiters.length) waiters.shift()(value);
		else messages.push(value);
	});
	const next = () =>
		Promise.race([
			messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve) => waiters.push(resolve)),
			failed,
		]);
	function post(method, params = {}) {
		return Promise.race([
			new Promise((resolve, reject) => {
				const id = ++sequence;
				pending.set(id, { resolve, reject });
				websocket.send(JSON.stringify({ id, method, params }));
			}),
			failed,
		]);
	}
	try {
		websocket = new WebSocket(await Promise.race([url, failed]));
		await Promise.race([
			new Promise((resolve, reject) => {
				websocket.onopen = resolve;
				websocket.onerror = reject;
			}),
			failed,
		]);
		websocket.onmessage = ({ data }) => {
			const value = JSON.parse(data), callback = pending.get(value.id);
			if (callback) {
				pending.delete(value.id);
				value.error ? callback.reject(new Error(JSON.stringify(value.error))) : callback.resolve(value.result);
			}
		};
		websocket.onclose = () => {
			for (const callback of pending.values()) callback.reject(new Error('Inspector disconnected.'));
			pending.clear();
		};
		await post('Profiler.enable');
		await post('Profiler.setSamplingInterval', { interval: 100 });
		let trial = 0;
		while (true) {
			const event = await Promise.race([next(), joined.then(() => undefined)]);
			if (event === undefined) break;
			if (event.phase === 'finished') {
				child.stdin.end();
				websocket.close();
				await joined;
				break;
			}
			if (event.phase !== 'ready') throw new Error('Missing ready gate.');
			ready = event;
			if (runtime === 'node' ? typeof ready.runtime?.node !== 'string' : typeof ready.runtime?.deno !== 'string') {
				throw new Error('Profile child did not identify the selected native workload runtime.');
			}
			metadata.workloadVersions ??= ready.runtime;
			if (JSON.stringify(metadata.workloadVersions) !== JSON.stringify(ready.runtime)) {
				throw new Error('Profile workload runtime changed between children.');
			}
			await post('Profiler.start');
			child.stdin.write('start\n');
			const done = await next();
			if (done.phase !== 'done') throw new Error('Missing done gate.');
			const { profile } = await post('Profiler.stop');
			const graph = profileReceipt(profile);
			sample = `${id}-${trial++}`;
			await writeFile(`${output}/${sample}.cpuprofile`, JSON.stringify(profile));
			await writeFile(
				`${output}/${sample}.json`,
				JSON.stringify(
					{
						ready,
						done,
						scope:
							'CPU attribution includes sampling and gate scheduling; elapsed values are diagnostic, not benchmark estimates.',
					},
					null,
					2,
				),
			);
			metadata.completed.push({
				id,
				sample,
				runtime,
				command: { executable, args: launch },
				ready,
				graph,
				result: done.result
					? {
						alias: done.result.alias,
						args: done.result.args,
						runs: done.result.runs.map(({ name, args, error }) => ({
							name,
							args,
							...(error === undefined ? {} : { error }),
						})),
					}
					: { units: done.units, batches: done.batches },
			});
			await save();
			if (args[0] === 'bench/profile-http.ts') {
				child.stdin.end('stop\n');
				websocket.close();
				await joined;
				break;
			}
			child.stdin.write('stop\n');
		}
		await joined;
	} finally {
		clearTimeout(watchdog);
		if (child.exitCode === null) child.kill('SIGKILL');
		websocket?.close();
		await joined.catch(() => {});
		await writeFile(`${output}/${id}.stderr`, stderr);
	}
}
try {
	if (selector === undefined || selector === 'http') {
		const executable = runtime === 'node' ? process.execPath : 'deno';
		const args = runtime === 'node'
			? ['bench/profile-http.ts', '--list']
			: ['run', '--no-check', '-A', 'bench/profile-http.ts', '--list'];
		const list = select(JSON.parse(
			execFileSync(executable, args, { env: policy }).toString(),
		));
		for (const workload of list) {
			if (filter && !workload.id.includes(filter)) continue;
			for (const candidate of workload.candidates) {
				const id = `${workload.id}-${candidate}`;
				metadata.planned.push({ ...workload, id, candidate, runtime });
				await save();
				await record(id, ['bench/profile-http.ts', workload.id, candidate, duration]);
				console.log(`Recorded ${id}`);
			}
		}
	}
	if (selector === undefined || selector === 'suite') {
		const selected = [...programs, ...(process.argv.includes('--npm') ? ['./npm-imports.bench.ts'] : [])];
		for (const [index, program] of selected.entries()) {
			if (filter && !program.includes(filter)) continue;
			const id = `program-${index}`;
			metadata.planned.push({ id, program });
			await save();
			await record(id, [new URL(program, import.meta.url).pathname, '--profile']);
			console.log(`Recorded ${program}`);
		}
	}
	if (metadata.completed.length === 0) throw new Error('No profiles match the requested selection.');
	for (const [name, hash] of Object.entries(hashes)) {
		if (createHash('sha256').update(await readFile(name)).digest('hex') !== hash) {
			throw new Error(`Profile input changed: ${name}`);
		}
	}
	metadata.status = 'pass';
} catch (error) {
	metadata.status = 'fail';
	metadata.failure = error.stack ?? String(error);
	throw error;
} finally {
	metadata.finishedAt = new Date().toISOString();
	await save();
}
