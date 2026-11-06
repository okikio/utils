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
		benchmark: z.boolean(),
		docs: z.boolean(),
		examples: z.boolean(),
	}),
});
export type PlanType = z.infer<typeof PlanSchema>;

/** Minimal package facts needed to include consumers of a changed utility. */
export interface Project {
	readonly name: string;
	readonly dependencies: readonly string[];
}

/** Unknown source ownership selects all lanes; documentation only selects its runnable examples. */
export function plan(paths: readonly string[], projects: readonly Project[], full = false): PlanType {
	const lanes = {
		source: false,
		runtimes: false,
		browser: false,
		packages: false,
		postgres: false,
		containers: false,
		benchmark: false,
		docs: false,
		examples: false,
	};
	const selected = new Set<string>();
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
		if (match) selected.add(match[1]!);
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
	}
	return { version: 1, projects: broad ? [] : [...selected].sort(), lanes };
}
