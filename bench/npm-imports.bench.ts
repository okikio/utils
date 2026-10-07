/** Measure exact installed npm artifacts in fresh native Node processes, separately from source imports. */
import { resolve } from 'node:path';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './run.ts';
const index = Deno.args.indexOf('--consumer');
const pointer = index < 0
	? JSON.parse(await Deno.readTextFile(new URL('../.artifacts/npm/consumer-location.json', import.meta.url))) as {
		directory: string;
	}
	: undefined;
const consumer = resolve(index < 0 ? pointer!.directory : Deno.args[index + 1] ?? '');
const paths = JSON.parse(await Deno.readTextFile(`${consumer}/paths.json`)) as string[];
const roots = paths.filter((path) => /^@okikio\/[^/]+$/u.test(path)).sort();
if (roots.length === 0 || !roots.includes('@okikio/utils')) {
	throw new Error('Run npm:verify before measuring packed imports.');
}
const selected = [...roots, '@okikio/utils/result', '@okikio/utils/all'];
/** Same launch and receipt in each case; no application module is preloaded by the parent. */
async function load(format: 'esm' | 'cjs', name?: string): Promise<number> {
	const expression = format === 'esm'
		? 'const value = process.argv[1] ? await import(process.argv[1]) : {}; process.stdout.write(JSON.stringify(Object.keys(value).length) + "\\n");'
		: 'const value = process.argv[1] ? require(process.argv[1]) : {}; process.stdout.write(JSON.stringify(Object.keys(value).length) + "\\n");';
	const output = await new Deno.Command('node', {
		args: [
			`--input-type=${format === 'esm' ? 'module' : 'commonjs'}`,
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
		(name !== undefined && count === 0)
	) throw new Error('Packed import lost runtime exports or its complete receipt.');
	return count;
}
for (const format of ['esm', 'cjs'] as const) {
	await load(format);
	for (const name of selected) await load(format, name);
	group(`fresh native Node ${format} exact npm artifacts: process startup included`, () => {
		bench('empty child: launch + exit baseline', async () => do_not_optimize(await load(format)));
		for (const name of selected) bench(name, async () => do_not_optimize(await load(format, name))).gc('once');
	});
}
await run();
