/**
 * Runtime-neutral child-process ownership with bounded I/O and cancellation.
 *
 * Runtime adapters only create a child and translate platform streams, status,
 * and signals. This module owns the lifecycle after spawn so Node, Deno, and
 * future adapters cannot silently diverge on output limits or shutdown rules.
 *
 * @module
 */
import { EventBus } from '@okikio/observables';
import * as contextCore from '@okikio/context';
import type { Context } from '@okikio/context';

import type {
	Adapter,
	ProcessEventType,
	ExecOptionsType,
	ProcessExitType,
	OutputModeType,
	Process,
	SignalType,
	Spawned,
	StartOptionsType,
	StdioType,
	TreeModeType,
} from './types.ts';

/** Requested process-tree ownership mode is not implemented by the selected adapter. */
export class UnsupportedTreeModeError extends Error {
	readonly tree: TreeModeType;

	constructor(tree: TreeModeType) {
		super(`Process tree mode ${JSON.stringify(tree)} is not implemented by the selected runtime adapter.`);
		this.name = 'UnsupportedTreeModeError';
		this.tree = tree;
	}
}

/** Captured child output exceeded its configured byte limit. */
export class OutputLimitError extends Error {
	readonly stream: 'stdout' | 'stderr';
	readonly maximumBytes: number;

	constructor(stream: 'stdout' | 'stderr', maximumBytes: number) {
		super(`Child ${stream} exceeded its ${maximumBytes}-byte capture limit.`);
		this.name = 'OutputLimitError';
		this.stream = stream;
		this.maximumBytes = maximumBytes;
	}
}

/** Child process did not stop within the graceful and forced shutdown periods. */
export class ProcessStopTimeoutError extends Error {
	readonly pid: number;

	constructor(pid: number) {
		super(`Child process ${pid} did not stop within its shutdown policy.`);
		this.name = 'ProcessStopTimeoutError';
		this.pid = pid;
	}
}

/**
 * Starts one child through an explicit runtime adapter.
 *
 * The adapter finishes once the process has spawned. From that point the returned
 * handle owns output pumps, parent cancellation, graceful shutdown, forced
 * escalation, and final disposal. Keeping those rules here means a Node process
 * and a Deno process present the same lifecycle to higher-level libraries.
 *
 * @example
 * ```ts
 * import nodeProcess from 'node:process';
 * import * as process from '@okikio/process';
 * import * as node from '@okikio/process/node';
 *
 * const child = await process.start(ctx, node.create(), {
 * 	command: nodeProcess.execPath,
 * 	arguments: ['--version'],
 * 	stdout: { type: 'capture', maximumBytes: 4096 },
 * });
 * const exit = await child.wait();
 * ```
 */
