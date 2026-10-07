/** Profile the actual finite READY child, not the parent process orchestration. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseSync } from 'oxc-parser';
import { identity, policy, profileReceipt, root } from './profile-startup.mjs';

const arguments_ = process.argv.slice(2);
const option = (name) => arguments_.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const timeoutMs = Number(option('timeout') ?? 30_000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Watchdog must be a positive integer.');
const output = resolve(
	arguments_.find((argument) => !argument.startsWith('--')) ??
		resolve(root, `.artifacts/profile-process/${new Date().toISOString().replaceAll(':', '-')}`),
);
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const hosts = await readFile(resolve(root, 'bench/hosts.bench.ts'), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');

/** Read actual literal command inputs; comments, spacing and source quote styles are immaterial. */
function evalPrograms(source) {
	const parsed = parseSync('hosts.bench.ts', source);
	if (parsed.errors.length > 0) throw new SyntaxError(parsed.errors.map((error) => error.message).join('\n'));
	const namespace = new Set(), direct = new Set();
	for (const statement of parsed.program.body) {
		if (statement.type !== 'ImportDeclaration' || statement.source.value !== '@okikio/process') continue;
		for (const specifier of statement.specifiers) {
			if (specifier.type === 'ImportNamespaceSpecifier') namespace.add(specifier.local.name);
			if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'exec') direct.add(specifier.local.name);
		}
	}
	const found = { utils: [], raw: [] };
	const propertyName = (node) =>
		node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? node.value : undefined;
	function visit(node) {
		if (typeof node !== 'object' || node === null) return;
		const callee = node.callee;
		const owned = node.type === 'CallExpression' && (
			(callee?.type === 'Identifier' && direct.has(callee.name)) ||
			(callee?.type === 'MemberExpression' && namespace.has(callee.object?.name) &&
				propertyName(callee.property) === 'exec')
		);
		const raw = node.type === 'NewExpression' && callee?.type === 'MemberExpression' &&
			callee.object?.type === 'Identifier' && callee.object.name === 'Deno' &&
			propertyName(callee.property) === 'Command';
		if (owned || raw) {
			const options = node.arguments[owned ? 2 : 1];
			const field = options?.type === 'ObjectExpression'
				? options.properties.find((property) =>
					property.type === 'Property' && propertyName(property.key) === (owned ? 'arguments' : 'args')
				)?.value
				: undefined;
			if (
				field?.type !== 'ArrayExpression' ||
				field.elements.some((element) => element?.type !== 'Literal' || typeof element.value !== 'string')
			) {
				throw new Error('Host child arguments must be discoverable string array literals.');
			}
			const values = field.elements.map((element) => element.value);
			if (values.length !== 2 || values[0] !== 'eval' || values[1].trim().length === 0) {
				throw new Error(
					'Host child must provide one literal eval program; other invocation forms need an explicit diagnostic adapter.',
				);
			}
			found[owned ? 'utils' : 'raw'].push({
				arguments: values,
				program: values[1],
				sourceStart: node.start,
				sourceEnd: node.end,
			});
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) { for (const child of value) visit(child); }
			else if (value !== null && typeof value === 'object') visit(value);
		}
	}
	visit(parsed.program);
	if (found.utils.length !== 1 || found.raw.length !== 1) {
		throw new Error('Expected exactly one process.exec and one Deno.Command eval child.');
	}
	return Object.fromEntries(
		Object.entries(found).map(([variant, [entry]]) => [variant, { ...entry, programHash: hash(entry.program) }]),
	);
}
const programs = evalPrograms(hosts);

