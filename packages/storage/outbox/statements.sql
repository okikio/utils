-- addPolicy
insert into "utils_outbox"."policies" ("namespace", "maximum", "bytes", "attempts") values ($1::text, $2::integer, $3::integer, $4::integer) on conflict do nothing;

-- addRepair
insert into "utils_outbox"."repairs" ("namespace", "id", "key", "attempt", "actor", "reason", "updated") values ($1::text, $2::text, $3::text, $4::integer, $5::text, $6::text, $7::double precision);

-- candidates
select ("utils_outbox"."messages"."id")::text as "id", ("utils_outbox"."messages"."key")::text as "key", ("utils_outbox"."messages"."value")::text as "value", ("utils_outbox"."messages"."attempt")::integer as "attempt" from "utils_outbox"."messages" where ("utils_outbox"."messages"."namespace" = $1::text) and (("utils_outbox"."messages"."attempt" - "utils_outbox"."messages"."budget") < $2::integer) and ((("utils_outbox"."messages"."state" = $3::text) and ("utils_outbox"."messages"."due" <= $4::double precision)) or (("utils_outbox"."messages"."state" = $5::text) and ("utils_outbox"."messages"."expires" <= $6::double precision))) order by "utils_outbox"."messages"."due" asc, "utils_outbox"."messages"."id" asc, "utils_outbox"."messages"."key" asc limit $7::bigint for update skip locked;

-- completed
select ("utils_outbox"."messages"."id")::text as "id", ("utils_outbox"."messages"."key")::text as "key", ("utils_outbox"."messages"."updated")::double precision as "updated" from "utils_outbox"."messages" where ("utils_outbox"."messages"."namespace" = $1::text) and ("utils_outbox"."messages"."state" = $2::text) and ("utils_outbox"."messages"."updated" < $3::double precision) order by "utils_outbox"."messages"."updated" asc, "utils_outbox"."messages"."id" asc, "utils_outbox"."messages"."key" asc limit $4::bigint;

-- completed.where
select ("utils_outbox"."messages"."id")::text as "id", ("utils_outbox"."messages"."key")::text as "key", ("utils_outbox"."messages"."updated")::double precision as "updated" from "utils_outbox"."messages" where ("utils_outbox"."messages"."namespace" = $1::text) and ("utils_outbox"."messages"."state" = $2::text) and ("utils_outbox"."messages"."updated" < $3::double precision) and ("utils_outbox"."messages"."key" <> $4::text) order by "utils_outbox"."messages"."updated" asc, "utils_outbox"."messages"."id" asc, "utils_outbox"."messages"."key" asc limit $5::bigint;

-- exhaust
update "utils_outbox"."messages" set "state" = $1::text, "expires" = null::double precision, "updated" = $2::double precision where ("utils_outbox"."messages"."namespace" = $3::text) and ("utils_outbox"."messages"."state" = $4::text) and ("utils_outbox"."messages"."expires" <= $5::double precision) and (("utils_outbox"."messages"."attempt" - "utils_outbox"."messages"."budget") >= $6::integer);

-- extend
update "utils_outbox"."messages" set "expires" = $1::double precision, "updated" = $2::double precision where ("utils_outbox"."messages"."namespace" = $3::text) and ("utils_outbox"."messages"."id" = $4::text) and ("utils_outbox"."messages"."key" = $5::text);

-- guard
select ("pg_advisory_xact_lock"("hashtextextended"($1::text, ($2::text)::bigint)))::text as "locked";

-- history
select ("utils_outbox"."repairs"."attempt")::integer as "attempt", ("utils_outbox"."repairs"."actor")::text as "actor", ("utils_outbox"."repairs"."reason")::text as "reason", ("utils_outbox"."repairs"."updated")::double precision as "updated" from "utils_outbox"."repairs" where ("utils_outbox"."repairs"."namespace" = $1::text) and ("utils_outbox"."repairs"."id" = $2::text) and ("utils_outbox"."repairs"."key" = $3::text) and ("utils_outbox"."repairs"."attempt" > $4::integer) order by "utils_outbox"."repairs"."attempt" asc limit $5::bigint;

-- insert
insert into "utils_outbox"."messages" ("namespace", "id", "key", "value", "state", "due", "updated") values ($1::text, $2::text, $3::text, ($4::text)::jsonb, $5::text, $6::double precision, $7::double precision);

