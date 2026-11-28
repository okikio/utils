/** Keep a wrapped driver's SQLSTATE visible in the interoperability report. @module */
import { it } from 'node:test';
import { expect } from '@std/expect';
import type { Database } from '@okikio/sql/postgres';
import { runCases } from './cases/mod.ts';

it('retains the database cause of an aborted transaction', async () => {
	const cause = Object.assign(new Error('retry transaction'), {
		code: '40001',
	});
	const error = new Error('transaction aborted', { cause });
	let calls = 0;
	const db: Database = {
		run: async () => {
			if (++calls === 2) throw error;
			return [];
		},
		begin: async () => {
			throw new Error('unused transaction');
		},
	};
	const [outcome] = await runCases(db, 'diagnostics', {
		only: new Set(['create schema']),
	});
	expect(outcome?.status).toBe('fail');
	expect(outcome?.detail).toContain('transaction aborted');
	expect(outcome?.detail).toContain('retry transaction');
	expect(outcome?.detail).toContain('40001');
});
