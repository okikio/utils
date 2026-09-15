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
	SpawnOptionsType,
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

/** Process settings resolved before the runtime adapter is allowed to spawn. */
interface ResolvedStartOptions {
	/** Process-tree ownership guarantee the selected adapter must implement. */
	readonly tree: TreeModeType;
	/** Standard-input ownership translated to the adapter after public `null` semantics are resolved. */
	readonly stdin: 'inherit' | 'null' | 'piped';
	/** Standard-output ownership policy retained by the generic process owner. */
	readonly stdout: OutputModeType;
	/** Standard-error ownership policy retained by the generic process owner. */
	readonly stderr: OutputModeType;
}

/** Generic lifecycle owner for one process after a runtime adapter has spawned it. */
class Runtime {
	readonly #ctx: Context;
	readonly #adapter: Adapter;
	readonly #options: StartOptionsType;
	readonly #resolved: ResolvedStartOptions;
	readonly #child: Spawned;
	readonly #events = new EventBus<ProcessEventType>();
	readonly #captured: { stdout?: Uint8Array; stderr?: Uint8Array } = {};
	readonly #outputPumps: Promise<void>[] = [];
	readonly #ownsTree: boolean;
	#streamStdout: ReadableStream<Uint8Array> | undefined;
	#streamStderr: ReadableStream<Uint8Array> | undefined;
	#outputFailure: unknown;
	#hasOutputFailure = false;
	#stopPromise: Promise<void> | undefined;
	#exitPromise: Promise<ProcessExitType> | undefined;
	#terminal = false;
	#disposed = false;
	readonly process: Process;

	/** Parent cancellation requests process shutdown but does not synchronously throw into the signal handler. */
	readonly #abort = (): void => void this.#stop(this.#ctx.signal.reason).catch(() => {});

	constructor(
		ctx: Context,
		adapter: Adapter,
		options: StartOptionsType,
		resolved: ResolvedStartOptions,
		child: Spawned,
	) {
		this.#ctx = ctx;
		this.#adapter = adapter;
		this.#options = options;
		this.#resolved = resolved;
		this.#child = child;
		this.#ownsTree = resolved.tree !== 'direct-child';
		this.#events.emit(Object.freeze({ type: 'started', pid: child.pid }));
		this.#prepareOutput();

		this.process = Object.freeze({
			pid: child.pid,
			tree: resolved.tree,
			...(resolved.stdin === 'piped' ? { stdin: requireWritable(child) } : {}),
			...(this.#streamStdout === undefined ? {} : { stdout: this.#streamStdout }),
			...(this.#streamStderr === undefined ? {} : { stderr: this.#streamStderr }),
			events: this.#events.events,
			wait: () => this.#wait(),
			signal: (signal: SignalType) => void this.#send(signal),
			stop: (reason?: unknown) => this.#stop(reason),
			[Symbol.asyncDispose]: async () => await this.#dispose(),
		});

		ctx.signal.addEventListener('abort', this.#abort, { once: true });
		if (ctx.signal.aborted) this.#abort();
	}

	/** Attach streaming outputs directly and start owned capture or sink pumps. */
	#prepareOutput(): void {
		if (this.#resolved.stdout.type === 'stream') this.#streamStdout = requireReadable(this.#child, 'stdout');
		else if (this.#resolved.stdout.type === 'capture' || this.#resolved.stdout.type === 'sink') {
			this.#pumpOutput(requireReadable(this.#child, 'stdout'), this.#resolved.stdout, 'stdout');
		}

		if (this.#resolved.stderr.type === 'stream') this.#streamStderr = requireReadable(this.#child, 'stderr');
		else if (this.#resolved.stderr.type === 'capture' || this.#resolved.stderr.type === 'sink') {
			this.#pumpOutput(requireReadable(this.#child, 'stderr'), this.#resolved.stderr, 'stderr');
		}
	}

	/** Own one capture or sink pump and retain its failure for terminal `wait()` settlement. */
	#pumpOutput(
		stream: ReadableStream<Uint8Array>,
		mode: Extract<OutputModeType, Readonly<{ readonly type: 'capture' | 'sink' }>>,
		name: 'stdout' | 'stderr',
	): void {
		this.#outputPumps.push(
			this.#ownOutput(stream, mode, name).then((value) => {
				if (value !== undefined) this.#captured[name] = value;
			}).catch((error) => {
				this.#outputFailure = error;
				this.#hasOutputFailure = true;
			}),
		);
	}

