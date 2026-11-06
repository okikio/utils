/** Project Sampo's npm versions into JSR manifests without changing authored JSONC. @module */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from '@std/jsonc';
import { patch } from '../packages/exports.ts';

/**
 * Check every publishable package before writing any version projection.
 * package.json owns identity and version; deno.jsonc remains the source-publication manifest.
 * Name drift is always an error. Comments and unrelated fields remain byte-for-byte unchanged.
 */
export async function versions(root: string, write = false): Promise<number> {
	const updates: { path: string; text: string }[] = [];
	let count = 0;
	for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const directory = resolve(root, 'packages', entry.name);
		const npm = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
		if (npm.private) continue;
		const path = resolve(directory, 'deno.jsonc');
		const text = await readFile(path, 'utf8');
		const deno = parse(text) as { name: string; version: string };
		if (npm.name !== deno.name) throw new Error(`${entry.name}: npm and JSR names differ.`);
		if (npm.version !== deno.version) {
			if (!write) throw new Error(`${entry.name}: npm ${npm.version} differs from JSR ${deno.version}.`);
			updates.push({ path, text: patch(text, { version: npm.version }) });
		}
		count++;
	}
	for (const update of updates) await writeFile(update.path, update.text);
	return count;
}

if (import.meta.main) {
	const mode = process.argv[2];
	if (mode !== 'sync' && mode !== 'check') throw new TypeError('Expected sync or check.');
	console.log(`Checked ${await versions(process.cwd(), mode === 'sync')} package release versions.`);
}
