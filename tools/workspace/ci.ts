/** Select work from ownership and dependency edges, rather than package-specific CI branches. @module */
import { z } from 'zod';

/** A plan is data: CI validates it before choosing jobs or constructing commands. */
export const PlanSchema = z.strictObject({
	version: z.literal(1),
	projects: z.array(z.string()),
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
export type PlanType = z.infer<typeof PlanSchema>;

/** Minimal package facts needed to include consumers of a changed utility. */
export interface Project {
	/** Directory name beneath packages/, independent of its registry scope. */
	readonly name: string;
	/** Local consumers include test-only, optional and peer dependencies. */
	readonly dependencies: readonly string[];
}

/** Native package manifests describe both published and development consumers. */
interface PackageManifest {
	/** Runtime dependencies used by the package. */
	readonly dependencies?: Readonly<Record<string, string>>;
	/** Test and build dependencies also require checks when their owner changes. */
	readonly devDependencies?: Readonly<Record<string, string>>;
	/** Optional dependencies can still be selected by a supported consumer. */
	readonly optionalDependencies?: Readonly<Record<string, string>>;
	/** Peer dependencies are supplied by the installed consumer. */
	readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** Remove the actual registry scope so a scope rename cannot truncate owner names. */
export function projectFromManifest(name: string, manifest: PackageManifest): Project {
	const scope = '@okikio/';
	return {
		name,
		dependencies: Object.keys({
			...manifest.dependencies,
			...manifest.devDependencies,
			...manifest.optionalDependencies,
			...manifest.peerDependencies,
		}).filter((dependency) => dependency.startsWith(scope)).map((dependency) => dependency.slice(scope.length)),
	};
}

/** Unknown source ownership selects all lanes; documentation only selects its runnable examples. */
export function plan(
	paths: readonly string[],
	projects: readonly Project[],
	full = false,
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
	const known = new Set(projects.map((project) => project.name));
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
		const match = /^packages\/([^/]+)\//u.exec(path);
		if (match && known.has(match[1]!)) selected.add(match[1]!);
		else broad = true;
	}
	// Include consumers until no new package is reachable. Cycles cannot loop here.
	let added = true;
	while (added) {
		added = false;
		for (const project of projects) {
			if (!selected.has(project.name) && project.dependencies.some((name) => selected.has(name))) {
				selected.add(project.name);
				added = true;
			}
		}
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
