/** External V8 sampling gates around each real Mitata trial, including its own warmup and GC policy. @module */
import { B } from 'mitata';

/**
 * Mitata exposes B.run as the trial boundary. Intercept that public method only
 * in a diagnostic child. Calibration and fixture construction stay outside the
 * region; the returned trial retains every argument expansion and native statistic.
 * This instrumentation is never installed by a normal benchmark or library import.
 */
export function install(): () => Promise<void> {
	const original = B.prototype.run;
	const reader = Deno.stdin.readable.pipeThrough(new TextDecoderStream()).getReader();
	let index = 0;
	async function gate(expected: string): Promise<void> {
		let input = '';
		while (!input.endsWith('\n')) {
			const next = await reader.read();
			if (next.done) throw new Error('Profile controller disconnected.');
			input += next.value;
		}
		if (input.trim() !== expected) throw new Error('Unexpected profile gate.');
	}
	B.prototype.run = async function (throws) {
		const trial = index++;
		// The pinned 1.0.34 representation supplies the collection index and name.
		// Validate it rather than silently losing group identity after a harness update.
		const identity = this as B & { readonly _group: number; readonly _name: string };
		if (typeof identity._group !== 'number' || typeof identity._name !== 'string') {
			throw new Error('Unsupported Mitata trial identity.');
		}
		console.log(
			JSON.stringify({
				phase: 'ready',
				trial,
				group: identity._group,
				name: identity._name,
				scope:
					'Real Mitata B.run: trial warmup, GC and all argument expansions included; calibration/setup/teardown excluded.',
				runtime: Deno.version,
			}),
		);
		await gate('start');
		const result = await original.call(this, throws);
		console.log(JSON.stringify({ phase: 'done', trial, result }));
		await gate('stop');
		return result;
	};
	return async () => {
		B.prototype.run = original;
		console.log(JSON.stringify({ phase: 'finished' }));
		await reader.cancel();
	};
}
