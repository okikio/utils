/** Deno subprocess adapter for {@link import('@okikio/worker/process')}. */
import childProcess from 'node:child_process';
import type { Adapter, SignalType, Spawned, SpawnOptionsType, StdioType } from '@okikio/worker/process/types';

/** Explicit optional authority for named-executable POSIX process-group control. */
export interface OptionsType {
	/** Use only literal /bin/kill for owned groups instead of Deno.kill's unrestricted-run permission. */
	readonly groupHost?: 'system-kill';
}

/**
 * Creates the Deno subprocess adapter.
 *
 * Importing this module does not start a process. `Deno.Command` is resolved only
 * when the generic process owner asks the adapter to spawn one child.
 */
export function create(settings: OptionsType = {}): Adapter {
	if (settings.groupHost !== undefined && settings.groupHost !== 'system-kill') {
		throw new TypeError('Unknown Deno process-group host.');
	}
	if (settings.groupHost !== undefined && Deno.build.os === 'windows') {
		throw new TypeError('The system process-group host requires POSIX.');
	}
	const trees = Deno.build.os === 'windows'
		? Object.freeze(['direct-child'] as const)
		: Object.freeze(['direct-child', 'posix-process-group'] as const);
	return Object.freeze({
		trees,
		signal: 'SIGTERM',
		forceSignal: 'SIGKILL',
		/**
		 * Start one native child and expose its streams plus eventual exit result.
		 * Launch success is separate from command success. The Process owner above
		 * this adapter must consume or close streams, signal cancellation and join exit.
		 */
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
			const group = options.tree === 'posix-process-group' && settings.groupHost === 'system-kill'
				? systemGroup(child.pid)
				: undefined;
			return Object.freeze({
				pid: child.pid,
				...(options.stdin === 'piped' ? { stdin: child.stdin } : {}),
				...(options.stdout === 'piped' ? { stdout: child.stdout } : {}),
				...(options.stderr === 'piped' ? { stderr: child.stderr } : {}),
				status: child.status.then((status) =>
					Object.freeze({
						code: status.code,
						success: status.success,
						...(status.signal === null ? {} : { signal: status.signal }),
					})
				),
				kill(signal: SignalType) {
					if (group !== undefined) {
						if (!group(signal)) throw new Deno.errors.NotFound('Owned process group no longer exists.');
						return;
					}
					if (options.tree === 'posix-process-group') {
						// Detached POSIX commands lead a new process group. Deno.kill() accepts the
						// negative group leader PID, which sends the signal to every process in that group.
						Deno.kill(-child.pid, signal as Deno.Signal);
						return;
					}
					child.kill(signal as Deno.Signal);
				},
				isGone(error: unknown) {
					return error instanceof Deno.errors.NotFound ||
						(error instanceof TypeError && error.message === 'Child process has already terminated');
				},
				...(group === undefined ? {} : { treeAlive: () => group(0) }),
			});
		},
	});
}

/** Bind the finite host to the validated PID returned by this adapter's own spawn. */
function systemGroup(pid: number): (signal: SignalType) => boolean {
	if (!Number.isSafeInteger(pid) || pid < 2) throw new TypeError('Invalid owned process-group identity.');
	const decoder = new TextDecoder('utf-8', { fatal: true });
	return (signal) => {
		const selected = signal === 'SIGTERM' ? 'TERM' : signal === 'SIGKILL' ? 'KILL' : signal === 0 ? '0' : undefined;
		if (selected === undefined) throw new TypeError('The system group host supports only TERM, KILL and signal zero.');
		const result = childProcess.spawnSync('/bin/kill', [`-${selected}`, '--', `-${pid}`], {
			stdio: ['ignore', 'ignore', 'pipe'],
			env: { LC_ALL: 'C', LANG: 'C' },
			timeout: 1000,
			killSignal: 'SIGKILL',
			// Pinned Deno 2.9.7 appends one <=64KiB chunk before checking this
			// threshold: raw stderr capture is <=69632 bytes, not a 4KiB hard cap.
			maxBuffer: 4096,
		});
		// Never parse truncated, overflowed, timed-out, denied or ambiguous output
		// as absence. Only a complete bounded C-locale ESRCH diagnostic proves it.
		if (
			result.error !== undefined || result.signal !== null || result.status === null ||
			result.stderr === null || result.stderr.byteLength > 4096
		) {
			throw new Error('Owned process-group control failed.');
		}
		const diagnostic = decoder.decode(result.stderr);
		if (result.status === 0 && diagnostic === '') return true;
		// Darwin may deny signal-zero while the killed group contains unreaped zombies.
		// Keep waiting within the owner's deadline; permission denial never proves absence.
		if (
			Deno.build.os === 'darwin' && selected === '0' && result.status === 1 &&
			diagnostic === `kill: ${-pid}: Operation not permitted\n`
		) return true;
		if (
			result.status === 1 &&
			(diagnostic === `/bin/kill: (${-pid}): No such process\n` ||
				diagnostic === `kill: (${-pid}): No such process\n` ||
				(Deno.build.os === 'darwin' && diagnostic === `kill: ${-pid}: No such process\n`))
		) {
			return false;
		}
		throw new Error('Owned process-group control returned an unexpected result.');
	};
}

/** Maps generic stdio ownership to Deno's command vocabulary. */
function stdio(value: StdioType): 'inherit' | 'null' | 'piped' {
	if (value === 'inherit') return 'inherit';
	if (value === 'discard') return 'null';
	return 'piped';
}
