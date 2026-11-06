/** Protect affected-work selection: a skipped resource lane must be a deliberate decision. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { plan, PlanSchema } from './ci.ts';

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
	it('selects all lanes for lock, task, or unclassified source changes', () => {
		for (const path of ['pnpm-lock.yaml', 'mise.toml', 'new-owner/module.ts']) {
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
});
