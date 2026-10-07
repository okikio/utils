/** Profile actual fresh import children; diagnostic CPU samples are separate from benchmark wall-time estimates. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '@std/jsonc';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const policy = { ...process.env, NODE_DISABLE_COLORS: '1', NO_COLOR: '1', FORCE_COLOR: '0' };

/** Own one bounded child, collect both streams, and always join its close event, including spawn and timeout failures. */
export async function capture(command, args, { cwd = root, timeoutMs = 120_000, maximumBytes = 8 * 1024 * 1024 } = {}) {
	const child = spawn(command, args, { cwd, env: policy, stdio: ['ignore', 'pipe', 'pipe'] });
	const stdout = [], stderr = [];
	let bytes = 0, failure;
	const stop = (message) => {
		failure ??= message;
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
	};
	for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) {
		stream.on('data', (chunk) => {
			bytes += chunk.length;
			if (bytes <= maximumBytes) chunks.push(chunk);
			else stop('Diagnostic child exceeded its retained output budget.');
		});
	}
	const timer = setTimeout(() => stop('Diagnostic child exceeded its watchdog.'), timeoutMs);
	const terminal = await new Promise((settle) => {
		child.once('error', (error) => {
			failure ??= error.message;
		});
		child.once('close', (code, signal) => settle({ code, signal }));
	});
	clearTimeout(timer);
	return {
		...terminal,
		stdout: Buffer.concat(stdout).toString('utf8'),
		stderr: Buffer.concat(stderr).toString('utf8'),
		...(failure === undefined ? {} : { failure }),
	};
}

/** Hash all repository runtime/profile inputs and the exact physical consumer, excluding generated evidence and links. */
export async function identity(consumer) {
	const inputs = new Map();
	async function add(path, label) {
		inputs.set(label, createHash('sha256').update(await readFile(path)).digest('hex'));
	}
	async function visit(directory, label, installed = false) {
		for (
			const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
		) {
			if (entry.isSymbolicLink() || ['.git', '.artifacts', '.agents', 'dist'].includes(entry.name) && !installed) {
				continue;
			}
			if (!installed && entry.name === 'node_modules') continue;
			const path = resolve(directory, entry.name), name = `${label}/${entry.name}`;
			if (entry.isDirectory()) await visit(path, name, installed);
			else if (entry.isFile() && (installed || /\.(?:ts|tsx|mjs|jsonc?|yaml|toml|txt)$/u.test(entry.name))) {
				await add(path, name);
			}
		}
	}
	for (const name of ['deno.jsonc', 'deno.lock', 'package.json', 'pnpm-lock.yaml', 'mise.toml']) {
		await add(resolve(root, name), name);
	}
	for (const name of ['packages', 'bench']) await visit(resolve(root, name), name);
	if (consumer !== undefined) {
		await visit(consumer, `consumer:${consumer}`, true);
		const archives = JSON.parse(await readFile(resolve(consumer, 'archives.json'), 'utf8'));
		if (
			!Array.isArray(archives) || archives.length === 0 ||
			archives.some((path) => typeof path !== 'string' || !isAbsolute(path))
		) {
			throw new Error('The clean consumer must retain exact absolute archive input paths.');
		}
		for (const path of archives) await add(path, `archive:${path}`);
	}
	return Object.fromEntries([...inputs].sort(([left], [right]) => left.localeCompare(right)));
}

/** Accept a real sample graph; retain raw deltas and classify suspicious deltas rather than silently rewriting evidence. */
export function profileReceipt(profile) {
	if (
		!Array.isArray(profile.nodes) || profile.nodes.length === 0 || !Array.isArray(profile.samples) ||
		profile.samples.length === 0 || !Array.isArray(profile.timeDeltas) ||
		profile.timeDeltas.length !== profile.samples.length || !Number.isFinite(profile.startTime) ||
		!Number.isFinite(profile.endTime) || profile.endTime <= profile.startTime ||
		profile.timeDeltas.some((value) => !Number.isFinite(value))
	) throw new Error('The child did not retain a complete nonempty CPU sample graph.');
	const ids = new Set(profile.nodes.map((node) => node.id));
	if (profile.samples.some((id) => !ids.has(id))) throw new Error('CPU samples refer to absent stack nodes.');
	return {
		samples: profile.samples.length,
		durationUs: profile.endTime - profile.startTime,
		negativeDeltas: profile.timeDeltas.filter((value) => value < 0).length,
	};
}

/** Refuse a repository-relative or linked npm consumer: ancestor workspace packages must not mask missing archives. */
async function consumerDirectory(argument) {
	const pointer = argument ??
		JSON.parse(await readFile(resolve(root, '.artifacts/npm/consumer-location.json'), 'utf8')).directory;
	if (typeof pointer !== 'string' || pointer.length === 0) {
		throw new Error('Run npm:verify before npm startup profiling.');
	}
	const directory = await realpath(resolve(pointer));
	const position = relative(root, directory);
	if (position === '' || (!position.startsWith('..') && !isAbsolute(position))) {
		throw new Error('The npm consumer must be physically outside the source workspace.');
	}
	return directory;
}

