/** Publish one explicit registry target only after validating the clean source and tested artifacts. @module */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { versions } from './versions.ts';
import { candidates, clean } from './candidates.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({
	options: {
		target: { type: 'string' },
		check: { type: 'boolean' },
		help: { type: 'boolean' },
	},
});
if (values.help) {
	console.log('Usage: mise run release:publish -- --target npm|jsr [--check]. --check is a registry dry run.');
} else {
	const target = z.enum(['npm', 'jsr']).parse(values.target);
	if (!values.check) clean(root);
	await versions(root);
	const changesets = new URL('../../.sampo/changesets/', import.meta.url);
	if (existsSync(changesets) && readdirSync(changesets).some((name) => name.endsWith('.md'))) {
		throw new Error('Prepare and merge the release versions before publishing pending changesets.');
	}
	if (target === 'npm') await candidates(root);
	const result = spawnSync(
		target === 'npm' ? 'pnpm' : 'deno',
		target === 'npm'
			? ['exec', 'sampo', 'publish', ...(values.check ? ['--dry-run'] : [])]
			: ['publish', '--frozen-lockfile', ...(values.check ? ['--dry-run', '--allow-dirty'] : [])],
		{ cwd: root, stdio: 'inherit' },
	);
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`Publication stopped with ${result.signal}.`);
	if (result.status !== 0) process.exit(result.status ?? 1);
}
