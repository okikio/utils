/** A cell's key must hold what the cell runs and nothing else, and the ledger must never turn bad input into a skip. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import path from 'node:path';
import { cells } from './keys.ts';
import { empty, merge, parse, prune } from './ledger.ts';
import { closure, parseLock, snapshotKey } from './lock.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const all = await cells(root);
const cell = (target: string, client: string) => {
	const found = all.find((item) => item.target === target && item.client === client);
	if (!found) throw new Error(`No cell ${target} × ${client}.`);
	return found;
};

describe('interop cell keys', () => {
	it('keys every target and client pair the suite runs, each differently', () => {
		expect(all.length).toBeGreaterThan(300);
		expect(new Set(all.map((item) => item.key)).size).toBe(all.length);
		expect(all.filter((item) => item.target === 'pglite').map((item) => item.client)).toEqual(['pglite']);
		expect(all.every((item) => item.target !== 'neon-proxy' || item.client.includes('neon'))).toBe(true);
	});

	it("holds a client's own module and the package entry points it imports, not other clients'", () => {
		const postgresjs = cell('postgres-18', 'postgresjs').files;
		expect(postgresjs).toContain('tests/interop/clients/postgresjs.ts');
		expect(postgresjs).toContain('packages/sql/postgres/postgresjs.ts');
		expect(postgresjs).not.toContain('tests/interop/clients/drizzle.ts');
		expect(postgresjs).not.toContain('packages/sql/postgres/pg.ts');
		expect(postgresjs).not.toContain('packages/sql/postgres/drizzle/run.ts');
		const drizzle = cell('postgres-18', 'drizzle').files;
		expect(drizzle).toContain('packages/sql/postgres/drizzle/run.ts');
		expect(drizzle).not.toContain('tests/interop/clients/postgresjs.ts');
	});

	it("follows only a cell's own runtime client from runtime.ts", () => {
		const bun = cell('postgres-18', 'bun-sql').files;
		expect(bun).toContain('tests/interop/runtime.ts');
		expect(bun).toContain('tests/interop/clients/bun.ts');
		expect(bun).not.toContain('tests/interop/clients/deno.ts');
		expect(cell('postgres-18', 'deno-postgres').files).not.toContain('tests/interop/clients/bun.ts');
	});

	it("holds a target's own module and declared files, and replaces registries, limits and image pins", () => {
		const postgres = cell('postgres-18', 'pg').files;
		expect(postgres).not.toContain('tests/interop/targets/cockroach.ts');
		expect(postgres).not.toContain('tests/interop/expectations.ts');
		expect(postgres).not.toContain('tests/interop/targets/images.ts');
		expect(postgres).not.toContain('tests/interop/clients/mod.ts');
		expect(cell('cockroachdb', 'pg').files).toContain('tests/interop/targets/cockroach.ts');
		expect(cell('supavisor-session', 'pg').files).toContain('tests/interop/targets/supabase/pooler.exs');
		expect(cell('postgres-18', 'prisma').files).toContain('tests/interop/prisma/schema.prisma');
		expect(cell('postgres-18', 'prisma').packages).toContain('tests/interop @prisma/client');
	});

	it("keys a cell by the npm packages its imports reach, so one library's update reruns only its cells", () => {
		expect(cell('postgres-18', 'knex').packages).toContain('tests/interop knex');
		expect(cell('postgres-18', 'postgresjs').packages).not.toContain('tests/interop knex');
	});
});

describe('pnpm lock closure', () => {
	const lock = parseLock([
		'---',
		"lockfileVersion: '9.0'",
		'',
		'importers:',
		'',
		'  .:',
		'    devDependencies:',
		'      a:',
		'        specifier: ^1.0.0',
		'        version: 1.0.0(c@3.0.0)',
		"      '@std/x':",
		'        specifier: npm:@jsr/std__x@1',
		"        version: '@jsr/std__x@1.0.2'",
		'      local:',
		'        specifier: workspace:*',
		'        version: link:packages/local',
		'',
		'snapshots:',
		'',
		'  a@1.0.0(c@3.0.0):',
		'    dependencies:',
		'      b: 2.0.0',
		'',
		'  b@2.0.0: {}',
		"  '@jsr/std__x@1.0.2': {}",
	].join('\n'));

	it('follows a dependency through its snapshots, and stops at workspace links', () => {
		expect(closure(lock, '.', 'a')).toEqual(['a@1.0.0(c@3.0.0)', 'b@2.0.0']);
		expect(closure(lock, '.', '@std/x')).toEqual(['@jsr/std__x@1.0.2']);
		expect(closure(lock, '.', 'local')).toEqual([]);
		expect(() => closure(lock, '.', 'undeclared')).toThrow('does not declare');
	});

	it('reads an alias version as its own snapshot key and a peer suffix as a version', () => {
		expect(snapshotKey('@std/x', '@jsr/std__x@1.0.2')).toBe('@jsr/std__x@1.0.2');
		expect(snapshotKey('knex', '3.3.0(pg@8.23.1)')).toBe('knex@3.3.0(pg@8.23.1)');
	});
});

describe('interop ledger', () => {
	const key = (n: number) => `interop-v1-${String(n).padStart(64, '0')}`;
	const pass = (at: string) => ({ target: 't', client: 'c', sha: 'a'.repeat(40), run: '1', at });

	it('refuses anything that is not a ledger, so bad input means run, never skip', () => {
		expect(() => parse('{"version":2,"cells":{}}')).toThrow(TypeError);
		expect(() => parse(JSON.stringify({ version: 1, cells: { bogus: pass('2026-01-01T00:00:00Z') } }))).toThrow(
			TypeError,
		);
		expect(parse(JSON.stringify({ version: 1, cells: { [key(1)]: pass('2026-01-01T00:00:00Z') } })).cells[key(1)])
			.toBeDefined();
	});

	it('keeps the latest pass of a key and drops old keys no current cell has', () => {
		const merged = merge(
			{ version: 1, cells: { [key(1)]: pass('2026-01-01T00:00:00Z') } },
			{ version: 1, cells: { [key(1)]: pass('2026-02-01T00:00:00Z'), [key(2)]: pass('2025-01-01T00:00:00Z') } },
			empty,
		);
		expect(merged.cells[key(1)]!.at).toBe('2026-02-01T00:00:00Z');
		const kept = prune(merged, new Set([key(1)]), new Date('2026-06-01T00:00:00Z'));
		expect(Object.keys(kept.cells)).toEqual([key(1)]);
		expect(Object.keys(prune(merged, new Set(), new Date('2025-02-01T00:00:00Z')).cells).length).toBe(2);
	});
});
