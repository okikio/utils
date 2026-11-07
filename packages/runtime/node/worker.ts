/**
 * Node worker_threads adapter for the shared typed Worker request protocol.
 *
 * Node thread events and exit joining stay here. Schema validation, correlation,
 * cooperative pause/cancellation and cleanup receipts remain owned by Worker.
 * Importing this module starts no thread and attaches no parent-port listeners.
 * @module
 */
import { MessagePort, parentPort, Worker as Thread } from 'node:worker_threads';
import type { Transferable as NodeTransferable, WorkerOptions as ThreadOptions } from 'node:worker_threads';
import * as workers from '@okikio/worker/thread';
import type { Context } from '@okikio/context';
import { DisposableStack, dispose, SuppressedError } from '@okikio/dispose';
import type {
	RawWorker,
	RawWorkerScope,
	WorkerErrorEvent,
	WorkerHandle,
	WorkerMessageEvent,
	WorkerOpenOptions,
	WorkerServeOptions,
	WorkerServer,
	WorkerTransferable,
} from '@okikio/worker/thread';

/** Node execution controls added to the shared typed protocol options. */
export interface Options<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
	extends Omit<WorkerOpenOptions<Request, Response, Notice, CallRequest, CallResponse>, 'create'> {
	/** Explicit Node thread options, including execArgv, resource limits and environment. */
	readonly thread?: Omit<ThreadOptions, 'eval' | 'workerData' | 'transferList'>;
}

/** Unexpected thread exit, including a zero exit that abandoned the protocol owner. */
export class ThreadExitedError extends Error {
	/** Native exit code reported after the thread stopped. */
	readonly code: number;
	/** Record even a zero native exit as failure when it abandoned an active protocol owner. */
	constructor(code: number) {
		super(`Node thread exited before protocol shutdown (code ${code}).`);
		this.name = 'ThreadExitedError';
		this.code = code;
	}
}

/** Native message variants translated to the shared Worker surface. */
interface Events {
	message: Event & WorkerMessageEvent;
	messageerror: Event & WorkerMessageEvent;
	error: Event & WorkerErrorEvent;
}

/** Own a native thread, its event bridge and its asynchronous termination receipt. */
class NodeThread implements RawWorker {
	readonly #thread: Thread;
	readonly #events = new EventTarget();
	/** The first terminate call owns the native exit receipt; later callers join it. */
	#termination: Promise<void> | undefined;
	/** Set before requesting native termination so its exit is not reported as an unexpected fault. */
	#stopping = false;
	readonly #message = (value: unknown): void => {
		this.#events.dispatchEvent(new MessageEvent('message', { data: value }));
	};
	readonly #messageError = (error: Error): void => {
		this.#events.dispatchEvent(new MessageEvent('messageerror', { data: error }));
	};
	readonly #error = (error: unknown): void => {
		this.#events.dispatchEvent(faultEvent(error));
	};
	readonly #exit = (code: number): void => {
		if (!this.#stopping) this.#error(new ThreadExitedError(code));
	};

	constructor(module: URL, options: ThreadOptions) {
		this.#thread = new Thread(module, options);
		this.#thread.on('message', this.#message);
		this.#thread.on('messageerror', this.#messageError);
		this.#thread.on('error', this.#error);
		this.#thread.on('exit', this.#exit);
	}
	postMessage(value: unknown, transfer: readonly WorkerTransferable[] = []): void {
		this.#thread.postMessage(value, transfers(transfer));
	}
	/** Share one exit receipt; detach bridge listeners only after native termination settles. */
	terminate(): Promise<void> {
		this.#stopping = true;
		this.#termination ??= this.#thread.terminate().then(() => {
			this.#thread.off('message', this.#message);
			this.#thread.off('messageerror', this.#messageError);
			this.#thread.off('error', this.#error);
			this.#thread.off('exit', this.#exit);
		});
		return this.#termination;
	}
	addEventListener<Type extends keyof Events>(type: Type, listener: (event: Events[Type]) => void): void {
		this.#events.addEventListener(type, listener as EventListener);
	}
	removeEventListener<Type extends keyof Events>(type: Type, listener: (event: Events[Type]) => void): void {
		this.#events.removeEventListener(type, listener as EventListener);
	}
}

