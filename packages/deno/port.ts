/**
 * Reserve an unused TCP port long enough to discover its assigned number.
 *
 * The listener closes before this function returns. The caller must bind the
 * returned port immediately because another process can claim it afterward.
 * Use this only for local child-process handoffs where the caller controls the
 * short interval between discovery and bind.
 */
export function get(hostname = '127.0.0.1'): number {
	const listener = Deno.listen({ hostname, port: 0 });
	try {
		const address = listener.addr;
		if (address.transport !== 'tcp') throw new TypeError('Expected a TCP listener address.');
		return address.port;
	} finally {
		listener.close();
	}
}
