/** Claim a fresh output directory so benchmark runs never replace retained evidence. @module */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Atomic ownership admits one writer and rejects any existing directory or file. */
export async function claimOutput(path: string): Promise<void> {
	const target = resolve(path);
	await mkdir(dirname(target), { recursive: true });
	try {
		await mkdir(target);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
			throw new Error(`Benchmark output already exists: ${target}. Choose a fresh directory.`, { cause: error });
		}
		throw error;
	}
}
