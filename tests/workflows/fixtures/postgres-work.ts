/** Admit real SQL work with explicit host and attempt leases for recovery test. @module */
import type { Sql } from 'postgres';
import * as schema from '@okikio/schema';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as workflow from '@okikio/workflow';
import { identity } from '@okikio/workflow/execution';
import * as storage from '@okikio/storage/workflow/postgres';

/** Place fixture activities on the local engine; this declaration starts no worker. */
export const Local = engine.define({ id: 'test.renewal' });
/** A string identifies one producer. The test performs guarded writes under its admitted claim. */
export const Work = activity.define({
	id: 'test.renewal.write',
	version: '1',
	input: schema.string(),
	result: schema.string(),
	placement: engine.require(Local),
});

/**
 * Accept and claim one activity per producer without starting the scheduler.
 * `leaseMs` bounds current permission; `deadlineMs` bounds the whole attempt.
 * Both durations are milliseconds. Renewing permission does not move the deadline.
 *
 * The caller must renew the host and claims, then dispose the returned store.
 * The database pool remains borrowed. If setup fails, this function closes the store view.
 */
export async function admit(database: Sql, count: number, leaseMs: number, deadlineMs: number) {
	await storage.migrate({ database });
	const policy = workflow.PolicySchema.parse({
		id: 'test.renewal',
		version: '1',
		limits: {
			inputBytes: 4096,
			resultBytes: 4096,
			historyBytes: 16384,
			pendingRoots: 64,
			reservedSuccessors: 0,
			pendingChildren: 0,
			pendingFinalizers: 0,
		},
		claims: { leaseMs, renewEveryMs: Math.min(2000, Math.floor(leaseMs / 4)), recoverEveryMs: 1000 },
		activities: [{
			definition: Work,
			maxAttempts: 3,
			deadlineMs,
			retry: 'transient',
			delay: { initialMs: 50, maximumMs: 500 },
			recovery: 'retry',
			requires: ['postgres.transactions', 'postgres.receipts'],
		}],
		workflows: [],
		successors: [],
		finalizers: [],
		retention: { dedupeMs: 60000, resultsMs: 60000, auditMs: 60000 },
	});
	// Isolate saved jobs and receipts from other tests using the same database.
	const namespace = crypto.randomUUID();
	const store = storage.open({ database, namespace, notifications: false });
	try {
		const client = workflow.client({ store, policy });
		for (let index = 0; index < count; index++) {
			await client.trigger(Work, String(index), { scope: 'soak', key: String(index) });
		}
		const host = await store.register(
			'soak',
			[identity(Work)],
			Local.id,
			{ activations: count, activities: count },
			leaseMs,
		);
		// Use store-issued claims so the test exercises real permission checks, not fabricated tokens.
		const jobs = [];
		for (let index = 0; index < count; index++) {
			const job = await store.take(host, [identity(Work)]);
			if (job === undefined) throw new Error('Admitted activity was not claimable.');
			jobs.push(job);
		}
		return { store, host, jobs, namespace };
	} catch (error) {
		await store[Symbol.asyncDispose]();
		throw error;
	}
}

/**
 * Recognize connection loss and server shutdown for the fixture retry loop.
 * Retrying is safe only when the operation keeps the same receipt identity.
 * Schema, permission, and receipt-conflict errors must fail the test instead.
 */
export function transient(error: unknown): boolean {
	const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : '';
	return /^(?:CONNECTION_(?:CLOSED|DESTROYED|ENDED)|CONNECT_TIMEOUT|ECONNREFUSED|ECONNRESET|57P01|57P02|57P03)$/u.test(
		code,
	);
}

/**
 * Save one business row and its receipt together, or return the earlier receipt.
 * Reuse `id` after a lost reply: the earlier commit may already contain both rows.
 * The business table has no unique constraint, so duplicate writes remain visible
 * to reconciliation. The short SQL sleep adds contention while holding the transaction.
 */
export async function write(
	store: storage.StoreType,
	claim: Parameters<storage.StoreType['transaction']>[0],
	id: string,
) {
	return await store.transaction(claim, { key: id, input: id, result: schema.string() }, async (tx, receipt) => {
		// Check before writing: a committed receipt means the business insert already happened.
		const prior = await receipt.get();
		if (prior !== undefined) return prior;
		await tx`insert into test_writes values (${id},${'payload:' + id})`;
		await tx`select pg_sleep(0.003)`;
		return await receipt.save(id);
	});
}