-- inspect
select ("utils_outbox"."messages"."state")::text as "state" from "utils_outbox"."messages" where ("utils_outbox"."messages"."namespace" = $1::text) and ("utils_outbox"."messages"."id" = $2::text) and ("utils_outbox"."messages"."key" = $3::text);

-- lease
select ("utils_outbox"."messages"."state")::text as "state", ("utils_outbox"."messages"."token")::text as "token", ("utils_outbox"."messages"."expires")::double precision as "expires", ("utils_outbox"."messages"."attempt")::integer as "attempt", ("utils_outbox"."messages"."budget")::integer as "budget" from "utils_outbox"."messages" where ("utils_outbox"."messages"."namespace" = $1::text) and ("utils_outbox"."messages"."id" = $2::text) and ("utils_outbox"."messages"."key" = $3::text) for update;

-- migration.install.00
create table if not exists "utils_outbox"."policies" ("namespace" text not null, "maximum" integer not null, "bytes" integer not null, "attempts" integer not null, primary key ("namespace"));

-- migration.install.01
create table if not exists "utils_outbox"."messages" ("namespace" text not null, "id" text not null, "key" text not null, "value" jsonb not null, "state" text not null, "attempt" integer not null default 0::integer, "token" text, "expires" double precision, "due" double precision not null, "updated" double precision not null, "budget" integer not null default 0::integer, "failure" text, primary key ("namespace", "id", "key"), check ("state" in ('pending'::text, 'leased'::text, 'complete'::text, 'failed'::text)));

-- migration.install.02
create index if not exists "outbox_ready" on "utils_outbox"."messages" ("namespace", "state", "due");

-- migration.install.03
alter table "utils_outbox"."messages" add column if not exists "budget" integer not null default 0::integer;

-- migration.install.04
alter table "utils_outbox"."messages" add column if not exists "failure" text;

-- migration.install.05
create table if not exists "utils_outbox"."repairs" ("namespace" text not null, "id" text not null, "key" text not null, "attempt" integer not null, "actor" text not null, "reason" text not null, "updated" double precision not null, primary key ("namespace", "id", "key", "attempt"), foreign key ("namespace", "id", "key") references "utils_outbox"."messages" ("namespace", "id", "key") on delete cascade);

-- migration.install.06
update "utils_outbox"."version" set "revision" = $1::integer where "utils_outbox"."version"."id";

-- migration.lock
select ("pg_advisory_xact_lock"(($1::text)::bigint))::text as "locked";

-- migration.prepare.0
create schema if not exists "utils_outbox";

-- migration.prepare.1
create table if not exists "utils_outbox"."version" ("id" boolean not null, "revision" integer not null, primary key ("id"), check ("id"));

-- migration.prepare.2
insert into "utils_outbox"."version" ("id", "revision") values ($1::boolean, $2::integer) on conflict do nothing;

-- migration.stored
select ("utils_outbox"."version"."revision")::integer as "revision" from "utils_outbox"."version" where "utils_outbox"."version"."id";

-- now
select ((extract(epoch from clock_timestamp()) * 1000)::double precision)::double precision as "now";

-- page
select ("utils_outbox"."messages"."id")::text as "id", ("utils_outbox"."messages"."key")::text as "key", ("utils_outbox"."messages"."state")::text as "state", ("utils_outbox"."messages"."attempt")::integer as "attempt", ("utils_outbox"."messages"."budget")::integer as "budget", ("utils_outbox"."messages"."due")::double precision as "due", ("utils_outbox"."messages"."updated")::double precision as "updated", ("utils_outbox"."messages"."expires")::double precision as "expires", ("utils_outbox"."messages"."failure")::text as "failure" from "utils_outbox"."messages" where "utils_outbox"."messages"."namespace" = $1::text order by ("utils_outbox"."messages"."id" collate "C") asc, ("utils_outbox"."messages"."key" collate "C") asc limit $2::bigint;

