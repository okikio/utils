/** PostgreSQL session authority with database time and per-reference transaction serialization. Imports issue no SQL. @module */
import type { Sql } from 'postgres';
import { RecordSchema } from '@okikio/capability/resource/session';
import type { Store } from '@okikio/capability/resource/session';

/** Borrowed pool and explicit application partition. A namespace grants no authorization. */
export interface Options {
	readonly database: Sql;
	/** Nonblank application partition, at most 128 code points. Applications own reference retention and remove terminal IDs explicitly. */
	readonly namespace: string;
	/** Per-transaction statement timeout, whole milliseconds. Connection/queue timeouts remain pool-owner policy. @default 5000 */
	readonly statementTimeoutMs?: number;
}
/** Explicitly install revision one. No existing workflow/state schema is changed and unknown revisions fail closed. */
export async function migrate(options: { readonly database: Sql }): Promise<void> {
	await options.database.begin(async (sql) => {
		await sql`select pg_advisory_xact_lock(776161006)`;
		const exists = await sql`select to_regclass('utils_session.version') as present`;
		if (exists[0]!.present !== null) {
			const rows = await sql`select revision from utils_session.version where id`;
			if (rows[0]?.revision !== 1) throw new TypeError('Unsupported resource session schema revision.');
			const table = await sql`select to_regclass('utils_session.records') as present`;
			if (table[0]!.present === null) throw new TypeError('Resource session records table is missing.');
			return;
		}
		await sql`create schema if not exists utils_session`;
		await sql`create table utils_session.version (id boolean primary key default true check(id), revision integer not null)`;
		await sql`insert into utils_session.version values (true,1)`;
		await sql`create table utils_session.records (namespace text not null, id text not null, value jsonb not null, primary key(namespace,id))`;
	});
}
/**
 * Open inert authority over a caller-owned pool. Each transition locks one
 * namespace/ID, reads database time, applies a synchronous change and commits.
 * Hash collisions only serialize unrelated IDs. No client clock decides expiry.
 * A failed commit may have an unknown outcome; callers must inspect/reconcile,
 * never assume a failed request grants borrowing or resurrects an old session.
 */
export function open(options: Options): Store {
	const namespace = options.namespace, timeout = options.statementTimeoutMs ?? 5000;
	if (!namespace.trim() || [...namespace].length > 128) throw new TypeError('Invalid session namespace.');
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000) {
		throw new RangeError('Invalid session statement timeout.');
	}
	return {
		async change(id, change) {
			if (!id || [...id].length > 192) throw new TypeError('Invalid session ID.');
			const result = await options.database.begin(async (sql) => {
				await sql`select set_config('statement_timeout',${String(timeout)},true)`;
				await sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([namespace, id])},0))`;
				const rows =
					await sql`select value from utils_session.records where namespace=${namespace} and id=${id} for update`;
				const clock = await sql`select floor(extract(epoch from clock_timestamp()) * 1000)::double precision as now`;
				const next = change(rows[0] ? RecordSchema.parse(rows[0].value) : undefined, Number(clock[0]!.now));
				if (next) {
					const value = RecordSchema.parse(next);
					if (value.reference.id !== id) throw new TypeError('Session record ID differs from its storage key.');
					await sql`insert into utils_session.records values (${namespace},${id},${
						sql.json(value)
					}) on conflict(namespace,id) do update set value=excluded.value`;
					return value;
				}
				await sql`delete from utils_session.records where namespace=${namespace} and id=${id}`;
				return undefined;
			});
			return result;
		},
	};
}
