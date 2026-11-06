/** Explicit PostgreSQL schema for named latest-value snapshots; imports perform no I/O. @module */

/** Version one stores one validated Context envelope per namespace/key and retains no revision history. */
export const revision = 1;

/**
 * Initial schema statements applied together under the state migration lock.
 * The composite primary key arbitrates competing initial writes. Envelope
 * fields remain JSON so Context owns their format and application conversion.
 */
export const ddl = [
	'create schema if not exists utils_state',
	'create table utils_state.version (id boolean primary key default true check (id), revision integer not null)',
	'insert into utils_state.version(id,revision) values (true,1)',
	`create table utils_state.snapshots (
		namespace text not null check (char_length(namespace) between 1 and 128),
		key text not null check (char_length(key) between 1 and 512),
		snapshot jsonb not null check (coalesce(
			jsonb_typeof(snapshot) = 'object'
			and snapshot ?& array['format','contract','version','value']
			and snapshot->'format' = '1'::jsonb
			and jsonb_typeof(snapshot->'contract') = 'string'
			and char_length(snapshot->>'contract') between 1 and 256
			and jsonb_typeof(snapshot->'version') = 'string'
			and char_length(snapshot->>'version') between 1 and 128,
			false)),
		primary key (namespace,key)
	)`,
] as const;
