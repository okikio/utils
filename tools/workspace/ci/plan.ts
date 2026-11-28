/** Select work from ownership and dependency edges, rather than package-specific CI branches. @module */
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { packages } from '../../packages/source.ts';

/** A plan is data: CI validates it before choosing jobs or constructing commands. */
export const PlanSchema = z.strictObject({
	/** Serialization revision consumed by the workflow admission step. */
	version: z.literal(1),
	/** Paths below packages/, including nested owners; an empty list selects the complete graph. */
	projects: z.array(z.string()),
	/** Resource requirements are policy; pnpm separately owns package dependency reachability. */
	lanes: z.strictObject({
		source: z.boolean(),
		runtimes: z.boolean(),
		browser: z.boolean(),
		packages: z.boolean(),
		postgres: z.boolean(),
		containers: z.boolean(),
		interop: z.boolean(),
		benchmark: z.boolean(),
		docs: z.boolean(),
		examples: z.boolean(),
	}),
});
/** Validated lane decisions and source owners for one exact candidate. */
export type PlanType = z.infer<typeof PlanSchema>;

/** Unknown source ownership selects all lanes; documentation only selects its runnable examples. */
export function plan(
	paths: readonly string[],
	projects: readonly string[],
	full = false,
	consumers: readonly string[] = [],
): PlanType {
	const lanes = {
		source: false,
		runtimes: false,
		browser: false,
		packages: false,
		postgres: false,
		containers: false,
		interop: false,
		benchmark: false,
		docs: false,
		examples: false,
	};
	const selected = new Set<string>();
	// Removed or unclassified package owners require the complete remaining graph.
	const known = new Set(projects);
	// Native inventory owns paths. Prefer the nearest declared owner when packages are nested.
	const directories = [...projects].sort((left, right) => right.length - left.length);
	let broad = full;
	for (const path of paths) {
		if (path.startsWith('.tmp/')) continue;
		if (path.startsWith('examples/')) {
			lanes.examples = true;
			continue;
		}
		if (path.endsWith('.md')) {
			lanes.docs = true;
			continue;
		}
		const owner = directories.find((name) => path.startsWith(`packages/${name}/`));
		if (owner) selected.add(owner);
		else broad = true;
	}
	// pnpm supplies dependency reachability. The policy only decides which resource lanes those owners require.
	for (const name of consumers) {
		if (!known.has(name)) throw new TypeError(`Native CI selection returned an unknown source owner: ${name}.`);
		selected.add(name);
	}
	if (broad || selected.size > 0) {
		lanes.source =
			lanes.runtimes =
			lanes.browser =
			lanes.packages =
			lanes.benchmark =
				true;
		lanes.docs = lanes.examples = true;
		// These owners exercise persistent state and real process/stream recovery.
		lanes.postgres = lanes.containers = broad ||
			['storage', 'workflow', 'worker', 'server', 'streams', 'scheduler', 'context', 'capability'].some((name) =>
				selected.has(name)
			);
		// Every ORM, driver, pooler and compatible server runs the SQL package's statements; storage builds on it.
		lanes.interop = broad || selected.has('sql');
	}
	return { version: 1, projects: broad ? [] : [...selected].sort(), lanes };
}

/** Ask pnpm for transitive consumers, including development, optional and peer dependencies. */
export function affected(root: string, paths: readonly string[], full = false): PlanType {
	const owners = packages(root).map((member) => member.directory.slice('packages/'.length));
	if (owners.length === 0) throw new Error('CI requires the native public-package inventory.');
	const initial = plan(paths, owners, full);
	if (initial.projects.length === 0) return initial;
	const consumers = packages(root, initial.projects.map((name) => `...{./packages/${name}}`))
		.map((member) => member.directory.slice('packages/'.length));
	return plan(paths, owners, full, consumers);
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			base: { type: 'string' },
			head: { type: 'string' },
			full: { type: 'boolean' },
			help: { type: 'boolean' },
		},
	});
	if (values.help) {
		console.log('Usage: mise run ci:plan -- --base <full SHA> --head <full SHA>, or --full');
	} else {
		const root = fileURLToPath(new URL('../../../', import.meta.url));
		let paths: string[] = [];
		if (!values.full) {
			if (![values.base, values.head].every((value) => typeof value === 'string' && /^[a-f0-9]{40}$/iu.test(value))) {
				throw new TypeError('Affected planning requires full --base and --head commit hashes, or --full.');
			}
			// Both sides of a rename remain owners. Native Git supplies exact revision changes.
			const result = spawnSync('git', ['diff', '--no-renames', '--name-only', '-z', values.base!, values.head!], {
				cwd: root,
				encoding: 'utf8',
			});
			if (result.error) throw result.error;
			if (result.status !== 0) throw new Error(result.stderr);
			paths = result.stdout.split('\0').filter(Boolean);
		}
		const result = affected(root, paths, values.full);
		console.log(JSON.stringify(result, null, 2));
		if (process.env.GITHUB_OUTPUT) {
			appendFileSync(
				process.env.GITHUB_OUTPUT,
				[
					`projects=${JSON.stringify(result.projects)}`,
					...Object.entries(result.lanes).map(([name, selected]) => `${name}=${selected}`),
					'',
				].join('\n'),
			);
		}
		if (process.env.GITHUB_STEP_SUMMARY) {
			appendFileSync(
				process.env.GITHUB_STEP_SUMMARY,
				[
					'### Selected CI work',
					'',
					`Package owners: ${result.projects.join(', ') || 'all'}.`,
					'',
				].join('\n'),
			);
		}
	}
}
