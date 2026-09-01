import type { EventBus } from '@okikio/observables';

/** Process-tree ownership guarantee implemented by the selected runtime adapter. */
export type TreeModeType = 'direct-child' | 'posix-process-group' | 'windows-process-tree' | 'windows-job-object';

/** Runtime signal accepted by the selected process adapter. */
export type SignalType =
	| 'SIGABRT'
	| 'SIGALRM'
	| 'SIGHUP'
	| 'SIGINFO'
	| 'SIGINT'
	| 'SIGKILL'
	| 'SIGPIPE'
	| 'SIGQUIT'
	| 'SIGSTOP'
	| 'SIGTERM'
	| 'SIGUSR1'
	| 'SIGUSR2'
	| 'SIGWINCH'
	| (string & {}) | number;

/** Explicit output ownership policy. */
export type OutputModeType =
	| Readonly<{ readonly type: 'inherit' }>
	| Readonly<{ readonly type: 'discard' }>
	| Readonly<{ readonly type: 'capture'; readonly maximumBytes: number }>
	| Readonly<{ readonly type: 'stream' }>
	| Readonly<{ readonly type: 'sink'; readonly write: WritableStream<Uint8Array> }>;

/** Graceful then forced shutdown policy in milliseconds. */
export interface ShutdownPolicyType {
	/** Abort signal controlling this shutdown policy local lifetime. */
	readonly signal?: SignalType;
	/** Signal used when graceful shutdown does not stop the owned process or process group. */
	readonly forceSignal?: SignalType;
	/** Grace period after the first shutdown request before forced termination. */
	readonly graceMs?: number;
	/** Maximum additional wait after forced termination before shutdown reports failure. */
	readonly forceMs?: number;
}

/** Inputs accepted while starting an operating-system process. */
export interface StartOptionsType {
	/** Executable path or command used to create the child process. */
	readonly command: string;
	/** Ordered command-line arguments passed to the child process. */
	readonly arguments?: readonly string[];
	/** Optional working directory inherited by the child process. */
	readonly cwd?: string | URL;
	/** Environment entries supplied to the child process. */
	readonly env?: Readonly<Record<string, string>>;
	/** Whether the child starts without inheriting the parent environment. */
	readonly clearEnv?: boolean;
	/** Writable standard-input stream borrowed from the owned child process. */
	readonly stdin?: 'inherit' | 'null' | 'piped';
	/** Readable standard-output stream used by the framed protocol. */
	readonly stdout?: OutputModeType;
	/** Standard-error stream reserved for bounded diagnostics outside the protocol. */
	readonly stderr?: OutputModeType;
	/** Requested direct-child or process-group ownership strength. */
	readonly tree?: TreeModeType;
	/** Graceful and forced shutdown policy owned by the returned Process. */
	readonly shutdown?: ShutdownPolicyType;
}

/** Stdio mode requested from one runtime adapter. */
export type StdioType = 'inherit' | 'discard' | 'piped';

/** Runtime-neutral process options after media-independent ownership policy is resolved. */
export interface SpawnOptionsType {
	/** Executable path or command translated by the runtime adapter. */
	readonly command: string;
	/** Ordered child arguments translated by the runtime adapter. */
	readonly arguments: readonly string[];
	/** Optional child working directory translated by the runtime adapter. */
	readonly cwd?: string | URL;
	/** Explicit environment entries translated by the runtime adapter. */
	readonly env?: Readonly<Record<string, string>>;
	/** Whether the runtime adapter clears inherited environment variables. */
	readonly clearEnv: boolean;
	/** Writable standard-input stream borrowed from the owned child process. */
	readonly stdin: StdioType;
	/** Readable standard-output stream used by the framed protocol. */
	readonly stdout: StdioType;
	/** Standard-error stream reserved for bounded diagnostics outside the protocol. */
	readonly stderr: StdioType;
	/** Process ownership mode the runtime adapter must provide or reject. */
	readonly tree: TreeModeType;
}

/** Terminal status returned by a runtime adapter. */
export interface StatusType {
	readonly code: number;
	readonly success: boolean;
	/** Abort signal controlling this status local lifetime. */
	readonly signal?: string;
}

/** Spawned runtime process used by the generic lifecycle owner. */
export interface Spawned {
	/** Operating-system process ID associated with this spawned. */
	readonly pid: number;
	/** Writable standard-input stream borrowed from the owned child process. */
	readonly stdin?: WritableStream<Uint8Array>;
	/** Readable standard-output stream used by the framed protocol. */
	readonly stdout?: ReadableStream<Uint8Array>;
	/** Standard-error stream reserved for bounded diagnostics outside the protocol. */
	readonly stderr?: ReadableStream<Uint8Array>;
	readonly status: Promise<StatusType>;
	/** Send one signal to the owned child or process group selected at spawn time. */
	kill(signal: SignalType): void;
	/** Return whether a signalling error means the owned child or group no longer exists. */
	isGone(error: unknown): boolean;
	/** Probe whether an owned process group still has live members when the runtime provides a side-effect-free probe. */
	treeAlive?(): boolean;
}

/** Runtime adapter that creates one process without owning its later lifecycle. */
export interface Adapter {
	readonly trees: readonly TreeModeType[];
	/** Abort signal controlling this adapter local lifetime. */
	readonly signal: SignalType;
	readonly forceSignal: SignalType;
	spawn(options: SpawnOptionsType): Promise<Spawned>;
}

/** Process lifecycle event. */
export type ProcessEventType =
	| Readonly<{ readonly type: 'started'; readonly pid: number }>
	| Readonly<{ readonly type: 'signal'; readonly signal: SignalType }>
	| Readonly<{ readonly type: 'stopping'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'forced' }>
	| Readonly<{ readonly type: 'exited'; readonly code: number; readonly success: boolean; readonly signal?: string }>
	| Readonly<{ readonly type: 'output-limit'; readonly stream: 'stdout' | 'stderr'; readonly maximumBytes: number }>;

/** Terminal process status and optionally captured output. */
export interface ProcessExitType {
	/** Platform exit code, or null when the process ended without a numeric exit code. */
	readonly code: number;
	/** Whether the process exit satisfies the runtime adapter success rule. */
	readonly success: boolean;
	/** Abort signal controlling this process exit local lifetime. */
	readonly signal?: string;
	/** Readable standard-output stream used by the framed protocol. */
	readonly stdout?: Uint8Array;
	/** Standard-error stream reserved for bounded diagnostics outside the protocol. */
	readonly stderr?: Uint8Array;
}

/** Owned child process. */
export interface Process extends AsyncDisposable {
	/** Operating-system process ID associated with this process. */
	readonly pid: number;
	readonly tree: TreeModeType;
	/** Writable standard-input stream borrowed from the owned child process. */
	readonly stdin?: WritableStream<Uint8Array>;
	/** Readable standard-output stream used by the framed protocol. */
	readonly stdout?: ReadableStream<Uint8Array>;
	/** Standard-error stream reserved for bounded diagnostics outside the protocol. */
	readonly stderr?: ReadableStream<Uint8Array>;
	/** Read-only observation stream for local process lifecycle changes. */
	readonly events: EventBus<ProcessEventType>['events'];
	wait(): Promise<ProcessExitType>;
	/** Abort signal controlling this process local lifetime. */
	signal(signal: SignalType): void;
	stop(reason?: unknown): Promise<void>;
}

/** Options accepted by the finite exec helper. */
export interface ExecOptionsType extends StartOptionsType {
	/** Optional bytes written to child stdin before the finite process execution waits for exit. */
	readonly input?: Uint8Array | string;
}
