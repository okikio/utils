/**
 * Read one HTTP response body without allowing an upstream peer to force unbounded buffering.
 *
 * The declared Content-Length is rejected before reading when it exceeds the limit. The
 * streaming byte count remains authoritative because peers can omit or misstate that header.
 */
export async function readText(response: Response, maximumBytes: number): Promise<string> {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
		throw new RangeError('Response body maximumBytes must be a non-negative safe integer.');
	}
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		const bytes = Number(declared);
		if (Number.isFinite(bytes) && bytes > maximumBytes) {
			await response.body?.cancel('response body limit exceeded').catch(() => undefined);
			throw new RangeError(`HTTP response body exceeds ${maximumBytes} bytes.`);
		}
	}
	if (response.body === null) return '';

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		let next = await reader.read();
		while (!next.done) {
			total += next.value.byteLength;
			if (total > maximumBytes) {
				await reader.cancel('response body limit exceeded').catch(() => undefined);
				throw new RangeError(`HTTP response body exceeds ${maximumBytes} bytes.`);
			}
			chunks.push(next.value);
			next = await reader.read();
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}
