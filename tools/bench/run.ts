/** Share benchmark error policy while allowing all untimed correctness oracles to run on demand. */
import { run as measure } from 'mitata';
import process from 'node:process';

/**
 * Measure registered work, or only validate its fixture with --check.
 * Mitata normally prints a failed trial without rejecting. A benchmark task must
 * fail when its workload throws, so this runner enables its explicit throw mode.
 */
export async function run(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes('--check')) return;
	if (args.includes('--profile')) {
		if (!('Deno' in globalThis)) {
			throw new TypeError(
				'The suite inspector profile adapter requires Deno. Run ordinary measurements on Node or Bun.',
			);
		}
		const close = (await import('#tools/bench/profile-gate.ts')).install();
		try {
			await measure({ throw: true, colors: false, format: 'quiet' });
		} finally {
			await close();
		}
		return;
	}
	// A formatter must not discover terminal policy through process.env in a
	// restricted Deno capability. Plain output is deliberate for local and CI runs.
	// The task profiles also grant the pinned harness's color keys explicitly.
	if (!args.includes('--json')) {
		await measure({ throw: true, colors: false });
		return;
	}
	const output: string[] = [];
	await measure({ throw: true, colors: false, format: 'json', print: (line) => output.push(line) });
	// Node's stream contract is also supported by Deno and Bun tooling. Joining
	// its callback prevents a large report from ending after its first pipe buffer.
	await new Promise<void>((resolve, reject) => {
		process.stdout.write(`${output.join('\n')}\n`, (error) => error ? reject(error) : resolve());
	});
}
