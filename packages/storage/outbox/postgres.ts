/** Transactional acceptance and fenced, at-least-once delivery over a borrowed Postgres.js pool. Imports issue no SQL. @module */
import type { Sql, TransactionSql } from 'postgres';
import * as schema from '@okikio/schema';
import * as json from '@okikio/collection/record/json';

/** Bound namespace, definition and occurrence keys before a database transaction acquires locks. */
const NameSchema = schema.string({ minLength: 1, maxLength: 512 });
/** PostgreSQL text OID. Prevent the driver from JSON-encoding canonical JSON text a second time. */
const TextOid = 25;
/** A logical message key is unique within its namespace and definition ID. Payloads must be finite JSON. */
export interface MessageType {
	/** Exact message/effect definition ID used to select a trusted decoder. */
	readonly id: string;
	/** Stable occurrence key within that definition and namespace; retries reuse it. */
	readonly key: string;
	/** Finite JSON payload, including JSON null. Live objects and SQL NULL are not payload values. */
	readonly value: unknown;
}
/** A detached receipt; the token grants no authorization and only fences one dispatch attempt. */
export interface ClaimType extends MessageType {
	/** Fresh reservation fence; an expired or replaced token cannot acknowledge delivery. */
	readonly token: string;
	/** One-based delivery attempt, including claims whose sink never replied. */
	readonly attempt: number;
	/** Namespace prevents an otherwise matching claim from crossing application partitions. */
	readonly namespace: string;
}
/** Retained delivery state. Completion means the sink accepted, not that arbitrary external effects were exactly once. */
export const StateSchema: schema.JsonReader<
	'complete' | 'pending' | 'leased' | 'failed',
	'complete' | 'pending' | 'leased' | 'failed'
