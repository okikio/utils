/** Native Mitata report IO for the same challenger program on Deno, Node and Bun. @module */
import process from 'node:process';
import { run as measure } from 'mitata';

/** Each host supplies its own argv; the workload does not emulate another runtime. */
export const challengerArguments = typeof Deno === 'undefined' ? process.argv.slice(2) : Deno.args;

/** Report actual engine/version separately from the controller that launches fresh children. */
export function challengerRuntime(): Readonly<Record<string, string>> {
	if (typeof Deno !== 'undefined') return { name: 'deno', ...Deno.version };
	const bun = (globalThis as { readonly Bun?: { readonly version: string } }).Bun;
	if (bun !== undefined) return { name: 'bun', bun: bun.version };
	return { name: 'node', node: process.versions.node, v8: process.versions.v8 };
}

/**
 * Preserve native Mitata samples and throw mode, joining all report writes before exit.
 *
 * --check runs the program's untimed oracle only. --profile remains the Deno suite's
 * external V8 gate; Node and Bun use the importable HTTP operation registry with
 * their native profiler controller. No speed threshold is imposed here.
 */
export async function runChallengers(): Promise<void> {
	if (challengerArguments.includes('--check')) return;
	if (challengerArguments.includes('--profile')) {
		if (typeof Deno === 'undefined') throw new TypeError('Use the native HTTP operation profiler for this runtime.');
		const close = (await import('./profile-gate.ts')).install();
		try {
			await measure({ throw: true, colors: false, format: 'quiet' });
		} finally {
			await close();
		}
		return;
	}
	if (!challengerArguments.includes('--json')) {
		await measure({ throw: true, colors: false });
		return;
	}
	const output: string[] = [];
	await measure({ throw: true, colors: false, format: 'json', print: (line) => output.push(line) });
	const text = `${output.join('\n')}\n`;
	if (typeof Deno === 'undefined') {
		await new Promise<void>((resolve, reject) => {
			process.stdout.write(text, (error) => error ? reject(error) : resolve());
		});
	} else {
		const bytes = new TextEncoder().encode(text);
		let offset = 0;
		while (offset < bytes.byteLength) {
			const written = await Deno.stdout.write(bytes.subarray(offset));
			if (written === 0) throw new Error('Benchmark stdout stopped accepting report bytes.');
			offset += written;
		}
	}
}
