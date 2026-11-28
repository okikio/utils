/** Protect affected-work selection: a skipped resource lane must be a deliberate decision. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { fileURLToPath } from 'node:url';
import { affected, plan, PlanSchema } from './plan.ts';

const projects = ['result', 'http', 'server', 'utils'];

describe('affected CI work', () => {
	it('checks guide examples without opening a database or browser', () => {
		const result = plan(['docs/server/04-http.md'], projects);
		expect(result.lanes.docs).toBe(true);
		expect(result.lanes.postgres).toBe(false);
		expect(result.lanes.containers).toBe(false);
		expect(result.lanes.interop).toBe(false);
		expect(result.lanes.browser).toBe(false);
	});
	it('includes transitive consumers of a changed utility', () => {
		const result = plan(['packages/result/mod.ts'], projects, false, ['http', 'server', 'utils']);
		expect(result.projects).toEqual(['http', 'result', 'server', 'utils']);
		expect(result.lanes.packages).toBe(true);
		expect(result.lanes.containers).toBe(true);
		expect(result.lanes.interop).toBe(false);
	});
	it('runs every client and compatible server when the SQL package or its consumers change', () => {
		const result = plan(['packages/sql/postgres/json.ts'], ['sql', 'storage'], false, ['storage']);
		expect(result.lanes.interop).toBe(true);
		expect(plan(['tests/interop/expectations.ts'], projects).lanes.interop).toBe(true);
		expect(plan(['packages/storage/mod.ts'], ['storage']).lanes.interop).toBe(false);
	});
	it('uses the installed native dependency graph, including development consumers', () => {
		const root = fileURLToPath(new URL('../../../', import.meta.url));
		const result = affected(root, ['packages/duration/mod.ts']);
		expect(result.projects).toContain('server');
		expect(result.projects).toContain('utils');
		expect(result.lanes.postgres).toBe(true);
		expect(result.lanes.containers).toBe(true);
	});

	it('selects all lanes for lock, task, or unclassified source changes', () => {
		for (const path of ['pnpm-lock.yaml', 'mise.toml', 'new-owner/module.ts', 'packages/removed/mod.ts']) {
			const result = plan([path], projects);
			expect(result.projects).toEqual([]);
			expect(Object.values(result.lanes).every(Boolean)).toBe(true);
		}
	});
	it('accepts native consumers without reproducing graph traversal', () => {
		const result = plan(['packages/new/mod.ts'], ['new', 'consumer'], false, ['consumer', 'new']);
		expect(result.projects).toEqual(['consumer', 'new']);
		expect(result.lanes.source).toBe(true);
		expect(() => plan(['packages/new/mod.ts'], ['new'], false, ['missing'])).toThrow(TypeError);
	});

	it('assigns a changed file to its nearest declared native owner', () => {
		const result = plan(['packages/group/nested/value.ts'], ['group', 'group/nested', 'unrelated']);
		expect(result.projects).toEqual(['group/nested']);
		expect(result.lanes.source).toBe(true);
	});

	it('selects native example checks and rejects unrecognized serialized plan fields', () => {
		expect(plan(['examples/mcp/server.ts'], projects).lanes.examples).toBe(true);
		expect(() => PlanSchema.parse({ ...plan([], projects), typo: true })).toThrow();
	});
	it('selects every affected lane, including the Docker and documentation lanes', () => {
		for (const complete of [plan(['pnpm-lock.yaml'], projects), plan([], projects, true)]) {
			expect(Object.values(complete.lanes).every(Boolean)).toBe(true);
		}
	});
});
