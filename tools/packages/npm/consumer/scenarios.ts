/** Execute authored cross-package scenarios against the installed artifact graph. @module */
import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'tsdown';
import { command } from '../command.ts';
import type { SourceType } from '../source.ts';

/** Reuse real cross-package source scenarios while resolving every production import to installed archives. */
export async function scenarios(workspace: SourceType, directory: string): Promise<void> {
	const { root, scenarioSources } = workspace;

	const names = Object.keys(scenarioSources);
	const entry: Record<string, string> = {};
	for (const [name, path] of Object.entries(scenarioSources)) {
		const source = resolve(root, path);
		const target = resolve(directory, `scenario-${name}.test.ts`);
		await cp(source, target);
		entry[`scenario-${name}.test`] = target;
	}
	const results = (await build({
		config: false,
		cwd: directory,
		entry,
		outDir: resolve(directory, 'scenarios'),
		format: ['esm'],
		platform: 'node',
		target: 'esnext',
		dts: false,
		clean: true,
		publint: false,
		attw: false,
		deps: { neverBundle: [/^@okikio\//, /^node:/] },
	})).bundles;
	for (const format of ['mjs']) {
		command(workspace, 'node', [
			'--import',
			'@okikio/dispose/polyfill',
			'--import',
			'@okikio/duration/polyfill',
			'--test',
			...names.map((name) => resolve(directory, `scenarios/scenario-${name}.test.${format}`)),
		], directory);
	}
	for (const result of results) await result[Symbol.asyncDispose]();
	console.log(
		'Installed ESM artifacts passed discovery, coordination, HTTP host, workflow, durable client, provider ownership, bounded mapper failures and independent Hono parity scenarios.',
	);
}
