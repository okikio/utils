/**
 * Every statement the state adapter runs after migration, built from the typed tables in `schema.ts`.
 * `statements.sql` beside this file holds their compiled SQL; the state tests compare it and describe each one.
 *
 * @module
 */
import * as sql from '@okikio/sql';
import type { SnapshotType } from '@okikio/context/state';
import { snapshots } from './schema.ts';

const s = snapshots.c;

/** Start the transaction every operation runs in, on a reserved connection. */
export const begin: sql.Ddl = sql.begin('read committed');
/** Commit it. */
export const commit: sql.Ddl = sql.commit();
/** Roll it back. */
export const rollback: sql.Ddl = sql.rollback();

/** Limit each statement of this transaction. */
export function timeout(milliseconds: number): sql.Statement<{ value: string }> {
	return sql.select({ value: sql.fn.setLocal('statement_timeout', String(milliseconds)) });
}

/** The current snapshot. */
export function load(namespace: string, key: string): sql.Statement<{ snapshot: SnapshotType }> {
	return sql.select({ snapshot: s.snapshot as sql.Column<SnapshotType> }).from(snapshots)
		.where(s.namespace.eq(namespace), s.key.eq(key));
}

/** Save the first snapshot; returns no row when one already exists. */
export function create(namespace: string, key: string, snapshot: SnapshotType): sql.Statement<{ key: string }> {
	return sql.insert(snapshots, { namespace, key, snapshot }).onConflict({
		target: [s.namespace, s.key],
		action: 'nothing',
	})
		.returning({ key: s.key });
}

/** Replace the snapshot only when the stored version is `expected`; returns no row otherwise. */
export function replace(
	namespace: string,
	key: string,
	snapshot: SnapshotType,
	expected: string,
): sql.Statement<{ key: string }> {
	return sql.update(snapshots, { snapshot }).where(
		s.namespace.eq(namespace),
		s.key.eq(key),
		sql.json.text(s.snapshot, 'version').eq(expected),
	)
		.returning({ key: s.key });
}
