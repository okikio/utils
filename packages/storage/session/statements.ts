/**
 * Every statement the session adapter runs after migration, built from the typed tables in `schema.ts`.
 * `statements.sql` beside this file holds their compiled SQL; the session tests compare it and describe each one.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import type { RecordType } from '@okikio/capability/resource/session';
import { records } from './schema.ts';

const r = records.c;

/** Limit each statement of this transaction. */
export function timeout(milliseconds: number): sql.Statement<{ value: string }> {
	return sql.select({ value: sql.fn.setLocal('statement_timeout', String(milliseconds)) });
}

/** Database time in whole epoch milliseconds, read after the lock. */
export const now: sql.Statement<{ now: number }> = sql.select({
	now: sql.fn.epochMilliseconds(sql.fn.clockTimestamp()),
});

/** One record, locked until the transaction ends. */
export function load(namespace: string, id: string): sql.Statement<{ value: RecordType }> {
	return sql.select({ value: r.value as sql.Column<RecordType, typeof records.key> }).from(records).where(
		r.namespace.eq(namespace),
		r.id.eq(id),
	)
		.for();
}

/** Save a record, replacing the stored one. */
export function save(namespace: string, id: string, value: RecordType): sql.Statement<unknown> {
	return sql.insert(records, { namespace, id, value }).onConflict({
		target: [r.namespace, r.id],
		action: 'update',
		set: { value: sql.excluded(records).c.value },
	});
}

/** Remove a record. */
export function remove(namespace: string, id: string): sql.Statement<unknown> {
	return sql.remove(records).where(r.namespace.eq(namespace), r.id.eq(id));
}
