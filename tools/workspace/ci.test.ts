/** Protect affected-work selection: a skipped resource lane must be a deliberate decision. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readdirSync, readFileSync } from 'node:fs';
import { plan, PlanSchema, projectFromManifest } from './ci.ts';

const projects = [
	{ name: 'result', dependencies: [] },
	{ name: 'http', dependencies: ['result'] },
	{ name: 'server', dependencies: ['http'] },
	{ name: 'utils', dependencies: ['server'] },
];

describe('affected CI work', () => {
	it('checks guide examples without opening a database or browser', () => {
		const result = plan(['docs/server/04-http.md'], projects);
		expect(result.lanes.docs).toBe(true);
		expect(result.lanes.postgres).toBe(false);
		expect(result.lanes.containers).toBe(false);
		expect(result.lanes.browser).toBe(false);
	});
	it('includes transitive consumers of a changed utility', () => {
		const result = plan(['packages/result/mod.ts'], projects);
		expect(result.projects).toEqual(['http', 'result', 'server', 'utils']);
		expect(result.lanes.packages).toBe(true);
		expect(result.lanes.containers).toBe(true);
	});
	it('traverses current package names and development consumers after the registry scope rename', () => {
		const packageRoot = new URL('../../packages/', import.meta.url);
		const current = readdirSync(packageRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((
			entry,
		) =>
			projectFromManifest(
				entry.name,
				JSON.parse(readFileSync(new URL(`${entry.name}/package.json`, packageRoot), 'utf8')),
			)
		);
		const result = plan(['packages/duration/mod.ts'], current);
		expect(result.projects).toContain('server');
		expect(result.projects).toContain('utils');
		expect(result.lanes.postgres).toBe(true);
		expect(result.lanes.containers).toBe(true);
		expect(
			projectFromManifest('consumer', {
				devDependencies: { '@okikio/duration': 'workspace:*', external: '1.0.0' },
				optionalDependencies: { '@okikio/result': 'workspace:*' },
				peerDependencies: { '@okikio/http': 'workspace:*' },
			}).dependencies,
		).toEqual(['duration', 'result', 'http']);
	});
	it('selects all lanes for lock, task, or unclassified source changes', () => {
		for (const path of ['pnpm-lock.yaml', 'mise.toml', 'new-owner/module.ts', 'packages/removed/mod.ts']) {
			const result = plan([path], projects);
			expect(result.projects).toEqual([]);
			expect(Object.values(result.lanes).every(Boolean)).toBe(true);
		}
	});
	it('includes new packages without a CI branch and terminates dependency cycles', () => {
		const result = plan(['packages/new/mod.ts'], [{ name: 'new', dependencies: ['consumer'] }, {
			name: 'consumer',
			dependencies: ['new'],
		}]);
		expect(result.projects).toEqual(['consumer', 'new']);
		expect(result.lanes.source).toBe(true);
	});
	it('selects native example checks and rejects unrecognized serialized plan fields', () => {
		expect(plan(['examples/mcp/server.ts'], projects).lanes.examples).toBe(true);
		expect(() => PlanSchema.parse({ ...plan([], projects), typo: true })).toThrow();
	});
	it('defers measured costly PR jobs while retaining main and explicit full coverage', () => {
		const automatic = plan(['pnpm-lock.yaml'], projects, false, true);
		expect(automatic.deferred).toEqual(['runtimes', 'packages', 'postgres', 'containers', 'docs']);
		for (const lane of automatic.deferred) expect(automatic.lanes[lane]).toBe(false);
		for (const lane of ['source', 'browser', 'benchmark', 'examples'] as const) {
			expect(automatic.lanes[lane]).toBe(true);
		}
		for (const complete of [plan(['pnpm-lock.yaml'], projects), plan([], projects, true, true)]) {
			expect(complete.deferred).toEqual([]);
			expect(Object.values(complete.lanes).every(Boolean)).toBe(true);
		}
	});
});
