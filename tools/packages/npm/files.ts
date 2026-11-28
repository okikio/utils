/** Traverse npm source and artifact trees with the same exclusion policy. @module */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Enumerate emitted files without depending on platform-specific shell glob behavior. */
export async function* files(directory: string): AsyncGenerator<string> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			if (!['node_modules', '.tmp', '.git', 'fixtures'].includes(entry.name)) yield* files(path);
		} else yield path;
	}
}