/** Diagnostic taps drain once, forward before exit, and join independently of the CPU sampling window. */
function workload(variant) {
	const program = programs[variant].program;
	return `
await import('@okikio/duration/polyfill');
await import('@okikio/dispose/polyfill');
const context = await import('@okikio/context');
const process = await import('@okikio/process');
const deno = await import('@okikio/process/deno');
const decoder = new TextDecoder();
const abort = new AbortController();
const control = Deno.stdin.readable.pipeThrough(new TextDecoderStream()).getReader();
const settled = promise => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
const commands = settled((async () => {
  let buffered = '';
  while (true) {
    const next = await control.read();
    if (next.done) return;
    buffered += next.value;
    if (buffered.length > 1024) throw new Error('Process control exceeded its budget.');
    while (buffered.includes('\\n')) {
      const end = buffered.indexOf('\\n'), command = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      if (command !== 'abort') throw new Error('Unexpected process control command.');
      abort.abort(new Error('Process profile controller stopped.'));
    }
  }
})());
const childArguments = ['eval', '--inspect-brk=127.0.0.1:0', ${JSON.stringify(program)}];
const pumps = [];
let child, childSettled = false, stopFailure;
const native = deno.create();
const stop = () => {
  if (child === undefined || childSettled) return;
  try { child.kill('SIGKILL'); }
  catch (error) { if (!child.isGone?.(error) && !(error instanceof Deno.errors.NotFound) && !(error instanceof TypeError && error.message === 'Child process has already terminated')) stopFailure = error; }
};
abort.signal.addEventListener('abort', stop);
async function forward(bytes, destination) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await destination.write(bytes.subarray(offset));
    if (written < 1) throw new Error('Diagnostic write made no progress.');
    offset += written;
  }
}
async function drain(stream, destination, maximumBytes, retain) {
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) { stop(); throw new Error('Diagnostic stream exceeded its budget.'); }
      if (retain) chunks.push(next.value);
      await forward(next.value, destination);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(retain ? length : 0);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
let primary, receipt, controlCleanup;
try {
  console.log(JSON.stringify({ phase: 'boot', variant: ${
		JSON.stringify(variant)
	}, runtime: Deno.version, parentPid: Deno.pid }));
  {
    await using owner = context.create({ id: 'profile-process-owner', signal: abort.signal });
${
		variant === 'utils'
			? `    const diagnostic = {
      ...native,
      async spawn(options) {
        child = await native.spawn({ ...options, stderr: 'piped' });
        const status = child.status.then(value => { childSettled = true; return value; });
        console.log(JSON.stringify({ phase: 'child', pid: child.pid, arguments: childArguments }));
        pumps.push(settled(drain(child.stderr, Deno.stderr, 1024 * 1024, false)));
        const stdout = child.stdout.pipeThrough(new TransformStream({ async transform(bytes, controller) {
          await forward(bytes, Deno.stdout); controller.enqueue(bytes);
        } }));
        // The owner still captures stdout with its real 1024-byte bound. Only
        // inspector stderr is independently drained by this diagnostic host.
        return { ...child, stdout, stderr: undefined, status };
      },
    };
    const exit = await process.exec(owner, diagnostic, {
      command: Deno.execPath(), arguments: childArguments,
      stdout: { type: 'capture', maximumBytes: 1024 }, stderr: { type: 'discard' },
    });
    receipt = { code: exit.code, success: exit.success, signal: exit.signal ?? null, stdout: decoder.decode(exit.stdout), captureMaximumBytes: 1024 };`
			: `    child = new Deno.Command(Deno.execPath(), { args: childArguments, stdin: 'null', stdout: 'piped', stderr: 'piped' }).spawn();
    const status = child.status.then(value => { childSettled = true; return value; });
    console.log(JSON.stringify({ phase: 'child', pid: child.pid, arguments: childArguments }));
    const stdout = settled(drain(child.stdout, Deno.stdout, 1024 * 1024, true));
    pumps.push(stdout);
    pumps.push(settled(drain(child.stderr, Deno.stderr, 1024 * 1024, false)));
    const exit = await status, captured = await stdout;
    if (captured.status === 'rejected') throw captured.reason;
    receipt = { code: exit.code, success: exit.success, signal: exit.signal ?? null, stdout: decoder.decode(captured.value), diagnosticMaximumBytes: 1024 * 1024 };`
	}
    for (const pump of pumps) { const result = await pump; if (result.status === 'rejected') throw result.reason; }
    if (!receipt.success || receipt.code !== 0 || receipt.signal !== null || receipt.stdout !== 'READY\\n') throw new Error('Child exit/output receipt changed.');
  }
} catch (reason) { primary = { reason }; }
finally {
  stop();
  if (child !== undefined) await settled(child.status);
  for (const pump of pumps) await pump;
  controlCleanup = await settled(control.cancel());
  abort.signal.removeEventListener('abort', stop);
}
const input = await commands;
if (primary !== undefined) throw primary.reason;
if (stopFailure !== undefined) throw stopFailure;
if (controlCleanup.status === 'rejected') throw controlCleanup.reason;
if (input.status === 'rejected') throw input.reason;
console.log(JSON.stringify({ phase: 'closed', joined: true, ownerClosed: true, childJoined: childSettled, receipt }));
`;
}

