/**
 * Every outbox statement matches its committed SQL, and PostgreSQL describes each one against the installed schema.
 * The outbox also runs through a client that takes only `$1` text and values, as many drivers and ORMs do.
 *
 * Set `UPDATE_SQL=1` to rewrite `packages/storage/outbox/statements.sql` after an intended change, then review the diff.
 */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import * as sql from '@okikio/sql/postgres';
import * as outbox from '@okikio/storage/outbox/postgres';
import * as statements from '../../packages/storage/outbox/statements.ts';
import * as tables from '../../packages/storage/outbox/schema.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Outbox statement checks require a disposable PostgreSQL database.');
const client = postgres(url, { max: 4, onnotice() {} });
before(async () => {
	await outbox.migrate({ database: client });
});
after(async () => {
	await client.end({ timeout: 2 });
});

const key = { namespace: 'n', id: 'i', key: 'k' };
/** Every statement with sample values, including each optional form. Values are never sent by `describe`. */
const catalog: sql.CatalogType = {
	'migration.lock': tables.migrationLock,
	...Object.fromEntries(tables.prepare.map((item, index) => [`migration.prepare.${index}`, item])),
	'migration.stored': tables.stored,
	...Object.fromEntries(
		tables.install.map((item, index) => [`migration.install.${String(index).padStart(2, '0')}`, item]),
	),
	guard: statements.guard('n'),
	now: statements.now,
	addPolicy: statements.addPolicy('n', { maximum: 1, bytes: 1, attempts: 1 }),
	policy: statements.policy('n'),
	'policy.locked': statements.policy('n', true),
	setMaximum: statements.setMaximum('n', 2),
	payload: statements.payload(key),
	size: statements.size('n'),
	insert: statements.insert({ ...key, value: null, time: 0 }),
	lease: statements.lease(key),
	settle: statements.settle({ ...key, state: 'pending', due: 0, time: 0, failure: null }),
	exhaust: statements.exhaust('n', 0, 1),
	candidates: statements.candidates('n', { time: 0, attempts: 1, limit: 1 }),
	reserve: statements.reserve({ ...key, token: 't', attempt: 1, expires: 0, time: 0 }),
	extend: statements.extend({ ...key, expires: 0, time: 0 }),
	inspect: statements.inspect(key),
	page: statements.page('n', { limit: 1 }),
	'page.filtered': statements.page('n', { state: 'failed', after: { id: 'i', key: 'k' }, limit: 1 }),
	addRepair: statements.addRepair({ ...key, attempt: 1, actor: 'a', reason: 'r', time: 0 }),
	redrive: statements.redrive({ ...key, time: 0 }),
	history: statements.history({ ...key, after: 0, limit: 1 }),
	prune: statements.prune('n', { before: 0, limit: 1 }),
	completed: statements.completed('n', { before: 0, limit: 1 }),
	'completed.where': statements.completed('n', { before: 0, limit: 1, where: tables.messages.c.key.ne('x') }),
	retire: statements.retire({ ...key, before: 0 }),
};
const committed = new URL('../../packages/storage/outbox/statements.sql', import.meta.url);

describe('outbox statements', () => {
	it('covers every statement the module exports', () => {
		const covered = new Set(Object.keys(catalog).map((name) => name.split('.')[0]));
		expect(Object.keys(statements).filter((name) => !covered.has(name))).toEqual([]);
	});

	it('match the committed SQL', () => {
		const text = sql.render(catalog);
		if (process.env.UPDATE_SQL === '1') writeFileSync(committed, text);
		expect(text).toBe(readFileSync(committed, 'utf8'));
	});

	it('parse, plan and return their declared columns against the installed schema', async () => {
		const problems = await sql.describe(catalog, async (text) => {
			const found = await client.unsafe(text).describe();
			return { parameters: found.types.length, columns: found.columns.map((column) => column.name) };
		});
		expect(problems).toEqual([]);
	});

	it('migration statements run again on an installed schema', async () => {
		await outbox.migrate({ database: client });
	});
});

/** A client with no tag: it takes `$1` text and values. */
function plain(target: postgres.Sql | postgres.TransactionSql): sql.Executor {
	return { run: async (query) => await target.unsafe(query.text, query.values as never[]) };
}
const text: sql.Database = { ...plain(client), begin: (work) => client.begin((tx) => work(plain(tx))) as never };

describe('outbox through a text-only client', () => {
	it('appends inside the caller transaction, delivers, completes and retires through that client', async () => {
		const namespace = `plain-${crypto.randomUUID()}`;
		const box = outbox.open({ database: text, namespace, maximum: 10 });
		await client.begin(async (tx) => {
			await box.append(plain(tx), { id: 'note.saved', key: 'one', value: { title: 'Read later', tags: null } });
			// A JSON null payload stays JSON, not SQL NULL, and a string payload is not encoded twice.
			await box.append(plain(tx), { id: 'note.saved', key: 'null', value: null });
			await box.append(plain(tx), { id: 'note.saved', key: 'text', value: 'plain' });
		});
		await expect(box.append(text, { id: 'note.saved', key: 'one', value: { title: 'Changed' } })).rejects.toThrow(
			outbox.OutboxError,
		);
		const claims = await box.claim({ limit: 3 });
		expect(claims.map((claim) => [claim.key, claim.value])).toEqual([
			['one', { title: 'Read later', tags: null }],
			['null', null],
			['text', 'plain'],
		]);
		for (const claim of claims) await box.complete(claim);
		const later = Date.now() + 60_000;
		const found = await box.completed({ before: later, where: outbox.messages.c.key.ne('text') });
		expect(found.map((item) => item.key)).toEqual(['one', 'null']);
		await client.begin(async (tx) => {
			for (const item of found) expect(await box.remove(plain(tx), item, later)).toBe(true);
		});
		expect(await box.inspect('note.saved', 'one')).toBeUndefined();
		expect(await box.inspect('note.saved', 'text')).toBe('complete');
	});
});
