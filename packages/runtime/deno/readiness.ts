import { delay } from '@okikio/context';

/** One caller-selected loopback listener. It contains no URL credentials. */
export interface Target {
	/** Safe diagnostic name supplied by the workload owner. */
	readonly name: string;
	/** Loopback IP address or localhost. */
	readonly hostname: string;
	/** TCP listener port. */
	readonly port: number;
}

/** Cancellation and admission policy owned by the executable waiting for its listeners. */
export interface Options {
	/** Process cancellation; its original reason is preserved. */
	readonly signal: AbortSignal;
	/** Total listener admission budget in milliseconds. No application budget is hidden in this utility. */
	readonly timeoutMs: number;
	/** Delay between refused connection attempts. Defaults to 500 milliseconds. */
	readonly intervalMs?: number;
	/** Optional transport probe. It must observe cancellation and close every connection it acquires. */
	readonly connect?: (target: Target, signal: AbortSignal) => Promise<void>;
}

/** Default ports for URL transports understood by listener admission. */
const Ports: Readonly<Record<string, number>> = Object.freeze({
	'http:': 80,
	'https:': 443,
	'postgres:': 5432,
	'postgresql:': 5432,
	'socks5:': 1080,
	'socks5h:': 1080,
});

/**
 * Select loopback listeners from explicitly named workload URLs.
 * Remote URLs are left to their actual clients. This checks transport presence,
 * not authentication, schema health, or the availability of a remote service.
 *
 * @example Wait only for the storage this worker uses
 * ```ts
 * const listeners = targets({ storage: 'postgres://127.0.0.1:15432/app' });
 * ```
 *
 * @example Include an explicit local proxy without probing its remote destination
 * ```ts
 * const listeners = targets({ proxy: 'socks5h://127.0.0.1:1055', peer: 'https://peer.example' });
 * // Only proxy is selected.
 * ```
 */
export function targets(urls: Readonly<Record<string, string | undefined>>): readonly Target[] {
	return Object.freeze(
		Object.entries(urls).flatMap(([name, value]) => {
			if (!value?.trim()) return [];
			let url: URL;
			try {
				url = new URL(value);
			} catch {
				throw new TypeError(`${name} must contain a valid transport URL.`);
			}
			const defaultPort = Ports[url.protocol];
			if (defaultPort === undefined) throw new TypeError(`${name} uses an unsupported transport protocol.`);
			if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return [];
			const port = Number(url.port || defaultPort);
			if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
				throw new TypeError(`${name} requires a TCP port between 1 and 65535.`);
			}
			return [Object.freeze({ name, hostname: url.hostname === '[::1]' ? '::1' : url.hostname, port })];
		}),
	);
}

/** Probe a TCP listener and close successful connections, including connections arriving after cancellation. */
async function connect(target: Target, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	const attempt = Deno.connect({ hostname: target.hostname, port: target.port }).then((connection) =>
		connection.close()
	);
	let abort: (() => void) | undefined;
	try {
		await Promise.race([
			attempt,
			new Promise<never>((_resolve, reject) => {
				abort = () => reject(signal.reason);
				signal.addEventListener('abort', abort, { once: true });
				if (signal.aborted) abort();
			}),
		]);
	} finally {
		if (abort !== undefined) signal.removeEventListener('abort', abort);
	}
}

/**
 * Wait for the selected listeners within a caller-owned budget.
 * Refused connections retry independently. Permanent failures cancel sibling
 * probes immediately; shutdown never starts another acquisition attempt.
 *
 * @example Admit an executable after its loopback storage bridge binds
 * ```ts
 * await wait(targets({ storage: 'postgres://localhost:15432/app' }), {
 *   signal: controller.signal, timeoutMs: 240_000,
 * });
 * ```
 *
 * @example Use an injected probe for a deterministic local test
 * ```ts
 * await wait([{ name: 'storage', hostname: '127.0.0.1', port: 15432 }], {
 *   signal: controller.signal, timeoutMs: 1_000, connect: async () => {},
 * });
 * ```
 */
export async function wait(listeners: readonly Target[], options: Options): Promise<void> {
	const intervalMs = options.intervalMs ?? 500;
	for (const [name, value] of Object.entries({ timeoutMs: options.timeoutMs, intervalMs })) {
		if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
			throw new RangeError(`${name} must be a positive timer-sized integer.`);
		}
	}
	for (const target of listeners) {
		if (
			!['127.0.0.1', 'localhost', '::1'].includes(target.hostname) || !Number.isSafeInteger(target.port) ||
			target.port < 1 || target.port > 65_535
		) {
			throw new TypeError('Readiness targets must identify a loopback TCP listener.');
		}
	}
	options.signal.throwIfAborted();
	if (listeners.length === 0) return;
	const peers = new AbortController();
	const timeout = setTimeout(
		() => peers.abort(new DOMException('Listener admission timed out.', 'TimeoutError')),
		options.timeoutMs,
	);
	const signal = AbortSignal.any([options.signal, peers.signal]);
	const probe = options.connect ?? connect;
	try {
		await Promise.all(listeners.map(async (target) => {
			while (true) {
				signal.throwIfAborted();
				try {
					await probe(target, signal);
					signal.throwIfAborted();
					return;
				} catch (error) {
					signal.throwIfAborted();
					if (!(error instanceof Deno.errors.ConnectionRefused)) throw error;
				}
				await delay(intervalMs, signal);
			}
		}));
	} finally {
		clearTimeout(timeout);
		peers.abort();
	}
}

/**
 * Admit worker startup, returning false only when its caller requested shutdown.
 * Callers must return immediately on false; a cancelled boot must not acquire resources.
 * Listener timeouts, invalid configuration and unrelated transport failures still reject.
 */
export async function waitForStartup(listeners: readonly Target[], options: Options): Promise<boolean> {
	try {
		await wait(listeners, options);
		return true;
	} catch (error) {
		if (options.signal.aborted && error === options.signal.reason) return false;
		throw error;
	}
}