	/** Memoize terminal process status and join every owned output pump before returning it. */
	#wait(): Promise<ProcessExitType> {
		this.#exitPromise ??= this.#completeExit();
		return this.#exitPromise;
	}

	/** Convert adapter status plus bounded captures into the stable public exit contract. */
	async #completeExit(): Promise<ProcessExitType> {
		const status = await this.#child.status;
		this.#terminal = true;
		this.#ctx.signal.removeEventListener('abort', this.#abort);
		await Promise.all(this.#outputPumps);
		if (this.#hasOutputFailure) throw this.#outputFailure;
		const exit = Object.freeze({
			code: status.code,
			success: status.success,
			...(status.signal === undefined ? {} : { signal: status.signal }),
			...(this.#captured.stdout === undefined ? {} : { stdout: this.#captured.stdout }),
			...(this.#captured.stderr === undefined ? {} : { stderr: this.#captured.stderr }),
		} satisfies ProcessExitType);
		this.#events.emit(Object.freeze({
			type: 'exited',
			code: status.code,
			success: status.success,
			...(status.signal === undefined ? {} : { signal: status.signal }),
		}));
		return exit;
	}

	/** Send one signal without treating root settlement as proof that an owned process group is empty. */
	#send(signal: SignalType): boolean {
		if (this.#terminal && !this.#ownsTree) return false;
		try {
			this.#child.kill(signal);
		} catch (error) {
			if (this.#child.isGone(error)) return false;
			throw error;
		}
		this.#events.emit(Object.freeze({ type: 'signal', signal }));
		return true;
	}

	/** Memoize graceful-to-forced shutdown so every owner observes one escalation sequence. */
	#stop(reason?: unknown): Promise<void> {
		this.#stopPromise ??= this.#stopProcess(reason);
		return this.#stopPromise;
	}

	/** Apply direct-child or process-group shutdown semantics after the first stop request. */
	async #stopProcess(reason: unknown): Promise<void> {
		if (this.#terminal && !this.#ownsTree) {
			await this.#wait();
			return;
		}
		this.#events.emit(Object.freeze({ type: 'stopping', ...(reason === undefined ? {} : { reason }) }));
		const shutdown = this.#options.shutdown ?? {};
		const gracefulSignal = shutdown.signal ?? this.#adapter.signal;
		const forceSignal = shutdown.forceSignal ?? this.#adapter.forceSignal;
		const graceMs = shutdown.graceMs ?? 10_000;
		const forceMs = shutdown.forceMs ?? 5_000;
		const graceful = this.#send(gracefulSignal);

		if (!this.#ownsTree) {
			await this.#stopDirectChild(graceful, forceSignal, graceMs, forceMs);
			return;
		}
		await this.#stopOwnedTree(graceful, forceSignal, graceMs, forceMs);
	}

	/** Stop a direct child once the root process itself reaches terminal status. */
	async #stopDirectChild(graceful: boolean, forceSignal: SignalType, graceMs: number, forceMs: number): Promise<void> {
		if (!graceful || await contextCore.settles(this.#wait(), graceMs)) return;
		this.#events.emit(Object.freeze({ type: 'forced' }));
		void this.#send(forceSignal);
		if (!await contextCore.settles(this.#wait(), forceMs)) throw new ProcessStopTimeoutError(this.#child.pid);
	}

	/** Stop an owned process group without confusing leader exit with group exit. */
	async #stopOwnedTree(graceful: boolean, forceSignal: SignalType, graceMs: number, forceMs: number): Promise<void> {
		// The group can outlive its leader. A liveness probe can end the grace
		// period early; without one, conservatively wait the full grace interval.
		if (!graceful && this.#child.treeAlive?.() === false) {
			await this.#wait();
			return;
		}
		if (this.#child.treeAlive !== undefined && await treeSettlesWithin(this.#child.treeAlive, graceMs)) {
			await this.#wait();
			return;
		}
		if (this.#child.treeAlive === undefined) await waitFor(graceMs);

		this.#events.emit(Object.freeze({ type: 'forced' }));
		void this.#send(forceSignal);
		if (this.#child.treeAlive !== undefined && !await treeSettlesWithin(this.#child.treeAlive, forceMs)) {
			throw new ProcessStopTimeoutError(this.#child.pid);
		}
		await this.#wait();
	}

	/** Dispose process ownership once and release parent cancellation plus local event observers. */
	async #dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		try {
			await this.#stop('Process handle was disposed.');
		} finally {
			this.#ctx.signal.removeEventListener('abort', this.#abort);
			this.#events[Symbol.dispose]();
		}
	}

	/**
	 * Drain one owned child-output stream according to its configured mode.
	 *
	 * Captured output remains bounded. Exceeding the bound initiates process
	 * shutdown before surfacing the output-limit failure to the owner.
	 */
	async #ownOutput(
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
					this.#events.emit(Object.freeze({ type: 'output-limit', stream: name, maximumBytes: mode.maximumBytes }));
					void this.#stop(new OutputLimitError(name, mode.maximumBytes)).catch(() => {});
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

/** Resolve and validate public process policy before a runtime adapter acquires resources. */
function resolveStart(adapter: Adapter, options: StartOptionsType): ResolvedStartOptions {
	if (options.command.trim().length === 0) throw new TypeError('Process command must not be empty.');
	const tree = options.tree ?? 'direct-child';
	if (!adapter.trees.includes(tree)) throw new UnsupportedTreeModeError(tree);
	const stdin = options.stdin ?? 'null';
	const stdout = options.stdout ?? { type: 'inherit' };
	const stderr = options.stderr ?? { type: 'inherit' };
	validateOutputMode(stdout, 'stdout');
	validateOutputMode(stderr, 'stderr');
	validateShutdown(options.shutdown);
	return Object.freeze({ tree, stdin, stdout, stderr });
}

/** Translate resolved generic ownership policy into the adapter's spawn contract. */
function spawnOptions(options: StartOptionsType, resolved: ResolvedStartOptions): SpawnOptionsType {
	return Object.freeze({
		command: options.command,
		arguments: Object.freeze([...(options.arguments ?? [])]),
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
		...(options.env === undefined ? {} : { env: Object.freeze({ ...options.env }) }),
		clearEnv: options.clearEnv ?? false,
		stdin: resolved.stdin === 'null' ? 'discard' : resolved.stdin,
		stdout: spawnMode(resolved.stdout),
		stderr: spawnMode(resolved.stderr),
		tree: resolved.tree,
	});
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
 * import * as process from '@utils/process';
 * import * as node from '@utils/process/node';
 *
 * const child = await process.start(ctx, node.create(), {
 * \tcommand: nodeProcess.execPath,
 * \targuments: ['--version'],
 * \tstdout: { type: 'capture', maximumBytes: 4096 },
 * });
 * const exit = await child.wait();
 * ```
 */
export async function start(ctx: Context, adapter: Adapter, options: StartOptionsType): Promise<Process> {
	contextCore.check(ctx);
	const resolved = resolveStart(adapter, options);
	const child = await adapter.spawn(spawnOptions(options, resolved));
	return new Runtime(ctx, adapter, options, resolved, child).process;
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
