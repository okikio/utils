/** Run each real preflight in its own realm without treating execution speed as a correctness contract. */
import { fileURLToPath } from 'node:url';
import { denoPrograms, integrationPrograms, packagePrograms, programs, selectPrograms } from '#tools/bench/suite.ts';
const root = new URL('../../', import.meta.url);
if (!Deno.args.includes('--check')) throw new TypeError('Pass --check to run benchmark correctness oracles.');
const suite = Deno.args.find((arg) => arg.startsWith('--suite='))?.slice(8) ?? 'all';
if (!['all', 'packages', 'integration'].includes(suite)) throw new TypeError('Unknown benchmark suite.');
const runtime = Deno.args.find((arg) => arg.startsWith('--runtime='))?.slice(10) ?? 'deno';
if (!['deno', 'node', 'bun'].includes(runtime)) throw new TypeError('Unknown benchmark runtime.');
if (runtime !== 'deno' && suite !== 'packages') throw new TypeError('The integration suite needs its Deno host.');
const candidates = selectPrograms(
	suite === 'packages' ? packagePrograms : suite === 'integration' ? integrationPrograms : programs,
	Deno.args.find((arg) => arg.startsWith('--project='))?.slice(10),
);
const requested = Deno.args.find((arg) => arg.startsWith('--program='))?.slice(10);
if (requested && !candidates.includes(requested)) {
	throw new TypeError('The program is outside the selected benchmark suite.');
}
const selected = requested ? [requested] : candidates;
for (const program of selected) {
	if (runtime !== 'deno' && denoPrograms.includes(program)) {
		console.log(`Skipped ${program}: requires the Deno filesystem host.`);
		continue;
	}
	const result = await new Deno.Command(runtime === 'deno' ? Deno.execPath() : runtime, {
		args: runtime === 'deno'
			? ['run', '--frozen', '--no-check', '-A', new URL(program, root).href, '--check']
			: [fileURLToPath(new URL(program, root)), '--check'],
		env: { NODE_DISABLE_COLORS: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	if (result.stdout.length) console.log(new TextDecoder().decode(result.stdout));
	if (result.stderr.length) console.error(new TextDecoder().decode(result.stderr));
	console.log(`Checked ${program}`);
	if (!result.success) throw new Error(`${program} preflight failed with exit code ${result.code}.`);
}
console.log('All isolated benchmark fixtures and correctness oracles passed.');