/** Expand the same package roots and import expressions used by the canonical benchmarks without preloading them. */
async function cases(section, consumer) {
	const planned = [];
	if (section !== 'npm') {
		const entries = [];
		for (const directory of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
			if (!directory.isDirectory()) continue;
			const manifest = parse(await readFile(resolve(root, 'packages', directory.name, 'deno.jsonc'), 'utf8'));
			if (typeof manifest.name !== 'string' || typeof manifest.exports?.['.'] !== 'string') {
				throw new Error(`Source package ${directory.name} has no named root export.`);
			}
			entries.push({
				name: manifest.name,
				module: pathToFileURL(resolve(root, 'packages', directory.name, manifest.exports['.'])).href,
			});
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		entries.push({ name: '@okikio/utils/all', module: pathToFileURL(resolve(root, 'packages/utils/all.ts')).href });
		for (const entry of [{ name: 'empty' }, ...entries]) planned.push({ ...entry, runtime: 'deno', format: 'esm' });
	}
	if (section !== 'source') {
		const paths = JSON.parse(await readFile(resolve(consumer, 'paths.json'), 'utf8'));
		if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
			throw new Error('Invalid clean-consumer export inventory.');
		}
		const roots = [...new Set(paths.filter((path) => /^@okikio\/[^/]+$/u.test(path)))].sort();
		if (!roots.includes('@okikio/utils')) throw new Error('Clean-consumer inventory has no umbrella root.');
		for (const name of roots) {
			const directory = resolve(consumer, 'node_modules', name);
			if ((await lstat(directory)).isSymbolicLink()) throw new Error(`Consumer package ${name} is linked.`);
			if (JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')).name !== name) {
				throw new Error(`Consumer package ${name} lost its installed identity.`);
			}
		}
		for (const format of ['esm', 'cjs']) {
			for (const name of ['empty', ...roots, '@okikio/utils/result', '@okikio/utils/all']) {
				if (name !== 'empty' && !paths.includes(name)) throw new Error(`Consumer inventory lacks ${name}.`);
				planned.push({ name, runtime: 'node', format });
			}
		}
	}
	return planned;
}

/** Start sampling before resuming the actual fixture's initial script pause; earlier native startup is outside this scope. */
async function inspectedImport(args, directory, timeoutMs) {
	const child = spawn('deno', args, { cwd: root, env: policy, stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '', stderr = '', failure, websocket, sequence = 0;
	let resolveUrl, resolveReceipt, resolvePause;
	const published = new Promise((settle) => {
		resolveUrl = settle;
	});
	const received = new Promise((settle) => {
		resolveReceipt = settle;
	});
	const paused = new Promise((settle) => {
		resolvePause = settle;
	});
	const pending = new Map();
	const scripts = new Map();
	const terminal = new Promise((settle) => {
		child.once('error', (error) => {
			failure ??= error.message;
		});
		child.once('close', (code, signal) => settle({ code, signal }));
	});
	const watchdog = setTimeout(() => {
		failure ??= 'Import inspector child exceeded its watchdog.';
		child.kill('SIGKILL');
	}, timeoutMs);
	const alive = (promise) =>
		Promise.race([
			promise,
			terminal.then((result) => {
				throw new Error(failure ?? `Inspected import closed ${result.code}/${result.signal} before its receipt.`);
			}),
		]);
	function disconnect() {
		for (const callback of pending.values()) callback.reject(new Error('Import inspector disconnected.'));
		pending.clear();
	}
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
		if (stdout.includes('\n')) resolveReceipt(stdout);
		if (stdout.length > 8 * 1024 * 1024) {
			failure ??= 'Import stdout exceeded its retained budget.';
			child.kill('SIGKILL');
		}
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
		const url = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/u)?.[0];
		if (url) resolveUrl(url);
		if (stderr.length > 8 * 1024 * 1024) {
			failure ??= 'Import stderr exceeded its retained budget.';
			child.kill('SIGKILL');
		}
	});
	async function post(method, params = {}) {
		const id = ++sequence;
		const response = new Promise((settle, reject) => pending.set(id, { settle, reject }));
		try {
			websocket.send(JSON.stringify({ id, method, params }));
		} catch (error) {
			pending.get(id).reject(error);
			pending.delete(id);
		}
		return await alive(response);
	}
	let pause;
	try {
		websocket = new WebSocket(await alive(published));
		await alive(
			new Promise((settle, reject) => {
				websocket.onopen = settle;
				websocket.onerror = () => reject(new Error('Could not attach to owned import inspector.'));
			}),
		);
		websocket.onclose = disconnect;
		websocket.onmessage = ({ data }) => {
			try {
				const value = JSON.parse(data), callback = pending.get(value.id);
				if (callback) {
					pending.delete(value.id);
					if (value.error) callback.reject(new Error(value.error.message));
					else callback.settle(value.result);
				} else if (value.method === 'Debugger.paused') resolvePause(value.params);
				else if (value.method === 'Debugger.scriptParsed') scripts.set(value.params.scriptId, value.params.url);
			} catch (error) {
				failure ??= error.message;
				disconnect();
				child.kill('SIGKILL');
			}
		};
		await post('Debugger.enable');
		await post('Profiler.enable');
		await post('Profiler.setSamplingInterval', { interval: 100 });
		await post('Runtime.runIfWaitingForDebugger');
		pause = await alive(paused);
		if (
			!pause.callFrames?.some((frame) =>
				(frame.url || scripts.get(frame.location?.scriptId)) ===
					pathToFileURL(resolve(root, 'bench/fixtures/import.ts')).href
			)
		) {
			throw new Error('Import inspector did not pause the actual source fixture.');
		}
		await post('Profiler.start');
		await post('Debugger.resume');
		await alive(received);
		const { profile } = await post('Profiler.stop');
		await writeFile(resolve(directory, 'startup.cpuprofile'), `${JSON.stringify(profile)}\n`);
		websocket.close();
		const result = await terminal;
		return { ...result, stdout, stderr, pause, ...(failure === undefined ? {} : { failure }) };
	} catch (error) {
		failure ??= error.stack ?? String(error);
		return { code: null, signal: null, stdout, stderr, pause, failure };
	} finally {
		clearTimeout(watchdog);
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
		websocket?.close();
		disconnect();
		await terminal;
		await writeFile(resolve(directory, 'stdout.txt'), stdout);
		await writeFile(resolve(directory, 'stderr.txt'), stderr);
	}
}

