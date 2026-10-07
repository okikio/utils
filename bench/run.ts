/** Share benchmark error policy while allowing all untimed correctness oracles to run on demand. */
import { run as measure } from 'mitata';

/**
 * Measure registered work, or only validate its fixture with --check.
 * Mitata normally prints a failed trial without rejecting. A benchmark task must
 * fail when its workload throws, so this runner enables its explicit throw mode.
 */
export async function run(): Promise<void> {
	if (Deno.args.includes('--check')) return;
	if (Deno.args.includes('--profile')) {
		const close = (await import('./profile-gate.ts')).install();
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
	if (!Deno.args.includes('--json')) {
		await measure({ throw: true, colors: false });
		return;
	}
	const output: string[] = [];
	await measure({ throw: true, colors: false, format: 'json', print: (line) => output.push(line) });
	const bytes = new TextEncoder().encode(`${output.join('\n')}\n`);
	// Keep the native formatter but join every stdout write before exit. A large
	// report must not look successful after only its first pipe buffer is written.
	let offset = 0;
	while (offset < bytes.byteLength) {
		const written = await Deno.stdout.write(bytes.subarray(offset));
		if (written === 0) throw new Error('Benchmark stdout stopped accepting report bytes.');
		offset += written;
	}
}