export async function start(ctx: Context, adapter: Adapter, options: StartOptionsType): Promise<Process> {
	contextCore.check(ctx);
	if (options.command.trim().length === 0) throw new TypeError('Process command must not be empty.');
	const tree = options.tree ?? 'direct-child';
	if (!adapter.trees.includes(tree)) throw new UnsupportedTreeModeError(tree);
	const stdinMode = options.stdin ?? 'null';
	const stdoutMode = options.stdout ?? { type: 'inherit' };
	const stderrMode = options.stderr ?? { type: 'inherit' };
	validateOutputMode(stdoutMode, 'stdout');
	validateOutputMode(stderrMode, 'stderr');
	validateShutdown(options.shutdown);

	const child = await adapter.spawn({
		command: options.command,
		arguments: Object.freeze([...(options.arguments ?? [])]),
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
		...(options.env === undefined ? {} : { env: Object.freeze({ ...options.env }) }),
		clearEnv: options.clearEnv ?? false,
		stdin: stdinMode === 'null' ? 'discard' : stdinMode,
		stdout: spawnMode(stdoutMode),
		stderr: spawnMode(stderrMode),
		tree,
	});

	const events = new EventBus<ProcessEventType>();
	events.emit(Object.freeze({ type: 'started', pid: child.pid }));
	const captured: { stdout?: Uint8Array; stderr?: Uint8Array } = {};
	const outputPumps: Promise<void>[] = [];
	let streamStdout: ReadableStream<Uint8Array> | undefined;
	let streamStderr: ReadableStream<Uint8Array> | undefined;
	let outputFailure: unknown;
	let hasOutputFailure = false;

	if (stdoutMode.type === 'stream') streamStdout = requireReadable(child, 'stdout');
	else if (stdoutMode.type === 'capture' || stdoutMode.type === 'sink') {
		outputPumps.push(
			ownOutput(requireReadable(child, 'stdout'), stdoutMode, 'stdout').then((value) => {
				if (value !== undefined) captured.stdout = value;
			}).catch((error) => {
				outputFailure = error;
				hasOutputFailure = true;
			}),
		);
	}
	if (stderrMode.type === 'stream') streamStderr = requireReadable(child, 'stderr');
	else if (stderrMode.type === 'capture' || stderrMode.type === 'sink') {
		outputPumps.push(
			ownOutput(requireReadable(child, 'stderr'), stderrMode, 'stderr').then((value) => {
				if (value !== undefined) captured.stderr = value;
			}).catch((error) => {
				outputFailure = error;
				hasOutputFailure = true;
			}),
		);
	}

	let stopPromise: Promise<void> | undefined;
	let exitPromise: Promise<ProcessExitType> | undefined;
	let terminal = false;
	let disposed = false;
	let owned!: Process;
	const ownsTree = tree !== 'direct-child';
	const abort = () => void owned.stop(ctx.signal.reason).catch(() => {});

	/** Send one signal without treating root-process settlement as proof that an owned process group is empty. */
	const send = (signal: SignalType): boolean => {
		if (terminal && !ownsTree) return false;
		try {
			child.kill(signal);
		} catch (error) {
			if (child.isGone(error)) return false;
			throw error;
		}
		events.emit(Object.freeze({ type: 'signal', signal }));
		return true;
	};

	owned = Object.freeze({
		pid: child.pid,
		tree,
		...(stdinMode === 'piped' ? { stdin: requireWritable(child) } : {}),
		...(streamStdout === undefined ? {} : { stdout: streamStdout }),
		...(streamStderr === undefined ? {} : { stderr: streamStderr }),
		events: events.events,
		wait() {
			if (exitPromise !== undefined) return exitPromise;
			exitPromise = (async () => {
				const status = await child.status;
				terminal = true;
				ctx.signal.removeEventListener('abort', abort);
				await Promise.all(outputPumps);
				if (hasOutputFailure) throw outputFailure;
				const exit: ProcessExitType = Object.freeze({
					code: status.code,
					success: status.success,
					...(status.signal === undefined ? {} : { signal: status.signal }),
					...(captured.stdout === undefined ? {} : { stdout: captured.stdout }),
					...(captured.stderr === undefined ? {} : { stderr: captured.stderr }),
				});
				events.emit(Object.freeze({
					type: 'exited',
					code: status.code,
					success: status.success,
					...(status.signal === undefined ? {} : { signal: status.signal }),
				}));
				return exit;
			})();
			return exitPromise;
		},
		signal(signal: SignalType) {
			void send(signal);
		},
		stop(reason?: unknown) {
			if (stopPromise !== undefined) return stopPromise;
			stopPromise = (async () => {
				if (terminal && !ownsTree) {
					await owned.wait();
					return;
				}
				events.emit(Object.freeze({ type: 'stopping', ...(reason === undefined ? {} : { reason }) }));
				const shutdown = options.shutdown ?? {};
				const gracefulSignal = shutdown.signal ?? adapter.signal;
				const forceSignal = shutdown.forceSignal ?? adapter.forceSignal;
				const graceMs = shutdown.graceMs ?? 10_000;
				const forceMs = shutdown.forceMs ?? 5_000;

				const graceful = send(gracefulSignal);
				if (!ownsTree) {
					if (!graceful || await settlesWithin(owned.wait(), graceMs)) return;
					events.emit(Object.freeze({ type: 'forced' }));
					void send(forceSignal);
					if (!await settlesWithin(owned.wait(), forceMs)) throw new ProcessStopTimeoutError(child.pid);
					return;
				}

				// The group can outlive its leader. A runtime liveness probe lets us return
				// after graceful group exit; otherwise we conservatively wait the full grace
				// period and send the force signal to the group even if the leader already exited.
				if (!graceful && child.treeAlive?.() === false) {
					await owned.wait();
					return;
				}
				if (child.treeAlive !== undefined && await treeSettlesWithin(child.treeAlive, graceMs)) {
					await owned.wait();
					return;
				}
				if (child.treeAlive === undefined) await waitFor(graceMs);

				events.emit(Object.freeze({ type: 'forced' }));
				void send(forceSignal);
				if (child.treeAlive !== undefined && !await treeSettlesWithin(child.treeAlive, forceMs)) {
					throw new ProcessStopTimeoutError(child.pid);
				}
				await owned.wait();
			})();
			return stopPromise;
		},
		async [Symbol.asyncDispose]() {
			if (disposed) return;
			disposed = true;
			try {
				await owned.stop('Process handle was disposed.');
			} finally {
				ctx.signal.removeEventListener('abort', abort);
				events[Symbol.dispose]();
			}
		},
	});
	ctx.signal.addEventListener('abort', abort, { once: true });
	if (ctx.signal.aborted) abort();
	return owned;

	/**
	 * Drain one owned child-output stream according to its configured mode.
	 *
	 * Captured output remains bounded. Exceeding the bound initiates process
	 * shutdown before surfacing the output-limit failure to the owner.
	 */
	async function ownOutput(
		stream: ReadableStream<Uint8Array>,
		mode: Extract<OutputModeType, Readonly<{ readonly type: 'capture' | 'sink' }>>,
		name: 'stdout' | 'stderr',
	): Promise<Uint8Array | undefined> {
		if (mode.type === 'sink') {
			await stream.pipeTo(mode.write, { preventClose: true });
			return undefined;
		}
		const reader = stream.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		try {
			while (true) {
				const next = await reader.read();
				if (next.done) break;
				total += next.value.byteLength;
				if (total > mode.maximumBytes) {
					events.emit(Object.freeze({ type: 'output-limit', stream: name, maximumBytes: mode.maximumBytes }));
					void owned.stop(new OutputLimitError(name, mode.maximumBytes)).catch(() => {});
					throw new OutputLimitError(name, mode.maximumBytes);
				}
				chunks.push(next.value);
			}
			return concat(chunks, total);
		} finally {
			reader.releaseLock();
		}
	}
}

