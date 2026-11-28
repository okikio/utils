/** Run copyable examples on a selected native runtime and retain complete diagnostics. @module */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { runtime: { type: 'string', default: 'deno' } } });
const runtime = values.runtime!;
if (!['deno', 'node', 'bun'].includes(runtime)) throw new TypeError('Unknown example runtime.');
let checked = 0;
for (const entry of readdirSync('examples', { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	// A runtime suffix declares a native host requirement, not a portable server.
	const check = [`check.${runtime}.ts`, 'check.ts'].find((name) => existsSync(`examples/${entry.name}/${name}`));
	if (!check) continue;
	checked++;
	// A declared check.ts is the example's executable outcome, not a second
	// implementation maintained only by the test harness.
	const args = runtime === 'deno'
		? ['run', '--frozen', '--allow-net=localhost,127.0.0.1', `examples/${entry.name}/${check}`]
		: [`examples/${entry.name}/${check}`];
	const result = spawnSync(runtime, args, { encoding: 'utf8', timeout: 60_000 });
	const directory = `.tmp/examples/native/${entry.name}-${runtime}-${Date.now()}`;
	mkdirSync(directory, { recursive: true });
	writeFileSync(`${directory}/stdout.log`, result.stdout ?? '');
	writeFileSync(`${directory}/stderr.log`, result.stderr ?? '');
	writeFileSync(
		`${directory}/result.json`,
		JSON.stringify(
			{ runtime, args, status: result.status, signal: result.signal, error: result.error?.message },
			null,
			2,
		),
	);
	process.stdout.write(result.stdout ?? '');
	process.stderr.write(result.stderr ?? '');
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (checked === 0) throw new Error('No executable examples were discovered.');
