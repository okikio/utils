/** Optional process-owned probe listener; importing this module binds no network. */

/** Fixed operational codes prevent dependency errors or customer data entering probes. */
export const degradedReasons = Object.freeze(['dependency-unavailable', 'recovering', 'paused'] as const);
/** Safe fixed readiness reasons suitable for public probes. */
export type DegradedReasonType = (typeof degradedReasons)[number];
/** Current process readiness; successful liveness is independent. */
export type ReadinessType = Readonly<
	| { state: 'booting' }
	| { state: 'ready' }
	| { state: 'degraded'; reason: DegradedReasonType }
	| { state: 'stopping' }
>;

/** Parse an explicitly enabled listener; an absent setting preserves existing processes without a port. */
export function configuredPort(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!/^[1-9][0-9]{0,4}$/u.test(value) || Number(value) > 65_535) {
		throw new RangeError('Process health port must be a decimal integer between 1 and 65535.');
	}
	return Number(value);
}

/** The executable supplies networking and lifetime explicitly, usually from its owned context. */
export interface Options {
	/** Undefined disables the listener. Zero requests an ephemeral port for local test. */
	readonly port?: number;
	/** Defaults to all IPv4 interfaces so Kubernetes can probe the Pod IP. */
	readonly hostname?: string;
	/** Cancellation closes this listener; it never cancels the caller or its other resources. */
	readonly signal: AbortSignal;
}

/** A caller-owned listener and explicit readiness state, without dependency acquisition or polling. */
export interface Health extends AsyncDisposable {
	/** Bound listener address, or undefined when disabled or pre-cancelled. */
	readonly address: Readonly<Deno.NetAddr> | undefined;
	/** Last explicit readiness report. Reading this performs no dependency check. */
	readonly status: ReadinessType;
	/** Caller reports successful boot or recovery. Ignored after stopping. */
	ready(): void;
	/** Register once per owned loop, before it starts. Each callback reports a completed poll, including empty work.
	 * Readiness requires success from every registered loop; one failed loop keeps the process degraded.
	 * Callbacks retain no payload or credentials and are ignored after shutdown.
	 */
	poller(): (successful: boolean) => void;
	/** Caller reports a recoverable condition. Liveness stays independent. */
	degraded(reason: DegradedReasonType): void;
	/** Refuse readiness while shutdown drains the caller's work; keep liveness until close. */
	stop(): void;
	/** Close the listener and remove the cancellation subscription. Repeated calls share cleanup. */
	close(): Promise<void>;
}

/**
 * Open optional GET /live and /ready probes under the caller's lifetime.
 *
 * /live only establishes that this HTTP handler can run; it does not prove queue progress.
 * /ready reflects explicit caller reports and never calls a dependency. No errors, arbitrary
 * messages or request payloads appear in responses or logs. The listener starts booting.
 *
 * @example
 * ```ts
 * await using health = open({ port: 8081, signal: ctx.signal });
 * // After the owning worker has booted:
 * health.ready();
 * // A recoverable dependency failure keeps /live successful:
 * health.degraded('dependency-unavailable');
 * ```
 */
export function open(options: Options): Health {
	if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535)) {
		throw new RangeError('Process health port must be an integer between 0 and 65535, or undefined.');
	}
	let status: ReadinessType = Object.freeze({ state: options.signal.aborted ? 'stopping' : 'booting' });
	// The process has a fixed set of loops. Their last completed outcomes are not a queue-progress watchdog.
	const polls = new Map<symbol, boolean | undefined>();
	/** Fold last completed polls: one failure dominates, and an unreported loop prevents readiness. */
	const reportPolls = () => {
		if (status.state === 'stopping') return;
		const results = [...polls.values()];
		status = Object.freeze(
			results.includes(false)
				? { state: 'degraded', reason: 'dependency-unavailable' }
				: results.every((value) => value === true)
				? { state: 'ready' }
				: { state: 'booting' },
		);
	};
	let server: Deno.HttpServer<Deno.NetAddr> | undefined;
	let closing: Promise<void> | undefined;
	/** Refuse new traffic through readiness before the owner begins draining accepted work. */
	const stop = () => {
		status = Object.freeze({ state: 'stopping' });
	};
	/** Share shutdown with abort and disposal so every caller joins the same listener cleanup. */
	const close = (): Promise<void> => {
		if (closing) return closing;
		stop();
		options.signal.removeEventListener('abort', aborted);
		closing = server?.shutdown() ?? Promise.resolve();
		return closing;
	};
	// Event dispatch cannot await cleanup. The same rejection remains observable by close/disposal.
	const aborted = () => {
		void close().catch(() => {});
	};
	if (options.port !== undefined && !options.signal.aborted) {
		server = Deno.serve({ hostname: options.hostname ?? '0.0.0.0', port: options.port, onListen() {} }, (request) => {
			const headers = { 'cache-control': 'no-store' };
			if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, allow: 'GET' } });
			const path = new URL(request.url).pathname;
			if (path === '/live') return Response.json({ status: 'live' }, { headers });
			if (path === '/ready') return Response.json(status, { status: status.state === 'ready' ? 200 : 503, headers });
			return new Response(null, { status: 404, headers });
		});
		options.signal.addEventListener('abort', aborted, { once: true });
	}
	const address = server ? Object.freeze({ ...server.addr }) : undefined;
	return Object.freeze({
		address,
		get status() {
			return status;
		},
		poller() {
			const owner = Symbol('poll');
			polls.set(owner, undefined);
			reportPolls();
			return (successful: boolean) => {
				if (status.state === 'stopping') return;
				polls.set(owner, successful);
				reportPolls();
			};
		},
		ready() {
			if (polls.size) reportPolls();
			else if (status.state !== 'stopping') status = Object.freeze({ state: 'ready' });
		},
		degraded(reason: DegradedReasonType) {
			if (!degradedReasons.includes(reason)) {
				throw new TypeError('Process health requires a declared degraded reason code.');
			}
			if (status.state !== 'stopping') status = Object.freeze({ state: 'degraded', reason });
		},
		stop,
		close,
		[Symbol.asyncDispose]: close,
	});
}
