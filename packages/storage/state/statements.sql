-- begin
begin isolation level read committed;

-- commit
commit;

-- create
insert into "utils_state"."snapshots" ("namespace", "key", "snapshot") values ($1::text, $2::text, ($3::text)::jsonb) on conflict ("namespace", "key") do nothing returning ("utils_state"."snapshots"."key")::text as "key";

-- load
select ("utils_state"."snapshots"."snapshot")::text as "snapshot" from "utils_state"."snapshots" where ("utils_state"."snapshots"."namespace" = $1::text) and ("utils_state"."snapshots"."key" = $2::text);

-- migration.complete
select (to_regclass($1::text) is not null)::boolean as "present";

-- migration.install.0
create schema if not exists "utils_state";

-- migration.install.1
create table if not exists "utils_state"."version" ("id" boolean not null default true::boolean, "revision" integer not null, primary key ("id"), check ("id"));

-- migration.install.2
insert into "utils_state"."version" ("revision") values (($1::text)::integer) on conflict do nothing;

-- migration.install.3
create table if not exists "utils_state"."snapshots" ("namespace" text not null, "key" text not null, "snapshot" jsonb not null, primary key ("namespace", "key"), check (char_length("namespace") between ('1'::text)::integer and ('128'::text)::integer), check (char_length("key") between ('1'::text)::integer and ('512'::text)::integer), check (coalesce((jsonb_typeof("snapshot") = 'object'::text) and ("snapshot" ?& array['format'::text, 'contract'::text, 'version'::text, 'value'::text]) and (("snapshot" -> 'format'::text) = ('1'::text)::jsonb) and (jsonb_typeof("snapshot" -> 'contract'::text) = 'string'::text) and (char_length("snapshot" ->> 'contract'::text) between ('1'::text)::integer and ('256'::text)::integer) and (jsonb_typeof("snapshot" -> 'version'::text) = 'string'::text) and (char_length("snapshot" ->> 'version'::text) between ('1'::text)::integer and ('128'::text)::integer), false::boolean)));

-- migration.installed
select (to_regclass($1::text) is not null)::boolean as "present";

-- migration.lock
select ("pg_advisory_xact_lock"(($1::text)::bigint))::text as "locked";

-- migration.stored
select ("utils_state"."version"."revision")::integer as "revision" from "utils_state"."version" where "utils_state"."version"."id";

-- replace
update "utils_state"."snapshots" set "snapshot" = ($1::text)::jsonb where ("utils_state"."snapshots"."namespace" = $2::text) and ("utils_state"."snapshots"."key" = $3::text) and (("utils_state"."snapshots"."snapshot" ->> $4::text) = $5::text) returning ("utils_state"."snapshots"."key")::text as "key";

-- rollback
rollback;

-- timeout
select (set_config($1::text, $2::text, true))::text as "value";