/** Each profile owns a fresh directory and an actual child, so a prior run cannot satisfy missing profile output. */
async function record(entry, index, output, consumer, timeoutMs, denoNative) {
	const directory = resolve(
		output,
		`${String(index).padStart(3, '0')}-${entry.runtime}-${entry.format}-${entry.name.replace(/[^a-z0-9_-]/giu, '_')}`,
	);
	await mkdir(directory);
	const flags = [
		'--cpu-prof',
		'--cpu-prof-interval=100',
		`--cpu-prof-dir=${directory}`,
		'--cpu-prof-name=startup.cpuprofile',
	];
	let command, args, cwd;
	if (entry.runtime === 'deno') {
		command = 'deno';
		cwd = root;
		args = [
			'run',
			'--no-check',
			...(denoNative ? flags : ['--inspect-brk=127.0.0.1:0']),
			'--allow-read',
			'--config',
			resolve(root, 'deno.jsonc'),
			resolve(root, 'bench/fixtures/import.ts'),
			...(entry.module === undefined ? [] : [entry.module]),
		];
	} else {
		command = process.execPath;
		cwd = consumer;
		const expression = entry.format === 'esm'
			? 'const value = process.argv[1] ? await import(process.argv[1]) : {}; process.stdout.write(JSON.stringify(Object.keys(value).length) + "\\n");'
			: 'const value = process.argv[1] ? require(process.argv[1]) : {}; process.stdout.write(JSON.stringify(Object.keys(value).length) + "\\n");';
		args = [
			...flags,
			`--input-type=${entry.format === 'esm' ? 'module' : 'commonjs'}`,
			'--eval',
			expression,
			...(entry.name === 'empty' ? [] : [entry.name]),
		];
	}
	const fallback = entry.runtime === 'deno' && !denoNative;
	const result = fallback
		? await inspectedImport(args, directory, timeoutMs)
		: await capture(command, args, { cwd, timeoutMs });
	await writeFile(resolve(directory, 'stdout.txt'), result.stdout);
	await writeFile(resolve(directory, 'stderr.txt'), result.stderr);
	const row = {
		...entry,
		command,
		args,
		cwd,
		terminal: result,
		status: 'fail',
		directory,
		scope: fallback
			? 'Actual fixture initial-script pause through dynamic-import receipt; pre-inspector native startup and final shutdown excluded.'
			: 'Native CLI V8 profiler start through child exit; application import and profiler shutdown included, not an operating-system CPU stack.',
	};
	try {
		if (result.failure || result.code !== 0) {
			throw new Error(result.failure ?? `Import child exited ${result.code}/${result.signal}.`);
		}
		const receipt = JSON.parse(result.stdout);
		const exports = entry.runtime === 'deno' ? receipt.exports : receipt;
		if (!Number.isSafeInteger(exports) || exports < 0 || (entry.name === 'empty' ? exports !== 0 : exports === 0)) {
			throw new Error('Fresh child lost runtime exports or its empty-child receipt.');
		}
		if (entry.runtime === 'deno' && (!Number.isFinite(receipt.milliseconds) || receipt.milliseconds < 0)) {
			throw new Error('Source child lost its finite import-duration receipt.');
		}
		row.receipt = receipt;
		row.profile = profileReceipt(JSON.parse(await readFile(resolve(directory, 'startup.cpuprofile'), 'utf8')));
		row.status = 'pass';
		return row;
	} catch (error) {
		row.failure = error.stack ?? String(error);
		throw Object.assign(error, { receipt: row });
	} finally {
		await writeFile(resolve(directory, 'receipt.json'), `${JSON.stringify(row, null, 2)}\n`);
	}
}

