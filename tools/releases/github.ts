/** Complete GitHub release records after npm and JSR have both succeeded. @module */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Retain native errors; a missing release is not the same as failed authentication. */
function command(binary: string, args: string[]): string {
	const result = spawnSync(binary, args, { encoding: 'utf8' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr || `${binary} exited ${result.status}.`);
	return result.stdout.trim();
}

const repository = process.env.GITHUB_REPOSITORY;
if (!repository || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) throw new Error('Expected GITHUB_REPOSITORY.');
const token = process.env.GH_TOKEN;
if (!token) throw new Error('Expected GH_TOKEN for GitHub release records.');
const revision = command('git', ['rev-parse', 'HEAD']);
const tags = new Set(command('git', ['tag', '--points-at', revision]).split('\n'));
await mkdir('.tmp/releases', { recursive: true });
for (const entry of await readdir('packages', { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const manifest = JSON.parse(await readFile(resolve('packages', entry.name, 'package.json'), 'utf8'));
	if (manifest.private) continue;
	const tag = `${manifest.name}-v${manifest.version}`;
	if (!tags.has(tag)) continue;
	const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
	});
	await response.body?.cancel();
	if (response.ok) continue;
	if (response.status !== 404) throw new Error(`GitHub release lookup failed (${response.status}).`);
	const changelog = await readFile(resolve('packages', entry.name, 'CHANGELOG.md'), 'utf8');
	const sections = changelog.split(/^## /mu);
	if (sections[1]?.split('\n')[0]?.split(' ')[0] !== manifest.version) {
		throw new Error(`${manifest.name}: latest changelog does not describe ${manifest.version}.`);
	}
	const notes = resolve('.tmp/releases', `${entry.name}.md`);
	// Publish the newest version section, not the package's entire release history.
	await writeFile(notes, `## ${sections[1]}`);
	command('gh', [
		'release',
		'create',
		tag,
		'--verify-tag',
		'--title',
		tag,
		'--notes-file',
		notes,
		...(String(manifest.version).includes('-') ? ['--prerelease'] : []),
	]);
}
