/** Refuse stale or source-only npm candidates before asking Sampo to publish. @module */
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Validate every package before the first registry mutation.
 * Source manifests select the artifact directory. Candidate identities must agree with source;
 * otherwise a stale build could publish different contents under the selected release version.
 * CI also supplies these directories from the successful checks at the same immutable revision.
 */
export async function candidates(root: string): Promise<void> {
	for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const directory = resolve(root, 'packages', entry.name);
		const source = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
		if (source.private) continue;
		const expected = `../../.tmp/artifacts/npm/${entry.name}`;
		if (source.publishConfig?.directory !== expected || source.publishConfig?.linkDirectory !== false) {
			throw new Error(`${source.name}: publishConfig must select its tested artifact directory without linking it.`);
		}
		const artifact = JSON.parse(await readFile(resolve(directory, expected, 'package.json'), 'utf8'));
		if (artifact.name !== source.name || artifact.version !== source.version) {
			throw new Error(`${source.name}: artifact identity differs from source. Rebuild and retest the release.`);
		}
		if (artifact.publishConfig?.directory || artifact.type !== 'module') {
			throw new Error(`${source.name}: expected an ESM artifact without another publication redirect.`);
		}
	}
}

/** Sampo disables pnpm's Git checks, so repository publication must enforce a clean source revision itself. */
export function clean(root: string): void {
	const result = spawnSync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain'], {
		cwd: root,
		encoding: 'utf8',
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error('Publication requires a readable Git checkout.');
	if (result.stdout.trim()) throw new Error('Publication requires committed source with no untracked files.');
}
