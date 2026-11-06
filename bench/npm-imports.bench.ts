// @benchmark runner=npm
/** Measure exact installed npm artifacts in fresh native Node processes, separately from source imports. */
import { resolve } from 'node:path';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '#tools/bench/run.ts';
const index = Deno.args.indexOf('--consumer');
const pointer = index < 0
	? JSON.parse(await Deno.readTextFile(new URL('../.tmp/artifacts/npm/consumer-location.json', import.meta.url))) as {
		directory: string;
	}
	: undefined;
const consumer = resolve(index < 0 ? pointer!.directory : Deno.args[index + 1] ?? '');
const paths = JSON.parse(await Deno.readTextFile(`${consumer}/paths.json`)) as string[];
const roots = paths.filter((path) => /^@okikio\/[^/]+$/u.test(path)).sort();
if (roots.length === 0 || !roots.includes('@okikio/utils')) {
	throw new Error('Run mise run test:npm before measuring packed imports.');
}
const selected = [...roots, '@okikio/utils/result', '@okikio/utils/all'];
/** Same launch and receipt in each case; no application module is preloaded by the parent. */
async function load(name?: string): Promise<number> {
	const expression =
		'const value = process.argv[1] ? await import(process.argv[1]) : {}; process.stdout.write(JSON.stringify(Object.keys(value).length) + "\\n");';
	const output = await new Deno.Command('node', {
		args: [
			'--input-type=module',
			'--eval',
			expression,
			...(name === undefined ? [] : [name]),
		],
		cwd: consumer,
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
	const count: unknown = JSON.parse(new TextDecoder().decode(output.stdout));
	if (
		typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || (name === undefined && count !== 0) ||
		// Runtime and Storage roots are documented type-only contracts in both emitted formats.
		(name === '@okikio/runtime' || name === '@okikio/storage' ? count !== 0 : name !== undefined && count === 0)
	) throw new Error('Packed import lost runtime exports or its complete receipt.');
	return count;
}
for (const format of ['esm'] as const) {
	await load();
	for (const name of selected) await load(name);
	group(`fresh native Node ${format} exact npm artifacts: process startup included`, () => {
		bench('empty child: launch + exit baseline', async () => do_not_optimize(await load()));
		for (const name of selected) bench(name, async () => do_not_optimize(await load(name))).gc('once');
	});
}
await run();
