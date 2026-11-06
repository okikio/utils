/** Explicit Deno transport selection made by an executable host. */
export interface Options {
	/** Optional proxy origin. SOCKS5h keeps destination DNS resolution with the proxy. */
	readonly url?: string;
	/** Host-selected NO_PROXY and no_proxy values. Nonempty bypass lists are refused for an explicit proxy. */
	readonly bypass: readonly (string | undefined)[];
}

/** A Fetch function and the connection pool whose lifetime its caller owns. */
export interface Transport extends Disposable {
	/** Fetch through the selected transport while preserving the original URL, TLS hostname, and caller cancellation. */
	readonly fetch: typeof globalThis.fetch;
}

/**
 * Own a Deno HTTP client for one explicit proxy transport.
 *
 * The URL is never rewritten to loopback, so HTTPS still authenticates the
 * original destination. Deno's explicit proxy inherits NO_PROXY/no_proxy;
 * refusing bypass lists prevents a private client from silently using direct
 * network access. The executable supplies those environment values explicitly.
 * No process-wide proxy or environment state is changed.
 *
 * @example Select a colocated SOCKS proxy for one private peer client
 * ```ts
 * using transport = create({ url: 'socks5h://127.0.0.1:1055', bypass: ['', ''] });
 * const peer = makePeer({ fetch: transport.fetch });
 * ```
 *
 * @example Keep local development on its existing native transport
 * ```ts
 * using transport = create({ bypass: [] });
 * const response = await transport.fetch('http://localhost:8787/status');
 * ```
 */
export function create(options: Options): Transport {
	const configured = options.url?.trim();
	if (configured && options.bypass.some((value) => value?.trim())) {
		throw new TypeError('An explicit proxy requires empty NO_PROXY and no_proxy values.');
	}
	let client: Deno.HttpClient | undefined;
	if (configured) {
		let url: URL;
		try {
			url = new URL(configured);
		} catch {
			throw new TypeError('Proxy must be an absolute transport origin.');
		}
		if (
			!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname || url.username ||
			url.password ||
			(url.pathname !== '' && url.pathname !== '/') || url.search || url.hash
		) {
			throw new TypeError('Proxy must be an HTTP(S) or SOCKS5 origin without credentials, path, query, or fragment.');
		}
		client = Deno.createHttpClient({ proxy: { url: configured } });
	}
	let closed = false;
	return Object.freeze(
		{
			fetch: (input, init) => {
				if (closed) return Promise.reject(new TypeError('Proxy transport is disposed.'));
				return globalThis.fetch(input, { ...init, ...(client === undefined ? {} : { client }) });
			},
			[Symbol.dispose](): void {
				if (closed) return;
				closed = true;
				client?.close();
			},
		} satisfies Transport,
	);
}