-- page.filtered
select ("utils_outbox"."messages"."id")::text as "id", ("utils_outbox"."messages"."key")::text as "key", ("utils_outbox"."messages"."state")::text as "state", ("utils_outbox"."messages"."attempt")::integer as "attempt", ("utils_outbox"."messages"."budget")::integer as "budget", ("utils_outbox"."messages"."due")::double precision as "due", ("utils_outbox"."messages"."updated")::double precision as "updated", ("utils_outbox"."messages"."expires")::double precision as "expires", ("utils_outbox"."messages"."failure")::text as "failure" from "utils_outbox"."messages" where ("utils_outbox"."messages"."namespace" = $1::text) and ("utils_outbox"."messages"."state" = $2::text) and ((("utils_outbox"."messages"."id" collate "C"), ("utils_outbox"."messages"."key" collate "C")) > ($3::text, $4::text)) order by ("utils_outbox"."messages"."id" collate "C") asc, ("utils_outbox"."messages"."key" collate "C") asc limit $5::bigint;

-- payload
select ("utils_outbox"."messages"."value")::text as "value" from "utils_outbox"."messages" where ("utils_outbox"."messages"."namespace" = $1::text) and ("utils_outbox"."messages"."id" = $2::text) and ("utils_outbox"."messages"."key" = $3::text);

-- policy
select ("utils_outbox"."policies"."maximum")::integer as "maximum", ("utils_outbox"."policies"."bytes")::integer as "bytes", ("utils_outbox"."policies"."attempts")::integer as "attempts" from "utils_outbox"."policies" where "utils_outbox"."policies"."namespace" = $1::text;

-- policy.locked
select ("utils_outbox"."policies"."maximum")::integer as "maximum", ("utils_outbox"."policies"."bytes")::integer as "bytes", ("utils_outbox"."policies"."attempts")::integer as "attempts" from "utils_outbox"."policies" where "utils_outbox"."policies"."namespace" = $1::text for update;

-- prune
delete from "utils_outbox"."messages" where ("utils_outbox"."messages"."namespace", "utils_outbox"."messages"."id", "utils_outbox"."messages"."key") in (select "utils_outbox"."messages"."namespace" as "namespace", "utils_outbox"."messages"."id" as "id", "utils_outbox"."messages"."key" as "key" from "utils_outbox"."messages" where ("utils_outbox"."messages"."namespace" = $1::text) and ("utils_outbox"."messages"."state" in ($2::text, $3::text)) and ("utils_outbox"."messages"."updated" < $4::double precision) order by "utils_outbox"."messages"."updated" asc limit $5::bigint) returning ("utils_outbox"."messages"."id")::text as "id";

-- redrive
update "utils_outbox"."messages" set "state" = $1::text, "budget" = "utils_outbox"."messages"."attempt", "token" = null::text, "expires" = null::double precision, "due" = $2::double precision, "updated" = $3::double precision where ("utils_outbox"."messages"."namespace" = $4::text) and ("utils_outbox"."messages"."id" = $5::text) and ("utils_outbox"."messages"."key" = $6::text);

-- reserve
update "utils_outbox"."messages" set "state" = $1::text, "token" = $2::text, "attempt" = $3::integer, "expires" = $4::double precision, "updated" = $5::double precision where ("utils_outbox"."messages"."namespace" = $6::text) and ("utils_outbox"."messages"."id" = $7::text) and ("utils_outbox"."messages"."key" = $8::text);

-- retire
delete from "utils_outbox"."messages" where (("utils_outbox"."messages"."namespace" = $1::text) and ("utils_outbox"."messages"."id" = $2::text) and ("utils_outbox"."messages"."key" = $3::text)) and ("utils_outbox"."messages"."state" = $4::text) and ("utils_outbox"."messages"."updated" < $5::double precision) returning ("utils_outbox"."messages"."id")::text as "id";

-- setMaximum
update "utils_outbox"."policies" set "maximum" = $1::integer where "utils_outbox"."policies"."namespace" = $2::text;

-- settle
update "utils_outbox"."messages" set "state" = $1::text, "due" = $2::double precision, "updated" = $3::double precision, "expires" = null::double precision, "failure" = null::text where ("utils_outbox"."messages"."namespace" = $4::text) and ("utils_outbox"."messages"."id" = $5::text) and ("utils_outbox"."messages"."key" = $6::text);

-- size
select (count(*)::integer)::integer as "count" from "utils_outbox"."messages" where "utils_outbox"."messages"."namespace" = $1::text;
