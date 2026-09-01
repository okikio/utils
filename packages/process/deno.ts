/** Deno subprocess adapter for {@link import('./mod.ts')}. */
import type { Adapter, SignalType, SpawnOptionsType, Spawned, StdioType } from './types.ts';

/**
 * Creates the Deno subprocess adapter.
 *
 * Importing this module does not start a process. `Deno.Command` is resolved only
 * when the generic process owner asks the adapter to spawn one child.
 */
export function create(): Adapter {
	const trees = Deno.build.os === 'windows'
		? Object.freeze(['direct-child'] as const)
		: Object.freeze(['direct-child', 'posix-process-group'] as const);
	return Object.freeze({
		trees,
		signal: 'SIGTERM',
		forceSignal: 'SIGKILL',
		async spawn(options: SpawnOptionsType): Promise<Spawned> {
			const child = new Deno.Command(options.command, {
				detached: options.tree === 'posix-process-group',
				args: [...options.arguments],
				...(options.cwd === undefined ? {} : { cwd: options.cwd }),
				...(options.env === undefined ? {} : { env: { ...options.env } }),
				clearEnv: options.clearEnv,
				stdin: stdio(options.stdin),
				stdout: stdio(options.stdout),
				stderr: stdio(options.stderr),
			}).spawn();
			return Object.freeze({
				pid: child.pid,
				...(options.stdin === 'piped' ? { stdin: child.stdin } : {}),
				...(options.stdout === 'piped' ? { stdout: child.stdout } : {}),
				...(options.stderr === 'piped' ? { stderr: child.stderr } : {}),
				status: child.status.then((status) => Object.freeze({
					code: status.code,
					success: status.success,
					...(status.signal === null ? {} : { signal: status.signal }),
				})),
				kill(signal: SignalType) {
					if (options.tree === 'posix-process-group') {
						// Detached POSIX commands lead a new process group. Deno.kill() accepts the
						// negative group leader PID, which sends the signal to every process in that group.
						Deno.kill(-child.pid, signal as Deno.Signal);
						return;
					}
					child.kill(signal as Deno.Signal);
				},
				isGone(error: unknown) {
					return error instanceof Deno.errors.NotFound;
				},
			});
		},
	});
}

/** Maps generic stdio ownership to Deno's command vocabulary. */
function stdio(value: StdioType): 'inherit' | 'null' | 'piped' {
	if (value === 'inherit') return 'inherit';
	if (value === 'discard') return 'null';
	return 'piped';
}
