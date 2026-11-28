/** Read workspace identities from pnpm, the owner of package discovery and dependency selection. @module */
import { spawnSync } from 'node:child_process';
import { relative, sep } from 'node:path';
import { z } from 'zod';

/** The native listing can contain root, tools and example owners as transitive consumers. */
const ListingSchema = z.array(z.object({
	/** Declared package identity; filters may instead select native paths or globs. */
	name: z.string().min(1),
	/** Absolute directory reported by the selected native workspace. */
	path: z.string().min(1),
	/** npm's publication guard excludes private source fixtures from public package operations. */
	private: z.boolean(),
}));

/** A public source package keeps its registry identity separate from its repository directory. */
export interface Package {
	/** Published identity from the selected package manifest. */
	readonly name: string;
	/** Absolute owner directory returned by pnpm. */
	readonly path: string;
	/** Repository-relative source directory, such as `packages/http`. */
	readonly directory: string;
}

/**
 * Use native name, path, glob or dependency filters without rebuilding pnpm's graph.
 *
 * Only public source owners below `packages/` are returned. Root compositions,
 * tools and examples retain their separate CI lanes even when pnpm reports them
 * as dependents. A missing selector or failed native listing remains an error.
 */
export function packages(root: string, filters: readonly string[] = ['./packages/**']): readonly Package[] {
	const result = spawnSync('pnpm', [
		...filters.flatMap((filter) => ['--filter', filter]),
		'--fail-if-no-match',
		'list',
		'--depth',
		'-1',
		'--json',
	], { cwd: root, encoding: 'utf8' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Native package selection failed: ${result.stderr}`);
	const selected = ListingSchema.parse(JSON.parse(result.stdout)).flatMap((member) => {
		const directory = relative(root, member.path).split(sep).join('/');
		return !member.private && directory.startsWith('packages/')
			? [{ name: member.name, path: member.path, directory }]
			: [];
	}).sort((left, right) => left.directory.localeCompare(right.directory));
	if (selected.length === 0) throw new Error('Native selection contains no public source package.');
	return selected;
}
