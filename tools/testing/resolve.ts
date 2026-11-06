/** Resolve package imports from an isolated consumer using Node's native ESM conditions. @module */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Place the resolver inside the consumer so its parent URL cannot see this workspace's dependencies.
 * A resolver created with createRequire would select different export conditions and reject import-only packages.
 */
export async function resolver(consumer: string): Promise<(specifier: string) => string> {
	const directory = resolve(consumer, '.tmp');
	await mkdir(directory, { recursive: true });
	const module = resolve(directory, 'resolve.mjs');
	await writeFile(module, 'export const resolve = (specifier) => import.meta.resolve(specifier);\n');
	const native = await import(pathToFileURL(module).href) as { resolve(specifier: string): string };
	return (specifier) => fileURLToPath(native.resolve(specifier));
}