/**
 * Create a native Node thread for a caller that owns the shared Worker protocol.
 * Activity Worker providers can pass this factory through their `create` option.
 * The returned bridge owns its listeners and joins native termination; the
 * provider owns the resulting thread lifetime. Importing this module starts no
 * thread. Node-specific environment and resource limits remain explicit here.
 */
export function create(
	module: URL,
	options: Omit<ThreadOptions, 'eval' | 'workerData' | 'transferList'> = {},
): RawWorker {
	return new NodeThread(module, options);
}

/**
 * Open a Node thread with complete notice and reverse-call type inference.
 *
 * Node termination is asynchronous. The adapter awaits the native exit promise
 * before the shared protocol releases unfinished requests or a pool slot.
 */
export function open<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	ctx: Context,
	options: Options<Request, Response, Notice, CallRequest, CallResponse>,
): WorkerHandle<Request, Response> {
	return workers.open(ctx, {
		...options,
		create(module, selected) {
			return create(module, {
				...options.thread,
				...(selected.name === undefined ? {} : { name: selected.name }),
			});
		},
	});
}

/** Borrowed Node parent port with explicitly owned listener cleanup. */
export interface Scope extends RawWorkerScope, Disposable {}

/**
 * Adapt a selected MessagePort without closing or transferring its ownership.
 *
 * The default parentPort is read only when this function is called. Use serve()
 * for normal worker modules; it owns and disposes this bridge automatically.
 */
export function scope(port: MessagePort | null = parentPort): Scope {
	if (port === null) throw new TypeError('A Node worker scope requires a parent MessagePort.');
	const events = new EventTarget();
	const message = (value: unknown): void => {
		events.dispatchEvent(new MessageEvent('message', { data: value }));
	};
	const messageError = (error: Error): void => {
		events.dispatchEvent(new MessageEvent('messageerror', { data: error }));
	};
	// Each inverse is retained before Node or an embedding adapter can throw
	// after registration. Moving the stack transfers only listener ownership.
	using setup = new DisposableStack();
	setup.defer(() => port.off('message', message));
	port.on('message', message);
	setup.defer(() => port.off('messageerror', messageError));
	port.on('messageerror', messageError);
	const resources = setup.move();
	return Object.freeze({
		postMessage(value: unknown, transfer: readonly WorkerTransferable[] = []): void {
			if (resources.disposed) throw new ReferenceError('Node worker scope is closed.');
			port.postMessage(value, transfers(transfer));
		},
		addEventListener(type: 'message' | 'messageerror', listener: (event: Event & WorkerMessageEvent) => void): void {
			if (resources.disposed) throw new ReferenceError('Node worker scope is closed.');
			events.addEventListener(type, listener as EventListener);
		},
		removeEventListener(type: 'message' | 'messageerror', listener: (event: Event & WorkerMessageEvent) => void): void {
			events.removeEventListener(type, listener as EventListener);
		},
		[dispose](): void {
			resources.dispose();
		},
	});
}

/** Serve the shared protocol through Node's parent port and join its listener cleanup. */
export function serve<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	options: Omit<WorkerServeOptions<Request, Response, Notice, CallRequest, CallResponse>, 'scope'>,
): WorkerServer {
	const transport = scope();
	let server: WorkerServer;
	try {
		server = workers.serve({ ...options, scope: transport });
	} catch (error) {
		try {
			transport[dispose]();
		} catch (cleanup) {
			throw new SuppressedError(cleanup, error, 'Worker server setup and listener cleanup failed.');
		}
		throw error;
	}
	const closed = (async () => {
		using _bridge = transport;
		await server.closed;
	})();
	const stop = async (reason?: unknown): Promise<void> => {
		using _bridge = transport;
		await server.stop(reason);
	};
	return Object.freeze({ closed, stop, [Symbol.asyncDispose]: stop });
}

/** Copy the borrowed list; native Node postMessage validates support and performs the ownership transfer. */
function transfers(values: readonly WorkerTransferable[]): NodeTransferable[] {
	return [...values] as NodeTransferable[];
}

/** Node has Event and MessageEvent but does not require the browser ErrorEvent constructor. */
function faultEvent(error: unknown): Event & WorkerErrorEvent {
	return Object.assign(new Event('error'), {
		error,
		message: error instanceof Error ? error.message : String(error),
		filename: '',
		lineno: 0,
		colno: 0,
	});
}