/** Runs one finite process and returns its terminal status and captured output. */
export async function exec(ctx: Context, adapter: Adapter, options: ExecOptionsType): Promise<ProcessExitType> {
	await using child = await start(ctx, adapter, options);
	if (options.input !== undefined) {
		if (child.stdin === undefined) throw new TypeError('Process input requires stdin: "piped".');
		const writer = child.stdin.getWriter();
		try {
			const bytes = typeof options.input === 'string' ? new TextEncoder().encode(options.input) : options.input;
			await writer.write(bytes);
			await writer.close();
		} finally {
			writer.releaseLock();
		}
	}
	return await child.wait();
}

/** Maps the public output policy to the stdio primitive requested from an adapter. */
function spawnMode(mode: OutputModeType): StdioType {
	if (mode.type === 'inherit') return 'inherit';
	if (mode.type === 'discard') return 'discard';
	return 'piped';
}

/** Rejects invalid capture limits before the runtime adapter starts a process. */
function validateOutputMode(mode: OutputModeType, name: string): void {
	if (mode.type === 'capture' && (!Number.isSafeInteger(mode.maximumBytes) || mode.maximumBytes < 1)) {
		throw new TypeError(`${name} capture maximumBytes must be a positive safe integer.`);
	}
}

/** Rejects timer values that cannot be represented safely by the host timer APIs. */
function validateShutdown(value: StartOptionsType['shutdown']): void {
	if (value === undefined) return;
	for (const [name, milliseconds] of [['graceMs', value.graceMs], ['forceMs', value.forceMs]] as const) {
		if (milliseconds !== undefined && (!Number.isSafeInteger(milliseconds) || milliseconds < 0)) {
			throw new TypeError(`${name} must be a non-negative safe integer.`);
		}
	}
}

/** Returns the requested piped child stream or reports an adapter contract violation. */
function requireReadable(child: Spawned, name: 'stdout' | 'stderr'): ReadableStream<Uint8Array> {
	const stream = child[name];
	if (stream === undefined) throw new TypeError(`Process adapter did not provide piped ${name}.`);
	return stream;
}

/** Returns the requested piped stdin or reports an adapter contract violation. */
function requireWritable(child: Spawned): WritableStream<Uint8Array> {
	if (child.stdin === undefined) throw new TypeError('Process adapter did not provide piped stdin.');
	return child.stdin;
}

/** Waits for a promise for at most the requested number of milliseconds. */
async function settlesWithin(value: Promise<unknown>, milliseconds: number): Promise<boolean> {
	if (milliseconds <= 0) return false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			value.then(() => true, () => true),
			new Promise<boolean>((resolve) => timer = setTimeout(() => resolve(false), milliseconds)),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/** Wait for a process-group liveness probe to report no members within one shutdown period. */
async function treeSettlesWithin(alive: () => boolean, milliseconds: number): Promise<boolean> {
	if (!alive()) return true;
	const deadline = Date.now() + Math.max(0, milliseconds);
	while (Date.now() < deadline) {
		await waitFor(Math.min(20, Math.max(1, deadline - Date.now())));
		if (!alive()) return true;
	}
	return !alive();
}

/** Wait for a shutdown interval without connecting it to caller cancellation. */
function waitFor(milliseconds: number): Promise<void> {
	if (milliseconds <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Concatenates already-bounded output chunks into the terminal capture buffer. */
function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

export type {
	TreeModeType,
	SignalType,
	OutputModeType,
	ShutdownPolicyType,
	StartOptionsType,
	StdioType,
	SpawnOptionsType,
	StatusType,
	Spawned,
	Adapter,
	ProcessEventType,
	ProcessExitType,
	Process,
	ExecOptionsType,
} from './types.ts';
