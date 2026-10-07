/** Attach to the actual Deno Worker inspector session; parent CPU samples cannot stand in for worker evidence. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { identity, policy, profileReceipt, root } from './profile-startup.mjs';

const arguments_ = process.argv.slice(2);
const option = (name) => arguments_.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = option('phase') ?? 'warm';
if (!['warm', 'startup'].includes(phase)) throw new Error('Select --phase=warm or startup.');
const count = Number(option('count') ?? 10_000), timeoutMs = Number(option('timeout') ?? 120_000);
if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
	throw new Error('Worker count and watchdog must be positive integers.');
}
const output = resolve(
	arguments_.find((argument) => !argument.startsWith('--')) ??
		resolve(root, `.artifacts/profile-worker/${new Date().toISOString().replaceAll(':', '-')}`),
);
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const fixture = pathToFileURL(resolve(root, 'bench/fixtures/thread.ts')).href;

// This diagnostic parent uses the production worker owner and the unmodified
// fixture. It gates requests, but does not inject a profiler into the worker.
const workload = `
await import('@okikio/duration/polyfill');
await import('@okikio/dispose/polyfill');
const worker = await import('@okikio/worker');
const context = await import('@okikio/context');
const { z } = await import('zod');
const reader = Deno.stdin.readable.pipeThrough(new TextDecoderStream()).getReader();
let buffered = '';
async function gate(expected) {
  while (!buffered.includes('\\n')) {
    const next = await reader.read();
    if (next.done) throw new Error('Worker controller disconnected.');
    buffered += next.value;
  }
  const end = buffered.indexOf('\\n');
  const command = buffered.slice(0, end); buffered = buffered.slice(end + 1);
  if (command !== expected) throw new Error('Unexpected worker profile gate.');
}
console.log(JSON.stringify({ phase: 'boot', runtime: Deno.version, fixture: ${JSON.stringify(fixture)} }));
await gate('open');
{
  await using owner = context.create({ id: 'profile-worker-owner' });
  await using thread = worker.open(owner, {
    module: new URL(${JSON.stringify(fixture)}), name: 'utils-profile-thread',
    protocol: worker.protocol({ request: z.string(), response: z.string() }),
  });
  const first = await thread.request(owner, 'ready');
  if (first !== 'READY') throw new Error('The real Worker failed its validated echo preflight.');
  console.log(JSON.stringify({ phase: 'ready', first }));
${
	phase === 'warm'
		? `  await gate('start');
  let checksum = 0;
  for (let index = 0; index < ${count}; index++) {
    const result = await thread.request(owner, 'profile-' + index);
    if (result !== 'PROFILE-' + index) throw new Error('Worker request/result correlation changed.');
    checksum += result.length;
  }
  console.log(JSON.stringify({ phase: 'done', requests: ${count}, checksum }));`
		: ''
}
  await gate('stop');
}
await reader.cancel();
console.log(JSON.stringify({ phase: 'closed', joined: true }));
`;
await writeFile(resolve(output, 'workload.mjs'), workload);
const metadata = {
	status: 'running',
	startedAt: new Date().toISOString(),
	controller: process.version,
	samplingIntervalUs: 100,
	fixture,
	phase,
	requests: phase === 'startup' ? 1 : count,
	discovery: [],
	inputs: await identity(),
	workloadHash: createHash('sha256').update(workload).digest('hex'),
	scope: phase === 'startup'
		? 'Actual Worker isolate JavaScript initialization, from the verified waiting inspector target before resume through the first validated READY reply. Pre-inspector native Worker instantiation and acknowledged shutdown are excluded. Sampling adds overhead; elapsed values are not speed estimates.'
		: 'Worker isolate only, around real validated echo requests. Worker startup/preflight and acknowledged shutdown are excluded. Sampling adds overhead; elapsed values are not speed estimates.',
	workerCPU: { status: 'pending' },
};
const save = () => writeFile(resolve(output, 'coverage.json'), `${JSON.stringify(metadata, null, 2)}\n`);
await save();
const args = [
	'run',
	'--no-check',
	'--inspect=127.0.0.1:0',
	'-A',
	'--config',
	resolve(root, 'deno.jsonc'),
	resolve(output, 'workload.mjs'),
];
metadata.command = { executable: 'deno', args, cwd: root };
const child = spawn('deno', args, { cwd: root, env: policy, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '', stdout = '', websocket, failure, sequence = 0;
const rootPending = new Map(), workerPending = new Map();
const events = [], waiters = [];
let inspectorUrl, target;
const rootErrors = [];
const terminal = new Promise((settle) => {
	child.once('error', (error) => {
		failure ??= error.message;
	});
	child.once('close', (code, signal) => settle({ code, signal }));
});
const watchdog = setTimeout(() => {
	failure ??= 'Worker profile child exceeded its watchdog.';
	child.kill('SIGKILL');
}, timeoutMs);
child.stderr.on('data', (chunk) => {
	stderr += chunk;
	inspectorUrl ??= stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/u)?.[0];
	if (stderr.length > 8 * 1024 * 1024) {
		failure ??= 'Worker stderr exceeded its retained budget.';
		child.kill('SIGKILL');
	}
});
child.stdout.on('data', (chunk) => {
	stdout += chunk;
	if (stdout.length > 8 * 1024 * 1024) {
		failure ??= 'Worker stdout exceeded its retained budget.';
		child.kill('SIGKILL');
	}
});
const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
	let value;
	try {
		value = JSON.parse(line);
	} catch {
		return;
	}
	if (!['boot', 'ready', 'done', 'closed'].includes(value.phase)) return;
	if (waiters.length > 0) waiters.shift()(value);
	else events.push(value);
});

/** Every wait observes child termination; a disconnected target cannot leave an unresolved controller. */
async function whileAlive(promise, limit = timeoutMs) {
	let timer;
	try {
		return await Promise.race([
			promise,
			terminal.then((result) => {
				throw new Error(failure ?? `Worker child closed ${result.code}/${result.signal} before its gate completed.`);
			}),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('Inspector operation exceeded its deadline.')), limit);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
const event = () =>
	whileAlive(events.length ? Promise.resolve(events.shift()) : new Promise((settle) => waiters.push(settle)));

/** This inspector extension is used by pinned Deno's worker-session proxy, not a guessed main-thread target. */
async function post(method, params = {}) {
	const id = ++sequence;
	const response = new Promise((settle, reject) => rootPending.set(id, { settle, reject }));
	try {
		websocket.send(JSON.stringify({ id, method, params }));
	} catch (error) {
		rootPending.get(id).reject(error);
		rootPending.delete(id);
	}
	return await whileAlive(response);
}
async function workerPost(method, params = {}) {
	const id = ++sequence;
	const response = new Promise((settle, reject) => workerPending.set(id, { settle, reject }));
	const sent = post('NodeWorker.sendMessageToWorker', {
		sessionId: target.sessionId,
		message: JSON.stringify({ id, method, params }),
	});
	return (await whileAlive(Promise.all([sent, response])))[1];
}
function answer(pending, value) {
	const callback = pending.get(value.id);
	if (callback === undefined) return;
	pending.delete(value.id);
	if (value.error) callback.reject(Object.assign(new Error(value.error.message), { code: value.error.code }));
	else callback.settle(value.result);
}
function disconnect(reason) {
	for (const pending of [rootPending, workerPending]) {
		for (const callback of pending.values()) callback.reject(new Error(reason));
		pending.clear();
	}
}

try {
	const boot = await event();
	if (boot.phase !== 'boot' || boot.fixture !== fixture) {
		throw new Error('Worker parent did not provide its boot identity.');
	}
	metadata.runtime = boot.runtime;
	// Inspector publication normally precedes boot. Bound any delayed publication
	// instead of attaching to an arbitrary server discovered on the machine.
	await whileAlive(
		new Promise((settle) => {
			const inspect = () => {
				if (inspectorUrl !== undefined) settle(inspectorUrl);
				else if (child.exitCode === null && child.signalCode === null) setTimeout(inspect, 10);
			};
			inspect();
		}),
		5000,
	);
	websocket = new WebSocket(inspectorUrl);
	await whileAlive(
		new Promise((settle, reject) => {
			websocket.onopen = settle;
			websocket.onerror = () => reject(new Error('Could not connect to the owned Deno inspector.'));
		}),
	);
	websocket.onclose = () => disconnect('Owned inspector disconnected.');
	websocket.onmessage = ({ data }) => {
		try {
			const value = JSON.parse(data);
			if (value.id !== undefined) answer(rootPending, value);
			else if (value.method === 'NodeWorker.attachedToWorker') {
				metadata.discovery.push(value.params);
				if (value.params.workerInfo?.url === fixture) target = value.params;
			} else if (
				value.method === 'NodeWorker.receivedMessageFromWorker' && value.params.sessionId === target?.sessionId
			) {
				answer(workerPending, JSON.parse(value.params.message));
			}
		} catch (error) {
			rootErrors.push(error.message);
			disconnect('Malformed owned inspector protocol message.');
		}
	};
	try {
		await post('NodeWorker.enable', { waitForDebuggerOnStart: phase === 'startup' });
	} catch (error) {
		if (error.code !== -32601) throw error;
		metadata.workerCPU = {
			status: 'missing-worker-cpu',
			reason: 'Pinned runtime did not expose the NodeWorker inspector domain.',
			error: error.message,
		};
	}
	child.stdin.write('open\n');
	if (phase === 'warm') {
		const ready = await event();
		if (ready.phase !== 'ready' || ready.first !== 'READY') throw new Error('Real Worker request preflight failed.');
		metadata.preflight = ready;
	}
	if (metadata.workerCPU.status === 'pending') {
		const deadline = Date.now() + 5000;
		while (target === undefined && Date.now() < deadline) {
			await whileAlive(new Promise((settle) => setTimeout(settle, 20)), 1000);
		}
		if (target === undefined) {
			metadata.workerCPU = {
				status: 'missing-worker-cpu',
				reason: 'No inspector session identified the exact thread fixture URL.',
			};
		} else {
			metadata.target = target;
			if (phase === 'startup' && target.waitingForDebugger !== true) {
				throw new Error('Cold Worker target was not paused before JavaScript initialization.');
			}
			const evaluated = await workerPost('Runtime.evaluate', {
				expression:
					'JSON.stringify({ url: globalThis.location?.href, postMessage: typeof globalThis.postMessage, close: typeof globalThis.close })',
				returnByValue: true,
			});
			if (evaluated.exceptionDetails || typeof evaluated.result?.value !== 'string') {
				throw new Error('Worker realm verification failed.');
			}
			const realm = JSON.parse(evaluated.result.value);
			if (realm.url !== fixture || realm.postMessage !== 'function' || realm.close !== 'function') {
				throw new Error('Inspector session did not evaluate in the real Worker realm.');
			}
			metadata.realm = realm;
			await workerPost('Profiler.enable');
			await workerPost('Profiler.setSamplingInterval', { interval: 100 });
			await workerPost('Profiler.start');
			if (phase === 'startup') await workerPost('Runtime.runIfWaitingForDebugger');
		}
	}
	if (phase === 'warm') await save();
	if (phase === 'startup') {
		const ready = await event();
		if (ready.phase !== 'ready' || ready.first !== 'READY') {
			throw new Error('Cold Worker initialization lost its first validated READY receipt.');
		}
		metadata.preflight = ready;
		metadata.receipt = ready;
	} else {
		child.stdin.write('start\n');
		const done = await event();
		let expected = 0;
		for (let index = 0; index < count; index++) expected += `PROFILE-${index}`.length;
		if (done.phase !== 'done' || done.requests !== count || done.checksum !== expected) {
			throw new Error('Worker workload lost its complete request/result receipt.');
		}
		metadata.receipt = done;
	}
	if (metadata.workerCPU.status === 'pending') {
		const { profile } = await workerPost('Profiler.stop');
		await writeFile(
			resolve(output, phase === 'startup' ? 'worker-startup.cpuprofile' : 'worker.cpuprofile'),
			`${JSON.stringify(profile)}\n`,
		);
		const summary = profileReceipt(profile);
		const workerNodes = new Set(
			profile.nodes.filter((node) =>
				node.callFrame?.url === fixture || node.callFrame?.url?.includes('/packages/worker/')
			).map((node) => node.id),
		);
		const workerSamples = profile.samples.filter((id) => workerNodes.has(id)).length;
		metadata.workerCPU = {
			status: workerSamples > 0 ? 'captured' : 'missing-worker-cpu',
			...summary,
			workerSamples,
			...(workerSamples > 0
				? {}
				: { reason: 'The verified worker session produced no sampled fixture or worker-protocol frames.' }),
		};
	}
	child.stdin.end('stop\n');
	websocket.close();
	const closed = await event();
	if (closed.phase !== 'closed' || closed.joined !== true) throw new Error('Worker owner did not acknowledge cleanup.');
	const result = await terminal;
	metadata.terminal = result;
	if (failure || result.code !== 0 || rootErrors.length > 0) {
		throw new Error(failure ?? `Worker child failed: ${JSON.stringify(result)} ${rootErrors.join('; ')}`);
	}
	metadata.inputsAfter = await identity();
	if (JSON.stringify(metadata.inputs) !== JSON.stringify(metadata.inputsAfter)) {
		throw new Error('Worker profile source inputs changed.');
	}
	metadata.status = metadata.workerCPU.status === 'captured' ? 'pass' : 'incomplete';
	console.log(JSON.stringify({ status: metadata.status, workerCPU: metadata.workerCPU, output }));
} catch (error) {
	metadata.status = 'fail';
	metadata.failure = error.stack ?? String(error);
	throw error;
} finally {
	clearTimeout(watchdog);
	if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
	websocket?.close();
	disconnect('Worker profile controller stopped.');
	metadata.terminal ??= await terminal;
	lines.close();
	await writeFile(resolve(output, 'stdout.txt'), stdout);
	await writeFile(resolve(output, 'stderr.txt'), stderr);
	metadata.finishedAt = new Date().toISOString();
	await save();
}
