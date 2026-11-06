/** PostgreSQL queue schema. Changes are applied only by an explicit migrate() call. @module */
export const revision = 2;

/** Queue state and claim authority are stored together, so one transaction fences every mutation. */
export const ddl = [
	'create schema if not exists utils_queue',
	'create table if not exists utils_queue.version (id boolean primary key default true check (id), revision integer not null)',
	'insert into utils_queue.version(id,revision) values (true,2) on conflict (id) do nothing',
	'create table if not exists utils_queue.policies (namespace text primary key, contract text not null, capacity bigint not null check(capacity>0), retained bigint not null check(retained>0), ttl bigint not null check(ttl>0))',
	"create table if not exists utils_queue.items (namespace text not null references utils_queue.policies(namespace), id uuid not null, key text, sequence bigint generated always as identity, input jsonb not null, redriven_from uuid, priority bigint not null default 0, state text not null check(state in ('queued','claimed','completed','failed','cancelled')), available timestamptz not null default clock_timestamp(), attempt integer not null default 0 check(attempt>=0), claim uuid, owner text, claimed timestamptz, expires timestamptz, output jsonb, failure jsonb, cancellation text, finished timestamptz, primary key(namespace,id), unique(namespace,key), check((state='claimed')=(claim is not null and owner is not null and claimed is not null and expires is not null)), check((state in ('completed','failed','cancelled'))=(finished is not null)))",
	"create index if not exists queue_ready on utils_queue.items(namespace,priority desc,sequence) where state='queued'",
	"create index if not exists queue_expired on utils_queue.items(namespace,expires) where state='claimed'",
	'create index if not exists queue_terminal on utils_queue.items(namespace,finished,sequence) where finished is not null',
	'create index if not exists queue_inspection on utils_queue.items(namespace,sequence)',
] as const;

/** Forward-only v1 upgrade runs under the same migration advisory lock and transaction. */
export const upgrade = [
	'alter table utils_queue.items add column redriven_from uuid',
	'create index queue_inspection on utils_queue.items(namespace,sequence)',
	'update utils_queue.version set revision=2 where id',
] as const;
