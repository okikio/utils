/** Measure selective source adoption in fresh processes with a matched process-only baseline. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './run.ts';
import { parse } from '@std/jsonc';
const root = new URL('../', import.meta.url);
const fixture = new URL('./fixtures/import.ts', import.meta.url);
const entries: { name: string; url: URL }[] = [];
for await (const entry of Deno.readDir(new URL('packages/', root))) {
	if (!entry.isDirectory) continue;
	const directory = new URL(`packages/${entry.name}/`, root);
	const manifest = parse(await Deno.readTextFile(new URL('deno.jsonc', directory))) as {
		name: string;
		exports: Record<string, string>;
	};
	if (manifest.exports['.'] === undefined) throw new Error(`${manifest.name} has no root export.`);
	entries.push({ name: manifest.name, url: new URL(manifest.exports['.'], directory) });
}
entries.sort((left, right) => left.name.localeCompare(right.name));
entries.push({ name: '@okikio/utils/all', url: new URL('packages/utils/all.ts', root) });
/** Each child starts without preloaded application modules. The OS and dependency caches may be warm. */
async function load(url?: URL): Promise<{ exports: number; milliseconds: number }> {
	const output = await new Deno.Command(Deno.execPath(), {
		args: [
			'run',
			'--no-check',
			'--allow-read',
			'--config',
			new URL('deno.jsonc', root).pathname,
			fixture.href,
			...(url === undefined ? [] : [url.href]),
		],
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
	const value: unknown = JSON.parse(new TextDecoder().decode(output.stdout));
	if (
		value === null || typeof value !== 'object' || !('exports' in value) || !('milliseconds' in value) ||
		typeof value.exports !== 'number' || !Number.isInteger(value.exports) || value.exports < 0 ||
		typeof value.milliseconds !== 'number' || !Number.isFinite(value.milliseconds) || value.milliseconds < 0
	) {
		throw new Error('Fresh import child did not return a complete import receipt.');
	}
	return { exports: value.exports, milliseconds: value.milliseconds };
}
const empty = await load();
if (empty.exports !== 0) throw new Error('Empty import child exported application data.');
for (const entry of entries) {
	const receipt = await load(entry.url);
	if (receipt.exports === 0) {
		throw new Error(`${entry.name} lost all runtime exports.`);
	}
}
group('fresh Deno source imports: process startup included', () => {
	bench('empty child: launch + exit baseline', async () => do_not_optimize(await load()));
	for (const entry of entries) bench(entry.name, async () => do_not_optimize(await load(entry.url))).gc('once');
});
await run();
