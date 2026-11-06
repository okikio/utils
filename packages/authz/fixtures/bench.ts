/** Package-local Mitata execution; fixture oracles run even when timing is disabled. @module */
import { run as measure } from 'mitata';
import process from 'node:process';

/** Preserve JSON for collection, fail throwing trials, and leave --check untimed. */
export async function run(): Promise<void> {
	if (process.argv.includes('--check')) return;
	const before = process.memoryUsage();
	if (process.argv.includes('--json')) {
		const output: string[] = [];
		await measure({ throw: true, colors: false, format: 'json', print: (line) => output.push(line) });
		await new Promise<void>((resolve, reject) => {
			process.stdout.write(output.join('\n') + '\n', (error) => error ? reject(error) : resolve());
		});
	} else {
		await measure({ throw: true, colors: false });
	}
	const destination = process.argv.find((arg) => arg.startsWith('--resources='))?.slice(12);
	if (destination !== undefined) {
		const after = process.memoryUsage();
		let peakRssBytes: number | null = null;
		try {
			peakRssBytes = process.resourceUsage().maxRSS * 1024;
		} catch { /* Unsupported native counter remains explicit. */ }
		const { writeFile } = await import('node:fs/promises');
		await writeFile(
			destination,
			JSON.stringify(
				{
					scope:
						'Whole benchmark process including fixtures, warmup and timing. Top-level fixture disposal may follow this snapshot; not per-operation memory or a leak test.',
					peakRssBytes,
					beforeTimings: before,
					afterTimings: after,
					gc: 'Natural collection during Mitata; endpoint heap values are not forced-GC retained-memory measurements.',
				},
				null,
				2,
			) + '\n',
		);
	}
}
