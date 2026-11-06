/** Repository-local directories for native file tests. @module */
import { fileURLToPath } from 'node:url';

/** Allocate one isolated directory. The case must register removal on scope exit, including assertion failure. */
export async function directory(): Promise<string> {
	const root = new URL('../../../../.tmp/tests/runtime/files/', import.meta.url);
	await Deno.mkdir(root, { recursive: true });
	return await Deno.makeTempDir({ dir: fileURLToPath(root), prefix: 'run-' });
}