export async function main() {
	const arguments_ = process.argv.slice(2);
	const value = (name) => arguments_.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
	const section = value('section') ?? 'all', match = value('match');
	if (!['all', 'source', 'npm'].includes(section)) throw new Error('Select --section=all, source or npm.');
	const timeoutMs = Number(value('timeout') ?? 120_000);
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Watchdog must be a positive integer.');
	const output = resolve(
		arguments_.find((argument) => !argument.startsWith('--')) ??
			resolve(root, `.artifacts/profile-startup/${new Date().toISOString().replaceAll(':', '-')}`),
	);
	await mkdir(dirname(output), { recursive: true });
	await mkdir(output);
	const metadata = {
		status: 'running',
		startedAt: new Date().toISOString(),
		controller: process.version,
		samplingIntervalUs: 100,
		scope:
			'Actual fresh-child JavaScript import profiles. Each completed case scope defines its authoritative capture boundary: native CLI profiling or an initial-script inspector pause. Sampling perturbs elapsed time; these are not benchmark speed estimates. OS and dependency caches may be warm.',
		section,
		match,
		planned: [],
		completed: [],
		runtime: {},
		inputs: {},
	};
	const save = () => writeFile(resolve(output, 'coverage.json'), `${JSON.stringify(metadata, null, 2)}\n`);
	await save();
	let consumer;
	try {
		consumer = section === 'source' ? undefined : await consumerDirectory(value('consumer'));
		metadata.consumer = consumer;
		metadata.inputs = await identity(consumer);
		for (const [name, command, args] of [['deno', 'deno', ['--version']], ['node', process.execPath, ['--version']]]) {
			if (section === 'npm' && name === 'deno') continue;
			const version = await capture(command, args, { timeoutMs });
			if (version.failure || version.code !== 0) throw new Error(`Could not retain ${name} version.`);
			metadata.runtime[name] = version.stdout.trim();
		}
		let denoNative = false;
		if (section !== 'npm') {
			let help = await capture('deno', ['run', '--help=full'], { timeoutMs });
			if (help.failure) throw new Error(help.failure);
			if (help.code !== 0) {
				await writeFile(resolve(output, 'deno-full-help.stdout'), help.stdout);
				await writeFile(resolve(output, 'deno-full-help.stderr'), help.stderr);
				metadata.fullHelpUnavailable = { code: help.code, signal: help.signal };
				help = await capture('deno', ['run', '--help'], { timeoutMs });
			}
			if (help.failure || help.code !== 0) throw new Error('Could not retain pinned Deno CLI help.');
			await writeFile(resolve(output, 'deno-run-help.txt'), help.stdout);
			await writeFile(resolve(output, 'deno-run-help.stderr'), help.stderr);
			denoNative = ['--cpu-prof', '--cpu-prof-dir', '--cpu-prof-name', '--cpu-prof-interval'].every((flag) =>
				help.stdout.includes(flag)
			);
			metadata.denoProfiler = denoNative ? 'native-cli' : 'inspector-initial-script-fallback';
		}
		metadata.planned = (await cases(section, consumer)).filter((entry) =>
			match === undefined || `${entry.runtime}:${entry.format}:${entry.name}`.includes(match)
		);
		if (metadata.planned.length === 0) throw new Error('No startup profiles match the requested selection.');
		await save();
		for (const [index, entry] of metadata.planned.entries()) {
			try {
				metadata.completed.push(await record(entry, index, output, consumer, timeoutMs, denoNative));
			} catch (error) {
				if (error.receipt) metadata.completed.push(error.receipt);
				throw error;
			} finally {
				await save();
			}
			console.log(`Recorded startup ${entry.runtime}/${entry.format}/${entry.name}`);
		}
		metadata.inputsAfter = await identity(consumer);
		if (JSON.stringify(metadata.inputs) !== JSON.stringify(metadata.inputsAfter)) {
			throw new Error('Profile inputs changed during capture.');
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
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
