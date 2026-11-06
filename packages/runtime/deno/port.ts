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

/** Owned reservation and its actual listener. Accept on this listener rather than rebinding its occupied port. */
export interface Reservation extends Disposable {
	/** Bound address, captured from the actual listener. */
	readonly address: Deno.NetAddr;
	/** Borrowed access to the reservation's listener. The reservation owns closure. */
	readonly listener: Deno.TcpListener;
	readonly closed: boolean;
}

/**
 * Keep an ephemeral TCP port bound until disposal. The consumer must accept this listener to avoid
 * a discovery/rebind race. An unrelated child cannot bind the occupied address; use child port zero
 * and an explicit readiness message instead. Disposal is idempotent; accepted connections remain
 * separately owned by whoever accepted them. No process, readiness polling or signal handler is installed.
 */
export function reserve(hostname = '127.0.0.1'): Reservation {
	const listener = Deno.listen({ hostname, port: 0 });
	let closed = false;
	return Object.freeze({
		address: Object.freeze({ ...listener.addr }),
		listener,
		get closed() {
			return closed;
		},
		[Symbol.dispose]() {
			if (closed) return;
			closed = true;
			listener.close();
		},
	});
}
