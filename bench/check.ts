/** Run each real preflight in its own realm without treating execution speed as a correctness contract. */
import { programs } from './suite.ts';
if (!Deno.args.includes('--check')) throw new TypeError('Pass --check to run benchmark correctness oracles.');
for (const program of programs) {
	const result = await new Deno.Command(Deno.execPath(), {
		args: ['run', '--no-check', '-A', new URL(program, import.meta.url).href, '--check'],
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