const metadata = {
	status: 'running',
	startedAt: new Date().toISOString(),
	controller: process.version,
	samplingIntervalUs: 100,
	programs,
	parser: 'oxc-parser@0.145.0 (root pinned development dependency)',
	benchmarkSource: 'bench/hosts.bench.ts',
	benchmarkSourceHash: hash(hosts),
	inputs: await identity(),
	scope:
		'Actual finite READY child JavaScript only: verified initial-script pause, profiler start, resume, forwarded READY, profiler stop, inspector disconnect, then joined child and parent. Native launch, pre-inspector startup and exit are excluded. Diagnostic stream forwarding and 100us sampling add overhead. This is not the parent orchestration profile or sustained process transport workload coverage, and elapsed values are not benchmark speed estimates.',
	completed: [],
};
const save = () => writeFile(resolve(output, 'coverage.json'), `${JSON.stringify(metadata, null, 2)}\n`);
await save();

async function record(variant) {
	const program = programs[variant].program;
	const directory = resolve(output, variant);
	await mkdir(directory);
	const source = workload(variant), filename = resolve(directory, 'workload.mjs');
	await writeFile(filename, source);
	const args = ['run', '--no-check', '-A', '--config', resolve(root, 'deno.jsonc'), filename];
	const row = {
		variant,
		input: programs[variant],
		status: 'running',
		command: { executable: 'deno', args, cwd: root },
		workloadHash: hash(source),
		diagnostic: variant === 'utils'
			? 'Production process.exec and Deno adapter, 1024-byte owner capture, stderr tap and stdout forwarding before capture completion, joined owner.'
			: 'Raw Deno.Command.spawn with joined status and diagnostic output drains; canonical benchmark uses Command.output. The eval program is identical. Drain taps replace output collection only to publish READY before exit, outside the child CPU realm.',
	};
	const child = spawn('deno', args, {
		cwd: root,
		env: policy,
		detached: process.platform !== 'win32',
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	let stdout = '', stderr = '', stdoutBytes = 0, stderrBytes = 0, failure, websocket, sequence = 0, stopped = false;
	const pending = new Map(), scripts = new Map(), events = new Map(), waiters = new Map();
	const stoppedGate = Promise.withResolvers();
	const terminal = new Promise((settle) => {
		child.once('error', (error) => fail(error));
		child.once('close', (code, signal) => settle({ code, signal }));
	});
	child.stdin.on('error', (error) => {
		row.controlFailure = error.stack ?? String(error);
		fail(error);
	});
	const watchdog = setTimeout(() => fail(new Error('READY child profile exceeded its watchdog.')), timeoutMs);
	function fail(error) {
		failure ??= error;
		if (!stopped) {
			stopped = true;
			stoppedGate.resolve();
		}
	}
	function emit(name, value) {
		const waiter = waiters.get(name);
		if (waiter !== undefined) {
			waiters.delete(name);
			waiter.resolve(value);
		} else events.set(name, value);
	}
	async function alive(promise) {
		return await Promise.race([
			promise,
			terminal.then((result) => {
				throw new Error(`Process parent closed ${result.code}/${result.signal} before its gate.`);
			}),
			stoppedGate.promise.then(() => {
				throw failure ?? new Error('Process profile stopped.');
			}),
		]);
	}
	function event(name) {
		if (events.has(name)) {
			const value = events.get(name);
			events.delete(name);
			return alive(Promise.resolve(value));
		}
		if (waiters.has(name)) throw new Error(`Repeated inspector gate: ${name}.`);
		const waiter = Promise.withResolvers();
		waiters.set(name, waiter);
		return alive(waiter.promise);
	}
	child.stdout.on('data', (chunk) => {
		stdoutBytes += chunk.byteLength;
		if (stdoutBytes > 1024 * 1024) {
			fail(new Error('Process parent stdout exceeded its budget.'));
			return;
		}
		stdout += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderrBytes += chunk.byteLength;
		if (stderrBytes > 1024 * 1024) {
			fail(new Error('Process parent stderr exceeded its budget.'));
			return;
		}
		stderr += chunk;
		const url = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/u)?.[0];
		if (url !== undefined && !row.inspectorUrl) {
			row.inspectorUrl = url;
			emit('inspector', url);
		}
	});
	const lines = createInterface({ input: child.stdout });
	lines.on('line', (line) => {
		if (line === 'READY') {
			emit('ready', line);
			return;
		}
		try {
			const value = JSON.parse(line);
			if (['boot', 'child', 'closed'].includes(value.phase)) emit(value.phase, value);
			else fail(new Error('Unexpected process parent stdout receipt.'));
		} catch (error) {
			fail(error);
		}
	});
	function disconnect() {
		for (const callback of pending.values()) callback.reject(new Error('Owned child inspector disconnected.'));
		pending.clear();
	}
	async function post(method, params = {}) {
		const id = ++sequence, result = Promise.withResolvers();
		pending.set(id, result);
		try {
			websocket.send(JSON.stringify({ id, method, params }));
		} catch (error) {
			pending.delete(id);
			result.reject(error);
		}
		return await alive(result.promise);
	}
	try {
		const boot = await event('boot'), actual = await event('child');
		if (boot.variant !== variant || !Number.isSafeInteger(actual.pid) || actual.pid === boot.parentPid) {
			throw new Error('Diagnostic parent did not identify an independent child process.');
		}
		row.runtime = boot.runtime;
		row.parentPid = boot.parentPid;
		row.childPid = actual.pid;
		row.childArguments = actual.arguments;
		websocket = new WebSocket(await event('inspector'));
		websocket.onmessage = ({ data }) => {
			try {
				const value = JSON.parse(data), callback = pending.get(value.id);
				if (callback !== undefined) {
					pending.delete(value.id);
					if (value.error) callback.reject(new Error(value.error.message));
					else callback.resolve(value.result);
				} else if (value.method === 'Debugger.scriptParsed') scripts.set(value.params.scriptId, value.params);
				else if (value.method === 'Debugger.paused') emit('paused', value.params);
			} catch (error) {
				fail(error);
				disconnect();
			}
		};
		websocket.onclose = disconnect;
		await alive(
			new Promise((settle, reject) => {
				websocket.onopen = settle;
				websocket.onerror = () => reject(new Error('Could not attach to the owned READY child.'));
			}),
		);
		await post('Debugger.enable');
		await post('Profiler.enable');
		await post('Profiler.setSamplingInterval', { interval: 100 });
		await post('Runtime.runIfWaitingForDebugger');
		const pause = await event('paused'), frame = pause.callFrames?.[0];
		if (frame?.location?.scriptId === undefined) throw new Error('Child did not pause in an initial script.');
		const sourceReceipt = await post('Debugger.getScriptSource', { scriptId: frame.location.scriptId });
		row.initialScriptSource = sourceReceipt.scriptSource;
		// Deno emits punctuation and source offsets. Compare executable AST data,
		// preserving calls and literal values while ignoring formatting metadata.
		const semantic = (text) => {
			const parsed = parseSync('eval.js', text);
			if (parsed.errors.length > 0) throw new Error('Inspector eval source could not be parsed.');
			return JSON.stringify(
				parsed.program,
				(key, value) => ['start', 'end', 'raw', 'loc', 'range'].includes(key) ? undefined : value,
			);
		};
		if (typeof sourceReceipt.scriptSource !== 'string' || semantic(sourceReceipt.scriptSource) !== semantic(program)) {
			throw new Error('Initial child script source did not match the actual host benchmark eval body.');
		}
		const evaluated = await post('Debugger.evaluateOnCallFrame', {
			callFrameId: frame.callFrameId,
			expression: 'JSON.stringify({ pid: Deno.pid, deno: Deno.version.deno, console: typeof console.log })',
			returnByValue: true,
		});
		if (evaluated.exceptionDetails || typeof evaluated.result?.value !== 'string') {
			throw new Error('Child realm verification failed.');
		}
		const realm = JSON.parse(evaluated.result.value);
		if (realm.pid !== actual.pid || realm.deno !== boot.runtime.deno || realm.console !== 'function') {
			throw new Error('Inspector did not evaluate in the independent READY child realm.');
		}
		row.realm = realm;
		row.initialPause = {
			reason: pause.reason,
			frame,
			script: scripts.get(frame.location.scriptId),
			sourceHash: hash(sourceReceipt.scriptSource),
		};
		await post('Profiler.start');
		await post('Debugger.resume');
		await event('ready');
		const { profile } = await post('Profiler.stop');
		await writeFile(resolve(directory, 'child.cpuprofile'), `${JSON.stringify(profile)}\n`);
		row.profile = profileReceipt(profile);
		// Source/realm proof identifies the actual child even when this tiny console
		// call receives no sample; keep that limitation visible instead of looping it.
		const ids = new Set(
			profile.nodes.filter((node) => node.callFrame?.scriptId === frame.location.scriptId).map((node) => node.id),
		);
		const samples = profile.samples.filter((id) => ids.has(id)).length;
		row.childCPU = {
			status: samples > 0 ? 'captured' : 'missing-child-frames',
			scriptSamples: samples,
			...(samples > 0 ? {} : {
				reason: 'The verified finite READY eval received no sampled eval-script frames. No extra work was injected.',
			}),
		};
		websocket.close();
		const closed = await event('closed');
		if (
			closed.joined !== true || closed.ownerClosed !== true || closed.childJoined !== true ||
			closed.receipt?.stdout !== 'READY\n' || closed.receipt.code !== 0 || closed.receipt.success !== true ||
			closed.receipt.signal !== null
		) {
			throw new Error('READY child lost its exact output, zero exit, or joined ownership receipt.');
		}
		if (variant === 'utils' && closed.receipt.captureMaximumBytes !== 1024) {
			throw new Error('Utils capture bound changed.');
		}
		row.receipt = closed;
		row.terminal = await terminal;
		if (failure !== undefined || row.terminal.code !== 0 || row.terminal.signal !== null) {
			throw failure ?? new Error('Diagnostic process parent failed.');
		}
		row.status = row.childCPU.status === 'captured' ? 'pass' : 'incomplete';
		return row;
	} catch (error) {
		row.status = 'fail';
		row.failure = error.stack ?? String(error);
		throw Object.assign(error, { receipt: row });
	} finally {
		clearTimeout(watchdog);
		websocket?.close();
		disconnect();
		if (child.exitCode === null && child.signalCode === null) child.stdin.end('abort\n');
		const grace = setTimeout(() => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			try {
				if (process.platform === 'win32') child.kill('SIGKILL');
				else process.kill(-child.pid, 'SIGKILL');
			} catch (error) {
				if (error.code !== 'ESRCH') row.cleanupFailure = error.stack ?? String(error);
			}
		}, 2000);
		row.terminal ??= await terminal;
		clearTimeout(grace);
		lines.close();
		child.stdin.destroy();
		for (const waiter of waiters.values()) waiter.resolve(undefined);
		waiters.clear();
		stoppedGate.resolve();
		await writeFile(resolve(directory, 'stdout.txt'), stdout);
		await writeFile(resolve(directory, 'stderr.txt'), stderr);
		await writeFile(resolve(directory, 'receipt.json'), `${JSON.stringify(row, null, 2)}\n`);
	}
}

try {
	for (const variant of ['utils', 'raw']) {
		try {
			metadata.completed.push(await record(variant));
		} catch (error) {
			if (error.receipt) metadata.completed.push(error.receipt);
			throw error;
		} finally {
			await save();
		}
	}
	metadata.inputsAfter = await identity();
	if (JSON.stringify(metadata.inputs) !== JSON.stringify(metadata.inputsAfter)) {
		throw new Error('Process profile source inputs changed.');
	}
	metadata.status = metadata.completed.every((row) => row.status === 'pass') ? 'pass' : 'incomplete';
	console.log(
		JSON.stringify({
			status: metadata.status,
			output,
			completed: metadata.completed.map(({ variant, status, childCPU }) => ({ variant, status, childCPU })),
		}),
	);
} catch (error) {
	metadata.status = 'fail';
	metadata.failure = error.stack ?? String(error);
	throw error;
} finally {
	metadata.finishedAt = new Date().toISOString();
	await save();
}
