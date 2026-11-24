/**
 * Every statement of the session, state and queue adapters matches its committed SQL, and PostgreSQL describes each one
 * against the installed schema. Set `UPDATE_SQL=1` to rewrite an adapter's `statements.sql` after an intended change,
 * then review the diff.
 */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import * as sql from '@okikio/sql/postgres';
import { temporal } from '@okikio/duration/temporal';
import * as queues from '@okikio/storage/queue/postgres';
import * as sessions from '@okikio/storage/session/postgres';
import * as states from '@okikio/storage/state/postgres';
import * as sessionTables from '../../packages/storage/session/schema.ts';
import * as sessionStatements from '../../packages/storage/session/statements.ts';
import * as stateTables from '../../packages/storage/state/schema.ts';
import * as stateStatements from '../../packages/storage/state/statements.ts';
import * as queueTables from '../../packages/storage/queue/schema.ts';
import * as queueStatements from '../../packages/storage/queue/statements.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Statement checks require a disposable PostgreSQL database.');
const client = postgres(url, { max: 2, onnotice() {} });
before(async () => {
	await sessions.migrate({ database: client });
	await states.migrate({ database: client });
	await queues.migrate({ database: client });
});
after(async () => {
	await client.end({ timeout: 2 });
});

/** A sample record and snapshot; `describe` never sends them. */
const record = {} as never;
const snapshot = { format: 1, contract: 'c', version: 'v', value: null } as never;
/** A sample claim and retention; `describe` never sends them. */
const claim = {
	id: '00000000-0000-0000-0000-000000000001',
	itemId: '00000000-0000-0000-0000-000000000002',
	owner: 'o',
};
const retention = { retained: 10, ttl: 1000 };
const id = '00000000-0000-0000-0000-000000000003';

/** Each adapter's catalog, the module whose exports it must cover, and its committed SQL. */
const adapters = {
	session: {
		module: sessionStatements,
		committed: new URL('../../packages/storage/session/statements.sql', import.meta.url),
		catalog: {
			'migration.lock': sessionTables.migrationLock,
			'migration.installed': sessionTables.installed,
			'migration.complete': sessionTables.complete,
			'migration.stored': sessionTables.stored,
			...Object.fromEntries(sessionTables.install.map((item, index) => [`migration.install.${index}`, item])),
			guard: sessionTables.guard('k'),
			timeout: sessionStatements.timeout(5000),
			now: sessionStatements.now,
			load: sessionStatements.load('n', 'i'),
			save: sessionStatements.save('n', 'i', record),
			remove: sessionStatements.remove('n', 'i'),
		},
	},
	state: {
		module: stateStatements,
		committed: new URL('../../packages/storage/state/statements.sql', import.meta.url),
		catalog: {
			'migration.lock': stateTables.migrationLock,
			'migration.installed': stateTables.installed,
			'migration.complete': stateTables.complete,
			'migration.stored': stateTables.stored,
			...Object.fromEntries(stateTables.install.map((item, index) => [`migration.install.${index}`, item])),
			begin: stateStatements.begin,
			commit: stateStatements.commit,
			rollback: stateStatements.rollback,
			timeout: stateStatements.timeout(5000),
			load: stateStatements.load('n', 'k'),
			create: stateStatements.create('n', 'k', snapshot),
			replace: stateStatements.replace('n', 'k', snapshot, 'v0'),
		},
	},
	queue: {
		module: queueStatements,
		committed: new URL('../../packages/storage/queue/statements.sql', import.meta.url),
		catalog: {
			'migration.lock': queueTables.migrationLock,
			...Object.fromEntries(queueTables.prepare.map((item, index) => [`migration.prepare.${index}`, item])),
			'migration.stored': queueTables.stored,
			...Object.fromEntries(queueTables.install.map((item, index) => [`migration.install.${index}`, item])),
			addPolicy: queueStatements.addPolicy({ namespace: 'n', contract: 'c', capacity: 1, retained: 1, ttl: 1 }),
			policy: queueStatements.policy('n'),
			'policy.locked': queueStatements.policy('n', true),
			lockItem: queueStatements.lockItem('n', id),
			keyed: queueStatements.keyed('n', 'k'),
			occupied: queueStatements.occupied('n'),
			add: queueStatements.add({ namespace: 'n', id, key: null, input: {}, priority: 0 }),
			'add.later': queueStatements.add({
				namespace: 'n',
				id,
				key: 'k',
				input: {},
				priority: 0,
				available: temporal.Instant.fromEpochMilliseconds(0),
			}),
			redrive: queueStatements.redrive('n', id, id, 'k'),
			item: queueStatements.item('n', id),
			claim: queueStatements.claim({ namespace: 'n', limit: 1, owner: 'o', lease: 1000 }),
			'claim.ref': queueStatements.claim({ namespace: 'n', ref: id, limit: 1, owner: 'o', lease: 1000 }),
			retry: queueStatements.retry('n', claim, { delay: 0 }),
			'retry.at': queueStatements.retry('n', claim, {
				delay: 0,
				available: temporal.Instant.fromEpochMilliseconds(0),
				priority: 1,
			}),
			renew: queueStatements.renew('n', claim, 1000),
			finish: queueStatements.finish('n', claim, { state: 'completed', output: {} }),
			'finish.failed': queueStatements.finish('n', claim, { state: 'failed', failure: {} }),
			cancel: queueStatements.cancel('n', id, null),
			'cancel.claim': queueStatements.cancel('n', id, 'r', claim),
			exists: queueStatements.exists('n', id),
			stats: queueStatements.stats('n'),
			last: queueStatements.last('n'),
			page: queueStatements.page('n', 0n, 10n, 10),
			prune: queueStatements.prune('n', retention, 10),
			more: queueStatements.more('n', retention),
		},
	},
} satisfies Record<string, { module: object; committed: URL; catalog: sql.CatalogType }>;

for (const [name, adapter] of Object.entries(adapters)) {
	describe(`${name} statements`, () => {
		it('covers every statement the module exports', () => {
			const covered = new Set(Object.keys(adapter.catalog).map((key) => key.split('.')[0]));
			expect(Object.keys(adapter.module).filter((key) => !covered.has(key))).toEqual([]);
		});

		it('match the committed SQL', () => {
			const text = sql.render(adapter.catalog);
			if (process.env.UPDATE_SQL === '1') writeFileSync(adapter.committed, text);
			expect(text).toBe(readFileSync(adapter.committed, 'utf8'));
		});

		it('parse, plan and return their declared columns against the installed schema', async () => {
			const problems = await sql.describe(adapter.catalog, async (text) => {
				const found = await client.unsafe(text).describe();
				return { parameters: found.types.length, columns: found.columns.map((column) => column.name) };
			});
			expect(problems).toEqual([]);
		});
	});
}
