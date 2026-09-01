/** Node.js subprocess adapter for {@link import('./mod.ts')}. */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { Readable, Writable } from 'node:stream';
import type { Adapter, SignalType, SpawnOptionsType, Spawned, StdioType } from './types.ts';

/**
 * Creates the Node.js subprocess adapter.
 *
 * The adapter only translates Node child-process primitives to Web streams and
 * normalized status. Lifecycle ownership remains in `@okikio/process`.
 */
export function create(): Adapter {
	const trees = process.platform === 'win32'
		? Object.freeze(['direct-child'] as const)
		: Object.freeze(['direct-child', 'posix-process-group'] as const);
	return Object.freeze({
		trees,
		signal: 'SIGTERM',
		forceSignal: 'SIGKILL',
		async spawn(options: SpawnOptionsType): Promise<Spawned> {
			const child = spawn(options.command, [...options.arguments], {
				detached: options.tree === 'posix-process-group',
				...(options.cwd === undefined ? {} : { cwd: options.cwd }),
				env: options.clearEnv ? { ...(options.env ?? {}) } : { ...process.env, ...(options.env ?? {}) },
				stdio: [stdio(options.stdin), stdio(options.stdout), stdio(options.stderr)],
			});

			let rejectStatus!: (reason: unknown) => void;
			const status = new Promise<Readonly<{ code: number; success: boolean; signal?: string }>>((resolve, reject) => {
				rejectStatus = reject;
				child.once('exit', (code, signal) => {
					const normalized = code ?? 128;
					resolve(Object.freeze({
						code: normalized,
						success: code === 0 && signal === null,
						...(signal === null ? {} : { signal }),
					}));
				});
			});

			await new Promise<void>((resolve, reject) => {
				const spawned = () => {
					child.removeListener('error', failed);
					child.once('error', rejectStatus);
					resolve();
				};
				const failed = (error: Error) => {
					child.removeListener('spawn', spawned);
					reject(error);
				};
				child.once('spawn', spawned);
				child.once('error', failed);
			});
			if (child.pid === undefined) throw new Error('Node child process spawned without a process ID.');
			// Capture the validated process identity once. Group ownership and late liveness
			// probes must not depend on a mutable child-process property after spawn.
			const pid = child.pid;

			return Object.freeze({
				pid,
				...(child.stdin === null ? {} : { stdin: Writable.toWeb(child.stdin) as WritableStream<Uint8Array> }),
				...(child.stdout === null
					? {}
					: { stdout: Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array> }),
				...(child.stderr === null
					? {}
					: { stderr: Readable.toWeb(child.stderr) as unknown as ReadableStream<Uint8Array> }),
				status,
				kill(signal: SignalType) {
					if (options.tree === 'posix-process-group') {
						// A detached POSIX child is the leader of a new process group. Signalling the
						// negative PID addresses that group, so descendants cannot outlive the owned tree.
						process.kill(-pid, signal as NodeJS.Signals | number);
						return;
					}
					child.kill(signal as NodeJS.Signals | number);
				},
				isGone(error: unknown) {
					return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
				},
				...(options.tree === 'posix-process-group'
					? {
						treeAlive() {
							try {
								process.kill(-pid, 0);
								return true;
							} catch (error) {
								if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') return false;
								throw error;
							}
						},
					}
					: {}),
			});
		},
	});
}

/** Maps generic stdio ownership to Node's spawn vocabulary. */
function stdio(value: StdioType): 'inherit' | 'ignore' | 'pipe' {
	if (value === 'inherit') return 'inherit';
	if (value === 'discard') return 'ignore';
	return 'pipe';
}
