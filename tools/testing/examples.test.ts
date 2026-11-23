/** The README example runner must grant every option default that the installed PostgreSQL driver reads. */
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { expect } from '@std/expect';
import { postgresDefaults } from './examples.ts';

/** Postgres.js names variables for credentials and connection targets; an example passes its own. */
const connection = new Set(['PGHOST', 'PGUSER', 'PGUSERNAME', 'PGPASSWORD', 'PGPASSFILE', 'PGDATABASE']);

it('grants every option default that the installed Postgres.js reads', () => {
	const source = readFileSync(new URL('../../node_modules/postgres/src/index.js', import.meta.url), 'utf8');
	const block = /const defaults = \{([\s\S]*?)\n {2}\}/.exec(source)?.[1];
	expect(block).toBeDefined();
	// Each default key becomes `PG` plus the key in upper case; literal reads cover the rest.
	const keys = [...block!.matchAll(/^\s+([a-z_]+)\s*:/gm)].map((match) => `PG${match[1]!.toUpperCase()}`);
	const literal = [...source.matchAll(/env(?:\.|\[')(PG[A-Z_]+)/g)].map((match) => match[1]!);
	const read = [...new Set([...keys, ...literal])].filter((name) => !connection.has(name)).sort();
	expect(keys.length).toBeGreaterThan(10);
	expect(read.filter((name) => !postgresDefaults.includes(name))).toEqual([]);
});
