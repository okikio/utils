-- guard
select ("pg_advisory_xact_lock"("hashtextextended"($1::text, ($2::text)::bigint)))::text as "locked";

-- load
select ("utils_session"."records"."value")::text as "value" from "utils_session"."records" where ("utils_session"."records"."namespace" = $1::text) and ("utils_session"."records"."id" = $2::text) for update;

-- migration.complete
select (to_regclass($1::text) is not null)::boolean as "present";

-- migration.install.0
create schema if not exists "utils_session";

-- migration.install.1
create table if not exists "utils_session"."version" ("id" boolean not null default true::boolean, "revision" int4 not null, primary key ("id"), check ("id"));

-- migration.install.2
insert into "utils_session"."version" ("revision") values (($1::text)::int4) on conflict do nothing;

-- migration.install.3
create table if not exists "utils_session"."records" ("namespace" text not null, "id" text not null, "value" jsonb not null, primary key ("namespace", "id"));

-- migration.installed
select (to_regclass($1::text) is not null)::boolean as "present";

-- migration.lock
select ("pg_advisory_xact_lock"(($1::text)::bigint))::text as "locked";

-- migration.stored
select ("utils_session"."version"."revision")::int4 as "revision" from "utils_session"."version" where "utils_session"."version"."id";

-- now
select (((extract(epoch from clock_timestamp()) * 1000)::double precision) * 1000)::int8::text as "now";

-- remove
delete from "utils_session"."records" where ("utils_session"."records"."namespace" = $1::text) and ("utils_session"."records"."id" = $2::text);

-- save
insert into "utils_session"."records" ("namespace", "id", "value") values ($1::text, $2::text, ($3::text)::jsonb) on conflict ("namespace", "id") do update set "value" = "excluded"."value";

-- timeout
select (set_config($1::text, $2::text, true))::text as "value";
