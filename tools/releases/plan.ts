/** Preview Sampo's release plan, or prepare versions when the caller explicitly selects --write. @module */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { versions } from './versions.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { write: { type: 'boolean' }, help: { type: 'boolean' } } });
if (values.help) {
	console.log('Usage: mise run release, or mise run release:version to prepare versions. Neither command publishes.');
} else {
	const directory = new URL('../../.sampo/changesets/', import.meta.url);
	const pending = existsSync(directory) && readdirSync(directory).some((name) => name.endsWith('.md'));
	if (!values.write || !pending) await versions(root);
	if (!pending) console.log('No pending changesets. Package versions are in sync.');
	else {
		// Read-only previews target main. Writes retain Sampo's own release-branch admission.
		const result = spawnSync('pnpm', ['exec', 'sampo', 'release', ...(values.write ? [] : ['--dry-run'])], {
			cwd: root,
			stdio: 'inherit',
			env: values.write ? process.env : { ...process.env, SAMPO_RELEASE_BRANCH: 'main' },
		});
		if (result.error) throw result.error;
		if (result.signal) throw new Error(`Sampo stopped with ${result.signal}.`);
		if (result.status !== 0) process.exit(result.status ?? 1);
		if (values.write) await versions(root, true);
	}
}
