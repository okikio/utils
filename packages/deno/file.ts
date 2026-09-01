/** Deno filesystem mechanics shared by executable composition roots. */
import { basename, dirname, join } from '@std/path';

/**
 * Atomically replace one file by writing a same-directory temporary file first.
 *
 * Same-directory rename keeps the final publication on one filesystem. The
 * caller owns the semantic contract for the bytes; this utility owns only the
 * generic write/rename cleanup mechanics.
 */
export async function write(
	path: string,
	contents: string | Uint8Array,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<void> {
	options.signal?.throwIfAborted();
	const directory = dirname(path);
	await Deno.mkdir(directory, { recursive: true });
	const temp = join(directory, `.${basename(path)}.${crypto.randomUUID()}.tmp`);
	const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
	try {
		await Deno.writeFile(temp, bytes, { createNew: true });
		options.signal?.throwIfAborted();
		await Deno.rename(temp, path);
	} finally {
		await Deno.remove(temp).catch((error) => {
			if (!(error instanceof Deno.errors.NotFound)) throw error;
		});
	}
}