> = schema.oneOf(['pending', 'leased', 'complete', 'failed']);
/** Validated retained state, read without extending the current delivery lease. */
export type StateType = schema.Output<typeof StateSchema>;
/** Bounded shared admission policy; every view of a namespace must agree. */
export interface Options {
	/** Application-owned pool, borrowed for short transactions and never closed by the outbox. */
	readonly database: Sql;
	/** Application partition, not an authorization boundary; all views must share the same policy. */
	readonly namespace: string;
	/** Includes retained terminal messages. Prune explicitly to release capacity. @default 10000 */
	readonly maximum?: number;
	/** Canonical JSON payload limit, at most 16 MiB. @default 1048576 */
	readonly maximumBytes?: number;
	/** Exhausted expired/retried claims become failed and are never silently redriven. @default 8 */
	readonly maximumAttempts?: number;
}
/** Stable contract violations; SQL connection/commit failures remain native and can have uncertain outcomes. */
export class OutboxError extends Error {
	/** Stable failure classification; do not parse the diagnostic message. */
	readonly code: 'conflict' | 'capacity' | 'policy' | 'stale';
	constructor(code: OutboxError['code']) {
		super(`Transactional outbox ${code}.`);
		this.name = 'OutboxError';
		this.code = code;
	}
}
/** Install only this adapter's revision. Applications own running migrations and transaction pools. */
export async function migrate({ database }: { readonly database: Sql }): Promise<void> {
	await database.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(776161007)`;
		await tx`create schema if not exists utils_outbox`;
		await tx`create table if not exists utils_outbox.version (id boolean primary key check(id), revision integer not null)`;
		await tx`insert into utils_outbox.version values (true,1) on conflict do nothing`;
		if ((await tx`select revision from utils_outbox.version where id`)[0]?.revision !== 1) {
			throw new TypeError('Unsupported outbox schema revision.');
		}
		await tx`create table if not exists utils_outbox.policies (namespace text primary key, maximum integer not null, bytes integer not null, attempts integer not null)`;
		await tx`create table if not exists utils_outbox.messages (
			namespace text not null, id text not null, key text not null, value jsonb not null,
			state text not null check(state in ('pending','leased','complete','failed')),
			attempt integer not null default 0, token text, expires double precision,
			due double precision not null, updated double precision not null,
			primary key(namespace,id,key))`;
		await tx`create index if not exists outbox_ready on utils_outbox.messages(namespace,state,due)`;
	});
}
/** Reject unbounded durations/counts before obtaining database ownership. @internal */
function count(value: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Outbox bound is invalid.');
	return value;
}
/** Database time is read after serialization, so an expired claim cannot acknowledge a late sink result. @internal */
async function now(tx: TransactionSql): Promise<number> {
	return Number((await tx`select extract(epoch from clock_timestamp()) * 1000 as now`)[0]!.now);
}
/**
 * Create an inert namespace view. append() borrows the application's existing transaction;
 * it never commits it. All other operations own short transactions on the borrowed pool.
 * A failed COMMIT is uncertain: retry append with the same key and payload to reconcile.
 * Retention defines the deduplication window; pruning permits later acceptance under that key.
 */
export function open(
	options: Options,
): Readonly<
	{
		/** Join the caller's transaction. Reusing a retained key requires the same payload. */
		append(tx: TransactionSql, message: MessageType): Promise<void>;
		/** Reserve a bounded batch with fresh lease tokens; expired work can be delivered again. */
		claim(options?: { readonly limit?: number; readonly leaseMs?: number }): Promise<readonly ClaimType[]>;
		/** Record sink acceptance only while this exact claim remains current and unexpired. */
		complete(claim: ClaimType): Promise<void>;
		/** Release a claim for later delivery. External sink work may already have happened. */
		retry(claim: ClaimType, delayMs?: number): Promise<void>;
		/** Read retained delivery state without renewing its lease. */
		inspect(id: string, key: string): Promise<StateType | undefined>;
		/** Remove a bounded terminal batch; removal ends deduplication for those message keys. */
		prune(before: number, limit?: number): Promise<number>;
	}
> {
	const namespace = NameSchema.parse(options.namespace);
	const maximum = count(options.maximum ?? 10000, 1000000);
	const bytes = count(options.maximumBytes ?? 1048576, 16777216);
	const attempts = count(options.maximumAttempts ?? 8, 10000);
	/** Serialize capacity and policy with insertion. A duplicate message does not consume another slot. */
	async function policy(tx: TransactionSql): Promise<void> {
		await tx`select pg_advisory_xact_lock(hashtextextended(${`outbox:${namespace}`},0))`;
		await tx`insert into utils_outbox.policies values (${namespace},${maximum},${bytes},${attempts}) on conflict do nothing`;
		const row = (await tx`select * from utils_outbox.policies where namespace=${namespace}`)[0]!;
		if (row.maximum !== maximum || row.bytes !== bytes || row.attempts !== attempts) throw new OutboxError('policy');
	}
	/** A current unexpired token alone can mutate delivery. Repeated successful acknowledgement is idempotent. */
	async function settle(claim: ClaimType, complete: boolean, delay: number): Promise<void> {
		if (claim.namespace !== namespace) throw new OutboxError('stale');
		NameSchema.parse(claim.id);
		NameSchema.parse(claim.key);
		NameSchema.parse(claim.token);
		await options.database.begin(async (tx) => {
			const row =
				(await tx`select * from utils_outbox.messages where namespace=${namespace} and id=${claim.id} and key=${claim.key} for update`)[
					0
				];
			const time = await now(tx);
			if (complete && row?.state === 'complete' && row.token === claim.token) return;
			if (!row || row.state !== 'leased' || row.token !== claim.token || Number(row.expires) <= time) {
				throw new OutboxError('stale');
			}
			const state = complete ? 'complete' : Number(row.attempt) >= attempts ? 'failed' : 'pending';
			await tx`update utils_outbox.messages set state=${state}, due=${
				time + delay
			}, updated=${time}, expires=null where namespace=${namespace} and id=${claim.id} and key=${claim.key}`;
		});
	}
	return Object.freeze({
		/** Accept inside the same transaction as the business write. Changed payload under a retained key rejects. */
		async append(tx: TransactionSql, message: MessageType): Promise<void> {
			NameSchema.parse(message.id);
			NameSchema.parse(message.key);
			const text = json.stringify(message.value, { maximumBytes: bytes, maximumDepth: 64 });
			await policy(tx);
			const old =
				(await tx`select value from utils_outbox.messages where namespace=${namespace} and id=${message.id} and key=${message.key}`)[
					0
				];
			if (old) {
				if (json.stringify(old.value, { maximumBytes: bytes }) !== text) throw new OutboxError('conflict');
				return;
			}
			if (
				Number(
					(await tx`select count(*) as count from utils_outbox.messages where namespace=${namespace}`)[0]!.count,
				) >= maximum
			) throw new OutboxError('capacity');
			const time = await now(tx);
			// Bind canonical text and cast it to JSONB. Passing JavaScript null to
			// the driver's JSON helper can instead bind SQL NULL, losing a valid payload.
			await tx`insert into utils_outbox.messages(namespace,id,key,value,state,due,updated) values (${namespace},${message.id},${message.key},${
				tx.typed(text, TextOid)
			}::jsonb,'pending',${time},${time})`;
		},
		/** Atomically reserve at most 100 messages; expired claims can be redelivered with a fresh token. No background polling. */
		async claim(
			{ limit = 1, leaseMs = 30000 }: { readonly limit?: number; readonly leaseMs?: number } = {},
		): Promise<readonly ClaimType[]> {
			count(limit, 100);
			count(leaseMs, 86400000);
			return await options.database.begin(async (tx) => {
				await policy(tx);
				const time = await now(tx);
				await tx`update utils_outbox.messages set state='failed', updated=${time} where namespace=${namespace} and state='leased' and expires<=${time} and attempt>=${attempts}`;
				const rows =
					await tx`select * from utils_outbox.messages where namespace=${namespace} and attempt<${attempts} and ((state='pending' and due<=${time}) or (state='leased' and expires<=${time})) order by due,id,key limit ${limit} for update skip locked`;
				const claims: ClaimType[] = [];
				for (const row of rows) {
					const token = crypto.randomUUID(), attempt = Number(row.attempt) + 1;
					await tx`update utils_outbox.messages set state='leased',token=${token},attempt=${attempt},expires=${
						time + leaseMs
					},updated=${time} where namespace=${namespace} and id=${row.id} and key=${row.key}`;
					claims.push(
						Object.freeze({ namespace, id: String(row.id), key: String(row.key), value: row.value, token, attempt }),
					);
				}
				return Object.freeze(claims);
			});
		},
		/** Call only after idempotent sink acceptance. A late/foreign claim rejects without changing state. */
		complete(claim: ClaimType): Promise<void> {
			return settle(claim, true, 0);
		},
		/** Retry with a bounded explicit delay; exhausted attempts become failed. Sink effects may already have happened. */
		retry(claim: ClaimType, delayMs = 1000): Promise<void> {
			if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 86400000) {
				throw new RangeError('Invalid outbox retry delay.');
			}
			return settle(claim, false, delayMs);
		},
		/** Read retained delivery state without extending any lease. */
		async inspect(id: string, key: string): Promise<StateType | undefined> {
			NameSchema.parse(id);
			NameSchema.parse(key);
			const row = (await options
				.database`select state from utils_outbox.messages where namespace=${namespace} and id=${id} and key=${key}`)[
					0
				];
			return row ? StateSchema.parse(row.state) : undefined;
		},
		/** Remove a bounded terminal batch. Callers must preserve their required deduplication window. */
		async prune(before: number, limit = 100): Promise<number> {
			if (!Number.isSafeInteger(before) || before < 0) throw new RangeError('Invalid retention cutoff.');
			count(limit, 1000);
			const rows = await options
				.database`delete from utils_outbox.messages where (namespace,id,key) in (select namespace,id,key from utils_outbox.messages where namespace=${namespace} and state in ('complete','failed') and updated<${before} order by updated limit ${limit}) returning id`;
			return rows.length;
		},
	});
}
/** Inert adapter contract. Every live connection remains owned by the application. */
export type Outbox = ReturnType<typeof open>;
