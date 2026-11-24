-- chain.busy
select (exists (select 1 as "_" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."run" = ($2::text)::uuid) and (not "utils_workflow"."jobs"."finalizer") and ("utils_workflow"."jobs"."state" in ($3::text, $4::text, $5::text))))::boolean as "jobs", (exists (select 1 as "_" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $6::text) and ("utils_workflow"."runs"."family" = ($7::text)::uuid) and ("utils_workflow"."runs"."id" <> ($8::text)::uuid) and (not ("utils_workflow"."runs"."state" in ($9::text, $10::text, $11::text, $12::text)))))::boolean as "relatives";

-- chain.link
update "utils_workflow"."runs" set "state" = $1::text, "continued_to" = ($2::text)::uuid, "continuation" = cast(null as jsonb), "expires" = cast(null as timestamptz), "reason" = cast(null as text) where ("utils_workflow"."runs"."namespace" = $3::text) and ("utils_workflow"."runs"."id" = ($4::text)::uuid);

-- chain.next
insert into "utils_workflow"."runs" ("namespace", "id", "scope", "key", "kind", "definition", "version", "input", "fingerprint", "policy", "policyhash", "state", "family", "parent", "cancellation", "reservation", "trace", "paused", "control_revision", "chain_root", "chain_index", "location") select "utils_workflow"."runs"."namespace" as "namespace", ($1::text)::uuid as "id", "utils_workflow"."runs"."scope" as "scope", $2::text as "key", "utils_workflow"."runs"."kind" as "kind", "utils_workflow"."runs"."definition" as "definition", "utils_workflow"."runs"."version" as "version", ($3::text)::jsonb as "input", $4::text as "fingerprint", "utils_workflow"."runs"."policy" as "policy", "utils_workflow"."runs"."policyhash" as "policyhash", $5::text as "state", "utils_workflow"."runs"."family" as "family", "utils_workflow"."runs"."id" as "parent", $6::text as "cancellation", "utils_workflow"."runs"."reservation" as "reservation", "utils_workflow"."runs"."trace" as "trace", "utils_workflow"."runs"."paused" as "paused", "utils_workflow"."runs"."control_revision" as "control_revision", "utils_workflow"."runs"."chain_root" as "chain_root", ("utils_workflow"."runs"."chain_index" + $7::integer) as "chain_index", "utils_workflow"."runs"."location" as "location" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $8::text) and ("utils_workflow"."runs"."id" = ($9::text)::uuid);

-- chain.request
update "utils_workflow"."runs" set "state" = $1::text, "continuation" = ($2::text)::jsonb, "expires" = cast(null as timestamptz), "reason" = cast(null as text) where ("utils_workflow"."runs"."namespace" = $3::text) and ("utils_workflow"."runs"."id" = ($4::text)::uuid);

-- cleanups.decide
insert into "utils_workflow"."audit" ("namespace", "id", "run", "epoch", "actor", "reason", "action") values ($1::text, ($2::text)::uuid, ($3::text)::uuid, $4::integer, $5::text, $6::text, $7::text);

-- cleanups.defer
insert into "utils_workflow"."cleanups" ("namespace", "run", "path", "scope", "request") values ($1::text, ($2::text)::uuid, $3::text, cast(null as text), ($4::text)::jsonb);

-- cleanups.end
update "utils_workflow"."cleanups" set "state" = $1::text, "outcome" = ($2::text)::jsonb where ("utils_workflow"."cleanups"."namespace" = $3::text) and ("utils_workflow"."cleanups"."run" = ($4::text)::uuid) and ("utils_workflow"."cleanups"."path" = $5::text);

-- cleanups.failedChild
select ("utils_workflow"."cleanups"."path")::text as "path" from "utils_workflow"."cleanups" where ("utils_workflow"."cleanups"."namespace" = $1::text) and ("utils_workflow"."cleanups"."run" = ($2::text)::uuid) and ("utils_workflow"."cleanups"."state" = $3::text) and ("utils_workflow"."cleanups"."child" is not null) limit $4::bigint;

-- cleanups.finished
select ("utils_workflow"."cleanups"."run")::text as "run", ("utils_workflow"."cleanups"."path")::text as "path", ("utils_workflow"."cleanups"."scope")::text as "scope", ("utils_workflow"."cleanups"."child")::text as "child" from "utils_workflow"."cleanups" join "utils_workflow"."runs" as "r" on ("r"."namespace" = "utils_workflow"."cleanups"."namespace") and ("r"."id" = "utils_workflow"."cleanups"."child") join "utils_workflow"."runs" as "p" on ("p"."namespace" = "utils_workflow"."cleanups"."namespace") and ("p"."id" = "utils_workflow"."cleanups"."run") where ("utils_workflow"."cleanups"."namespace" = $1::text) and ("utils_workflow"."cleanups"."state" = $2::text) and ("p"."state" in ($3::text, $4::text, $5::text, $6::text)) and (("r"."state" in ($7::text, $8::text, $9::text)) or (("r"."state" = $10::text) and ("p"."reason" is distinct from $11::text))) order by "utils_workflow"."cleanups"."ordinal" asc, "utils_workflow"."cleanups"."run" asc, "utils_workflow"."cleanups"."path" asc limit $12::bigint;

-- cleanups.of
select ("utils_workflow"."cleanups"."namespace")::text as "namespace", ("utils_workflow"."cleanups"."run")::text as "run", ("utils_workflow"."cleanups"."path")::text as "path", ("utils_workflow"."cleanups"."scope")::text as "scope", ("utils_workflow"."cleanups"."ordinal")::text as "ordinal", ("utils_workflow"."cleanups"."request")::text as "request", ("utils_workflow"."cleanups"."state")::text as "state", ("utils_workflow"."cleanups"."job")::text as "job", ("utils_workflow"."cleanups"."child")::text as "child", ("utils_workflow"."cleanups"."outcome")::text as "outcome" from "utils_workflow"."cleanups" where ("utils_workflow"."cleanups"."namespace" = $1::text) and ("utils_workflow"."cleanups"."run" = ($2::text)::uuid) and ("utils_workflow"."cleanups"."job" = ($3::text)::uuid);

-- cleanups.queue
select ("utils_workflow"."cleanups"."namespace")::text as "namespace", ("utils_workflow"."cleanups"."run")::text as "run", ("utils_workflow"."cleanups"."path")::text as "path", ("utils_workflow"."cleanups"."scope")::text as "scope", ("utils_workflow"."cleanups"."ordinal")::text as "ordinal", ("utils_workflow"."cleanups"."request")::text as "request", ("utils_workflow"."cleanups"."state")::text as "state", ("utils_workflow"."cleanups"."job")::text as "job", ("utils_workflow"."cleanups"."child")::text as "child", ("utils_workflow"."cleanups"."outcome")::text as "outcome" from "utils_workflow"."cleanups" where ("utils_workflow"."cleanups"."namespace" = $1::text) and ("utils_workflow"."cleanups"."run" = ($2::text)::uuid) and ("utils_workflow"."cleanups"."state" <> $3::text) order by "utils_workflow"."cleanups"."ordinal" desc for update;

-- cleanups.queue.scope
select ("utils_workflow"."cleanups"."namespace")::text as "namespace", ("utils_workflow"."cleanups"."run")::text as "run", ("utils_workflow"."cleanups"."path")::text as "path", ("utils_workflow"."cleanups"."scope")::text as "scope", ("utils_workflow"."cleanups"."ordinal")::text as "ordinal", ("utils_workflow"."cleanups"."request")::text as "request", ("utils_workflow"."cleanups"."state")::text as "state", ("utils_workflow"."cleanups"."job")::text as "job", ("utils_workflow"."cleanups"."child")::text as "child", ("utils_workflow"."cleanups"."outcome")::text as "outcome" from "utils_workflow"."cleanups" where ("utils_workflow"."cleanups"."namespace" = $1::text) and ("utils_workflow"."cleanups"."run" = ($2::text)::uuid) and ("utils_workflow"."cleanups"."state" <> $3::text) and (("utils_workflow"."cleanups"."scope" = $4::text) or starts_with("utils_workflow"."cleanups"."scope", $5::text)) order by "utils_workflow"."cleanups"."ordinal" desc for update;

-- cleanups.receipt
select ("utils_workflow"."receipts"."namespace")::text as "namespace", ("utils_workflow"."receipts"."job")::text as "job", ("utils_workflow"."receipts"."key")::text as "key", ("utils_workflow"."receipts"."contract")::text as "contract", ("utils_workflow"."receipts"."fingerprint")::text as "fingerprint", ("utils_workflow"."receipts"."value")::text as "value", to_char(("utils_workflow"."receipts"."created") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "created" from "utils_workflow"."receipts" where ("utils_workflow"."receipts"."namespace" = $1::text) and ("utils_workflow"."receipts"."job" = ($2::text)::uuid) and ("utils_workflow"."receipts"."key" = $3::text);

-- cleanups.save
insert into "utils_workflow"."receipts" ("namespace", "job", "key", "contract", "fingerprint", "value") values ($1::text, ($2::text)::uuid, $3::text, $4::text, $5::text, ($6::text)::jsonb);

-- cleanups.start
update "utils_workflow"."cleanups" set "state" = $1::text, "job" = ($2::text)::uuid, "child" = cast(null as uuid) where ("utils_workflow"."cleanups"."namespace" = $3::text) and ("utils_workflow"."cleanups"."run" = ($4::text)::uuid) and ("utils_workflow"."cleanups"."path" = $5::text);

-- cleanups.state
select ("utils_workflow"."cleanups"."state")::text as "state" from "utils_workflow"."cleanups" where ("utils_workflow"."cleanups"."namespace" = $1::text) and ("utils_workflow"."cleanups"."run" = ($2::text)::uuid) and ("utils_workflow"."cleanups"."path" = $3::text) for update;

-- cleanups.unfinished
select ("utils_workflow"."cleanups"."path")::text as "path" from "utils_workflow"."cleanups" where ("utils_workflow"."cleanups"."namespace" = $1::text) and ("utils_workflow"."cleanups"."run" = ($2::text)::uuid) and ("utils_workflow"."cleanups"."state" <> $3::text) limit $4::bigint;

-- cleanups.unfinished.scope
select ("utils_workflow"."cleanups"."path")::text as "path" from "utils_workflow"."cleanups" where ("utils_workflow"."cleanups"."namespace" = $1::text) and ("utils_workflow"."cleanups"."run" = ($2::text)::uuid) and (("utils_workflow"."cleanups"."scope" = $3::text) or starts_with("utils_workflow"."cleanups"."scope", $4::text)) and ("utils_workflow"."cleanups"."state" <> $5::text) limit $6::bigint;

-- history.abandoned
select ("utils_workflow"."instructions"."path")::text as "path" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $1::text) and ("utils_workflow"."instructions"."run" = ($2::text)::uuid) and starts_with("utils_workflow"."instructions"."path", $3::text) and ("utils_workflow"."instructions"."outcome" is null);

-- history.add
insert into "utils_workflow"."instructions" ("namespace", "run", "path", "fingerprint", "type", "job", "child", "due", "discard", "outcome", "bytes", "event", "event_key", "parent", "branches") values ($1::text, ($2::text)::uuid, $3::text, $4::text, $5::text, cast(null as uuid), cast(null as uuid), ($6::text)::timestamptz, $7::boolean, cast(null as jsonb), $8::integer, cast(null as text), cast(null as text), cast(null as text), cast(null as jsonb));

-- history.count
select ((count(*))::integer)::integer as "count" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $1::text) and ("utils_workflow"."instructions"."run" = ($2::text)::uuid);

-- history.count.nested
select ((count(*))::integer)::integer as "count" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $1::text) and ("utils_workflow"."instructions"."run" = ($2::text)::uuid) and ("utils_workflow"."instructions"."parent" = $3::text);

-- history.count.roots
select ((count(*))::integer)::integer as "count" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $1::text) and ("utils_workflow"."instructions"."run" = ($2::text)::uuid) and ("utils_workflow"."instructions"."parent" is null);

-- history.deliver
insert into "utils_workflow"."events" ("namespace", "run", "event", "key", "value", "fingerprint", "bytes") values ($1::text, ($2::text)::uuid, $3::text, $4::text, ($5::text)::jsonb, $6::text, $7::integer);

-- history.event
select ("utils_workflow"."events"."fingerprint")::text as "fingerprint" from "utils_workflow"."events" where ("utils_workflow"."events"."namespace" = $1::text) and ("utils_workflow"."events"."run" = ($2::text)::uuid) and ("utils_workflow"."events"."event" = $3::text) and ("utils_workflow"."events"."key" = $4::text);

-- history.instruction
select ("utils_workflow"."instructions"."namespace")::text as "namespace", ("utils_workflow"."instructions"."run")::text as "run", ("utils_workflow"."instructions"."path")::text as "path", ("utils_workflow"."instructions"."fingerprint")::text as "fingerprint", ("utils_workflow"."instructions"."type")::text as "type", ("utils_workflow"."instructions"."job")::text as "job", ("utils_workflow"."instructions"."child")::text as "child", to_char(("utils_workflow"."instructions"."due") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "due", ("utils_workflow"."instructions"."discard")::boolean as "discard", ("utils_workflow"."instructions"."outcome")::text as "outcome", ("utils_workflow"."instructions"."bytes")::integer as "bytes", ("utils_workflow"."instructions"."parent")::text as "parent", ("utils_workflow"."instructions"."branches")::text as "branches", ("utils_workflow"."instructions"."event")::text as "event", ("utils_workflow"."instructions"."event_key")::text as "event_key" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $1::text) and ("utils_workflow"."instructions"."run" = ($2::text)::uuid) and ("utils_workflow"."instructions"."path" = $3::text);

-- history.outcomes
select ("utils_workflow"."instructions"."path")::text as "path", ("utils_workflow"."instructions"."outcome")::text as "outcome" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $1::text) and ("utils_workflow"."instructions"."run" = ($2::text)::uuid) and ("utils_workflow"."instructions"."path" in ($3::text));

-- history.pending
select ("utils_workflow"."instructions"."namespace")::text as "namespace", ("utils_workflow"."instructions"."run")::text as "run", ("utils_workflow"."instructions"."path")::text as "path", ("utils_workflow"."instructions"."fingerprint")::text as "fingerprint", ("utils_workflow"."instructions"."type")::text as "type", ("utils_workflow"."instructions"."job")::text as "job", ("utils_workflow"."instructions"."child")::text as "child", to_char(("utils_workflow"."instructions"."due") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "due", ("utils_workflow"."instructions"."discard")::boolean as "discard", ("utils_workflow"."instructions"."outcome")::text as "outcome", ("utils_workflow"."instructions"."bytes")::integer as "bytes", ("utils_workflow"."instructions"."parent")::text as "parent", ("utils_workflow"."instructions"."branches")::text as "branches", ("utils_workflow"."instructions"."event")::text as "event", ("utils_workflow"."instructions"."event_key")::text as "event_key" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $1::text) and ("utils_workflow"."instructions"."run" = ($2::text)::uuid) and ("utils_workflow"."instructions"."path" = $3::text) and ("utils_workflow"."instructions"."outcome" is null) for update;

-- history.race
select ("utils_workflow"."instructions"."namespace")::text as "namespace", ("utils_workflow"."instructions"."run")::text as "run", ("utils_workflow"."instructions"."path")::text as "path", ("utils_workflow"."instructions"."fingerprint")::text as "fingerprint", ("utils_workflow"."instructions"."type")::text as "type", ("utils_workflow"."instructions"."job")::text as "job", ("utils_workflow"."instructions"."child")::text as "child", to_char(("utils_workflow"."instructions"."due") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "due", ("utils_workflow"."instructions"."discard")::boolean as "discard", ("utils_workflow"."instructions"."outcome")::text as "outcome", ("utils_workflow"."instructions"."bytes")::integer as "bytes", ("utils_workflow"."instructions"."parent")::text as "parent", ("utils_workflow"."instructions"."branches")::text as "branches", ("utils_workflow"."instructions"."event")::text as "event", ("utils_workflow"."instructions"."event_key")::text as "event_key" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $1::text) and ("utils_workflow"."instructions"."run" = ($2::text)::uuid) and ("utils_workflow"."instructions"."path" = $3::text) and ("utils_workflow"."instructions"."type" = $4::text);

-- history.received
select ("utils_workflow"."events"."value")::text as "value" from "utils_workflow"."events" where ("utils_workflow"."events"."namespace" = $1::text) and ("utils_workflow"."events"."run" = ($2::text)::uuid) and ("utils_workflow"."events"."event" = $3::text) and ("utils_workflow"."events"."key" = $4::text);

-- history.received.before
select ("utils_workflow"."events"."value")::text as "value" from "utils_workflow"."events" where ("utils_workflow"."events"."namespace" = $1::text) and ("utils_workflow"."events"."run" = ($2::text)::uuid) and ("utils_workflow"."events"."event" = $3::text) and ("utils_workflow"."events"."key" = $4::text) and ("utils_workflow"."events"."created" <= ($5::text)::timestamptz);

-- history.record
update "utils_workflow"."instructions" set "outcome" = ($1::text)::jsonb, "bytes" = "utils_workflow"."instructions"."bytes" + $2::integer where ("utils_workflow"."instructions"."namespace" = $3::text) and ("utils_workflow"."instructions"."run" = ($4::text)::uuid) and ("utils_workflow"."instructions"."path" = $5::text) and ("utils_workflow"."instructions"."outcome" is null);

-- history.report
select ("utils_workflow"."progress"."namespace")::text as "namespace", ("utils_workflow"."progress"."run")::text as "run", ("utils_workflow"."progress"."job")::text as "job", ("utils_workflow"."progress"."effect")::text as "effect", ("utils_workflow"."progress"."generation")::integer as "generation", ("utils_workflow"."progress"."sequence")::integer as "sequence", ("utils_workflow"."progress"."attempt")::integer as "attempt", ("utils_workflow"."progress"."revision")::text as "revision", ("utils_workflow"."progress"."occurrence")::text as "occurrence", ("utils_workflow"."progress"."bytes")::integer as "bytes", to_char(("utils_workflow"."progress"."reported_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "reported_at" from "utils_workflow"."progress" where ("utils_workflow"."progress"."namespace" = $1::text) and ("utils_workflow"."progress"."run" = ($2::text)::uuid) and ("utils_workflow"."progress"."job" = ($3::text)::uuid) and ("utils_workflow"."progress"."effect" = $4::text);

-- history.reports
with "tree" as (select "utils_workflow"."runs"."id" as "id" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."id" = ($2::text)::uuid)) select ("utils_workflow"."progress"."namespace")::text as "namespace", ("utils_workflow"."progress"."run")::text as "run", ("utils_workflow"."progress"."job")::text as "job", ("utils_workflow"."progress"."effect")::text as "effect", ("utils_workflow"."progress"."generation")::integer as "generation", ("utils_workflow"."progress"."sequence")::integer as "sequence", ("utils_workflow"."progress"."attempt")::integer as "attempt", ("utils_workflow"."progress"."revision")::text as "revision", ("utils_workflow"."progress"."occurrence")::text as "occurrence", ("utils_workflow"."progress"."bytes")::integer as "bytes", to_char(("utils_workflow"."progress"."reported_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "reported_at", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."runs"."scope")::text as "scope", ("utils_workflow"."runs"."kind")::text as "kind", ("utils_workflow"."runs"."definition")::text as "definition", ("utils_workflow"."runs"."version")::text as "version" from "tree" join "utils_workflow"."progress" on ("utils_workflow"."progress"."namespace" = $3::text) and ("utils_workflow"."progress"."run" = "tree"."id") join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."progress"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."progress"."run") join "utils_workflow"."jobs" on ("utils_workflow"."jobs"."namespace" = "utils_workflow"."progress"."namespace") and ("utils_workflow"."jobs"."id" = "utils_workflow"."progress"."job") order by "utils_workflow"."progress"."job" asc, "utils_workflow"."progress"."effect" asc limit $4::bigint;

-- history.reports.children
with recursive "tree" as ((select "utils_workflow"."runs"."id" as "id" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."id" = ($2::text)::uuid)) union all (select "utils_workflow"."runs"."id" as "id" from "utils_workflow"."runs" join "tree" on "utils_workflow"."runs"."parent" = "tree"."id" where ("utils_workflow"."runs"."namespace" = $3::text) and ("utils_workflow"."runs"."scope" = $4::text))) select ("utils_workflow"."progress"."namespace")::text as "namespace", ("utils_workflow"."progress"."run")::text as "run", ("utils_workflow"."progress"."job")::text as "job", ("utils_workflow"."progress"."effect")::text as "effect", ("utils_workflow"."progress"."generation")::integer as "generation", ("utils_workflow"."progress"."sequence")::integer as "sequence", ("utils_workflow"."progress"."attempt")::integer as "attempt", ("utils_workflow"."progress"."revision")::text as "revision", ("utils_workflow"."progress"."occurrence")::text as "occurrence", ("utils_workflow"."progress"."bytes")::integer as "bytes", to_char(("utils_workflow"."progress"."reported_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "reported_at", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."runs"."scope")::text as "scope", ("utils_workflow"."runs"."kind")::text as "kind", ("utils_workflow"."runs"."definition")::text as "definition", ("utils_workflow"."runs"."version")::text as "version" from "tree" join "utils_workflow"."progress" on ("utils_workflow"."progress"."namespace" = $5::text) and ("utils_workflow"."progress"."run" = "tree"."id") join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."progress"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."progress"."run") join "utils_workflow"."jobs" on ("utils_workflow"."jobs"."namespace" = "utils_workflow"."progress"."namespace") and ("utils_workflow"."jobs"."id" = "utils_workflow"."progress"."job") order by "utils_workflow"."progress"."job" asc, "utils_workflow"."progress"."effect" asc limit $6::bigint;

-- history.saveReport
insert into "utils_workflow"."progress" ("namespace", "run", "job", "effect", "generation", "sequence", "attempt", "revision", "occurrence", "bytes") values ($1::text, ($2::text)::uuid, ($3::text)::uuid, $4::text, $5::integer, $6::integer, $7::integer, ($8::text)::uuid, ($9::text)::jsonb, $10::integer) on conflict ("namespace", "run", "job", "effect") do update set "generation" = "excluded"."generation", "sequence" = "excluded"."sequence", "attempt" = "excluded"."attempt", "revision" = "excluded"."revision", "occurrence" = "excluded"."occurrence", "bytes" = "excluded"."bytes", "reported_at" = clock_timestamp();

-- history.waiting
select ("utils_workflow"."instructions"."path")::text as "path", ("utils_workflow"."instructions"."outcome")::text as "outcome", to_char(("utils_workflow"."instructions"."due") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "due", (coalesce("utils_workflow"."instructions"."due" <= clock_timestamp(), $1::boolean))::boolean as "expired" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $2::text) and ("utils_workflow"."instructions"."run" = ($3::text)::uuid) and ("utils_workflow"."instructions"."event" = $4::text) and ("utils_workflow"."instructions"."event_key" = $5::text);

-- history.wakeable
select ("utils_workflow"."instructions"."run")::text as "run", ("utils_workflow"."instructions"."path")::text as "path" from "utils_workflow"."instructions" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."instructions"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."instructions"."run") where ("utils_workflow"."instructions"."namespace" = $1::text) and ("utils_workflow"."runs"."state" in ($2::text, $3::text, $4::text)) and ("utils_workflow"."instructions"."outcome" is null) and ((("utils_workflow"."instructions"."due" is not null) and ("utils_workflow"."instructions"."due" <= clock_timestamp())) or (("utils_workflow"."instructions"."child" is not null) and exists (select 1 as "_" from "utils_workflow"."runs" as "c" where ("c"."namespace" = "utils_workflow"."instructions"."namespace") and ("c"."id" = "utils_workflow"."instructions"."child") and ("c"."state" in ($5::text, $6::text, $7::text))))) order by "utils_workflow"."instructions"."run" asc, "utils_workflow"."instructions"."path" asc limit $8::bigint;

-- hosts.drain
update "utils_workflow"."hosts" set "draining" = $1::boolean where ("utils_workflow"."hosts"."namespace" = $2::text) and ("utils_workflow"."hosts"."id" = $3::text) and ("utils_workflow"."hosts"."generation" = $4::integer);

-- hosts.guard
select ("utils_workflow"."hosts"."id")::text as "id" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = $1::text) and ("utils_workflow"."hosts"."id" = $2::text) and ("utils_workflow"."hosts"."generation" = $3::integer) and ("utils_workflow"."hosts"."expires" > clock_timestamp()) and (not "utils_workflow"."hosts"."draining") for share;

-- hosts.guard.update
select ("utils_workflow"."hosts"."id")::text as "id" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = $1::text) and ("utils_workflow"."hosts"."id" = $2::text) and ("utils_workflow"."hosts"."generation" = $3::integer) and ("utils_workflow"."hosts"."expires" > clock_timestamp()) and (not "utils_workflow"."hosts"."draining") for update;

-- hosts.lineage
select ("utils_workflow"."hosts"."compute")::text as "compute" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = $1::text) and ("utils_workflow"."hosts"."id" = $2::text) and ("utils_workflow"."hosts"."generation" = $3::integer);

-- hosts.node
select ("utils_workflow"."compute"."generation")::text as "generation", ("utils_workflow"."compute"."value")::text as "value" from "utils_workflow"."compute" where ("utils_workflow"."compute"."namespace" = $1::text) and ("utils_workflow"."compute"."id" = $2::text) for update;

-- hosts.nodeShare
select ("utils_workflow"."compute"."generation")::text as "generation" from "utils_workflow"."compute" where ("utils_workflow"."compute"."namespace" = $1::text) and ("utils_workflow"."compute"."id" = $2::text) for share;

-- hosts.placement
select ("utils_workflow"."hosts"."compute")::text as "compute", ("utils_workflow"."hosts"."affinity")::text as "affinity" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = $1::text) and ("utils_workflow"."hosts"."id" = $2::text);

-- hosts.register
insert into "utils_workflow"."hosts" ("namespace", "id", "generation", "definitions", "engine", "activations", "activities", "expires", "compute", "affinity") values ($1::text, $2::text, $3::integer, ($4::text)::jsonb, $5::text, $6::integer, $7::integer, clock_timestamp() + $8::double precision * interval '1 millisecond', ($9::text)::jsonb, ($10::text)::jsonb) on conflict ("namespace", "id") do update set "generation" = "utils_workflow"."hosts"."generation" + $11::integer, "definitions" = "excluded"."definitions", "engine" = "excluded"."engine", "activations" = "excluded"."activations", "activities" = "excluded"."activities", "expires" = "excluded"."expires", "compute" = "excluded"."compute", "affinity" = "excluded"."affinity", "draining" = $12::boolean returning ("utils_workflow"."hosts"."generation")::integer as "generation";

-- hosts.renew
update "utils_workflow"."hosts" set "expires" = clock_timestamp() + $1::double precision * interval '1 millisecond' where ("utils_workflow"."hosts"."namespace" = $2::text) and ("utils_workflow"."hosts"."id" = $3::text) and ("utils_workflow"."hosts"."generation" = $4::integer);

-- hosts.saveNode
insert into "utils_workflow"."compute" ("namespace", "id", "generation", "value") values ($1::text, $2::text, ($3::text)::bigint, ($4::text)::jsonb) on conflict ("namespace", "id") do update set "generation" = "excluded"."generation", "value" = "excluded"."value";

-- inspect.attemptPage
select ("utils_workflow"."attempts"."job")::text as "job", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."attempts"."generation")::integer as "generation", ("utils_workflow"."attempts"."sequence")::integer as "sequence", ("utils_workflow"."attempts"."state")::text as "state", to_char(("utils_workflow"."attempts"."started") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "started", to_char(("utils_workflow"."attempts"."ended") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "ended", ("utils_workflow"."attempts"."outcome" ->> $1::text)::text as "outcome_type" from "utils_workflow"."attempts" join "utils_workflow"."jobs" on ("utils_workflow"."jobs"."namespace" = "utils_workflow"."attempts"."namespace") and ("utils_workflow"."jobs"."id" = "utils_workflow"."attempts"."job") where ("utils_workflow"."jobs"."namespace" = $2::text) and ("utils_workflow"."jobs"."run" = ($3::text)::uuid) and ("utils_workflow"."attempts"."job" = ($4::text)::uuid) and (("utils_workflow"."attempts"."job", "utils_workflow"."attempts"."generation") > (($5::text)::uuid, $6::integer)) order by "utils_workflow"."attempts"."job" asc, "utils_workflow"."attempts"."generation" asc limit $7::bigint;

-- inspect.historyPage
select ("utils_workflow"."run_events"."sequence")::text as "sequence", to_char(("utils_workflow"."run_events"."recorded_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "recorded_at", ("utils_workflow"."run_events"."kind")::text as "kind", ("utils_workflow"."run_events"."job_id")::text as "job_id", ("utils_workflow"."run_events"."prior_state")::text as "prior_state", ("utils_workflow"."run_events"."state")::text as "state", ("utils_workflow"."run_events"."paused")::boolean as "paused", ("utils_workflow"."run_events"."control_revision")::integer as "control_revision", ("utils_workflow"."run_events"."epoch")::integer as "epoch", ("utils_workflow"."run_events"."action")::text as "action", ("utils_workflow"."run_events"."actor")::text as "actor", ("utils_workflow"."run_events"."reason" is not null)::boolean as "has_reason" from "utils_workflow"."run_events" where ("utils_workflow"."run_events"."namespace" = $1::text) and ("utils_workflow"."run_events"."run" = ($2::text)::uuid) and ("utils_workflow"."run_events"."sequence" > ($3::text)::bigint) order by "utils_workflow"."run_events"."sequence" asc limit $4::bigint;

-- inspect.historyRange
select (min("e"."sequence"))::text as "first", (max("e"."sequence"))::text as "last", ((count(*))::integer)::integer as "count", (coalesce(cast(sum(pg_column_size("e")::integer) as integer), $1::integer))::integer as "bytes", ((select "e"."kind" as "kind" from "utils_workflow"."run_events" as "e" where ("e"."namespace" = $2::text) and ("e"."run" = ($3::text)::uuid) order by "e"."sequence" asc limit $4::bigint))::text as "kind" from "utils_workflow"."run_events" as "e" where ("e"."namespace" = $5::text) and ("e"."run" = ($6::text)::uuid);

-- inspect.hostPage
select ("utils_workflow"."hosts"."id")::text as "id", ("utils_workflow"."hosts"."generation")::integer as "generation", ("utils_workflow"."hosts"."engine")::text as "engine", (jsonb_array_length("utils_workflow"."hosts"."definitions"))::integer as "definitions", ("utils_workflow"."hosts"."draining")::boolean as "draining", to_char(("utils_workflow"."hosts"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("utils_workflow"."hosts"."expires" > transaction_timestamp())::boolean as "live", ("utils_workflow"."hosts"."activations")::integer as "activations", ("utils_workflow"."hosts"."activities")::integer as "activities", ((select (count(*))::integer as "count" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = "utils_workflow"."hosts"."namespace") and ("utils_workflow"."runs"."host" = "utils_workflow"."hosts"."id") and ("utils_workflow"."runs"."host_generation" = "utils_workflow"."hosts"."generation") and ("utils_workflow"."runs"."state" = $1::text) and ("utils_workflow"."runs"."expires" > transaction_timestamp())))::integer as "active_runs", ((select (count(*))::integer as "count" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = "utils_workflow"."hosts"."namespace") and ("utils_workflow"."runs"."host" = "utils_workflow"."hosts"."id") and ("utils_workflow"."runs"."host_generation" = "utils_workflow"."hosts"."generation") and ("utils_workflow"."runs"."state" = $2::text) and ("utils_workflow"."runs"."expires" <= transaction_timestamp())))::integer as "expired_runs", ((select (count(*))::integer as "count" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = "utils_workflow"."hosts"."namespace") and ("utils_workflow"."jobs"."host" = "utils_workflow"."hosts"."id") and ("utils_workflow"."jobs"."host_generation" = "utils_workflow"."hosts"."generation") and ("utils_workflow"."jobs"."state" = $3::text) and ("utils_workflow"."jobs"."expires" > transaction_timestamp())))::integer as "active_jobs", ((select (count(*))::integer as "count" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = "utils_workflow"."hosts"."namespace") and ("utils_workflow"."jobs"."host" = "utils_workflow"."hosts"."id") and ("utils_workflow"."jobs"."host_generation" = "utils_workflow"."hosts"."generation") and ("utils_workflow"."jobs"."state" = $4::text) and ("utils_workflow"."jobs"."expires" <= transaction_timestamp())))::integer as "expired_jobs" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = $5::text) and ("utils_workflow"."hosts"."id" > $6::text) order by "utils_workflow"."hosts"."id" asc limit $7::bigint;

-- inspect.job
select ("utils_workflow"."jobs"."id")::text as "id" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."run" = ($2::text)::uuid) and ("utils_workflow"."jobs"."id" = ($3::text)::uuid);

-- inspect.jobPage
select ("utils_workflow"."jobs"."id")::text as "id", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."jobs"."definition")::text as "definition", ("utils_workflow"."jobs"."state")::text as "state", ("utils_workflow"."jobs"."finalizer")::boolean as "finalizer", ("utils_workflow"."jobs"."generation")::integer as "generation", ("utils_workflow"."jobs"."sequence")::integer as "sequence", ("utils_workflow"."jobs"."budget")::integer as "budget", to_char(("utils_workflow"."jobs"."available") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "available", to_char(("utils_workflow"."jobs"."deadline") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "deadline", to_char(("utils_workflow"."jobs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("utils_workflow"."jobs"."host")::text as "host", ("utils_workflow"."jobs"."host_generation")::integer as "host_generation", ("utils_workflow"."jobs"."outcome" ->> $1::text)::text as "outcome_type" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $2::text) and ("utils_workflow"."jobs"."run" = ($3::text)::uuid) order by "utils_workflow"."jobs"."id" asc limit $4::bigint;

-- inspect.jobPage.after
select ("utils_workflow"."jobs"."id")::text as "id", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."jobs"."definition")::text as "definition", ("utils_workflow"."jobs"."state")::text as "state", ("utils_workflow"."jobs"."finalizer")::boolean as "finalizer", ("utils_workflow"."jobs"."generation")::integer as "generation", ("utils_workflow"."jobs"."sequence")::integer as "sequence", ("utils_workflow"."jobs"."budget")::integer as "budget", to_char(("utils_workflow"."jobs"."available") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "available", to_char(("utils_workflow"."jobs"."deadline") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "deadline", to_char(("utils_workflow"."jobs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("utils_workflow"."jobs"."host")::text as "host", ("utils_workflow"."jobs"."host_generation")::integer as "host_generation", ("utils_workflow"."jobs"."outcome" ->> $1::text)::text as "outcome_type" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $2::text) and ("utils_workflow"."jobs"."run" = ($3::text)::uuid) and ("utils_workflow"."jobs"."id" > ($4::text)::uuid) order by "utils_workflow"."jobs"."id" asc limit $5::bigint;

-- inspect.observed
select to_char((transaction_timestamp()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "at";

-- inspect.owner
select ("utils_workflow"."runs"."id")::text as "id", ("utils_workflow"."runs"."namespace")::text as "namespace", ("utils_workflow"."runs"."scope")::text as "scope", ("utils_workflow"."runs"."kind")::text as "kind", ("utils_workflow"."runs"."definition")::text as "definition", ("utils_workflow"."runs"."version")::text as "version", ("utils_workflow"."runs"."state")::text as "state", ("utils_workflow"."runs"."paused")::boolean as "paused", ("utils_workflow"."runs"."control_revision")::integer as "control_revision", ("utils_workflow"."runs"."epoch")::integer as "epoch", ("utils_workflow"."runs"."generation")::integer as "generation", ("utils_workflow"."runs"."family")::text as "family", ("utils_workflow"."runs"."parent")::text as "parent", ("utils_workflow"."runs"."chain_root")::text as "chain_root", ("utils_workflow"."runs"."chain_index")::integer as "chain_index", ("utils_workflow"."runs"."continued_to")::text as "continued_to", to_char(("utils_workflow"."runs"."created") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "created", to_char(("utils_workflow"."runs"."updated_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updated_at", to_char(("utils_workflow"."runs"."finished_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "finished_at", to_char(("utils_workflow"."runs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("utils_workflow"."runs"."host")::text as "host", ("utils_workflow"."runs"."host_generation")::integer as "host_generation", ("utils_workflow"."runs"."outcome" ->> $1::text)::text as "outcome_type", ("utils_workflow"."runs"."reason" is not null)::boolean as "has_reason", ("utils_workflow"."runs"."policy" ->> $2::text)::text as "policy_id", ("utils_workflow"."runs"."policy" ->> $3::text)::text as "policy_version" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $4::text) and ("utils_workflow"."runs"."id" = ($5::text)::uuid) and ("utils_workflow"."runs"."scope" = $6::text) and ("utils_workflow"."runs"."kind" = $7::text) and ("utils_workflow"."runs"."definition" = $8::text) and ("utils_workflow"."runs"."version" = $9::text);

-- inspect.progressPage
select ("utils_workflow"."progress"."job")::text as "job", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."progress"."effect")::text as "effect", ("utils_workflow"."progress"."generation")::integer as "generation", ("utils_workflow"."progress"."attempt")::integer as "attempt", ("utils_workflow"."progress"."sequence")::integer as "sequence", ("utils_workflow"."progress"."revision")::text as "revision", to_char(("utils_workflow"."progress"."reported_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "reported_at", ("utils_workflow"."progress"."bytes")::integer as "bytes" from "utils_workflow"."progress" join "utils_workflow"."jobs" on ("utils_workflow"."jobs"."namespace" = "utils_workflow"."progress"."namespace") and ("utils_workflow"."jobs"."id" = "utils_workflow"."progress"."job") where ("utils_workflow"."progress"."namespace" = $1::text) and ("utils_workflow"."progress"."run" = ($2::text)::uuid) and (("utils_workflow"."progress"."job", "utils_workflow"."progress"."effect") > (($3::text)::uuid, $4::text)) order by "utils_workflow"."progress"."job" asc, "utils_workflow"."progress"."effect" asc limit $5::bigint;

-- inspect.queueDue
select ((count(*))::integer)::integer as "jobs", to_char((min("utils_workflow"."jobs"."available")) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "oldest" from "utils_workflow"."jobs" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."scope" = $2::text) and ("utils_workflow"."runs"."state" in ($3::text)) and ("utils_workflow"."jobs"."state" = $4::text) and ("utils_workflow"."jobs"."available" <= transaction_timestamp());

-- inspect.queuePage
select ("utils_workflow"."runs"."id")::text as "id", ("utils_workflow"."runs"."namespace")::text as "namespace", ("utils_workflow"."runs"."scope")::text as "scope", ("utils_workflow"."runs"."kind")::text as "kind", ("utils_workflow"."runs"."definition")::text as "definition", ("utils_workflow"."runs"."version")::text as "version", ("utils_workflow"."runs"."state")::text as "state", ("utils_workflow"."runs"."paused")::boolean as "paused", ("utils_workflow"."runs"."control_revision")::integer as "control_revision", ("utils_workflow"."runs"."epoch")::integer as "epoch", ("utils_workflow"."runs"."generation")::integer as "generation", ("utils_workflow"."runs"."family")::text as "family", ("utils_workflow"."runs"."parent")::text as "parent", ("utils_workflow"."runs"."chain_root")::text as "chain_root", ("utils_workflow"."runs"."chain_index")::integer as "chain_index", ("utils_workflow"."runs"."continued_to")::text as "continued_to", to_char(("utils_workflow"."runs"."created") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "created", to_char(("utils_workflow"."runs"."updated_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updated_at", to_char(("utils_workflow"."runs"."finished_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "finished_at", to_char(("utils_workflow"."runs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("utils_workflow"."runs"."host")::text as "host", ("utils_workflow"."runs"."host_generation")::integer as "host_generation", ("utils_workflow"."runs"."outcome" ->> $1::text)::text as "outcome_type", ("utils_workflow"."runs"."reason" is not null)::boolean as "has_reason", ("utils_workflow"."runs"."policy" ->> $2::text)::text as "policy_id", ("utils_workflow"."runs"."policy" ->> $3::text)::text as "policy_version" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $4::text) and ("utils_workflow"."runs"."scope" = $5::text) and ("utils_workflow"."runs"."state" in ($6::text)) and (("utils_workflow"."runs"."created", "utils_workflow"."runs"."id") > (($7::text)::timestamptz, ($8::text)::uuid)) order by "utils_workflow"."runs"."created" asc, "utils_workflow"."runs"."id" asc limit $9::bigint;

-- inspect.queueTotals
select ((count(*))::integer)::integer as "runs", ((count(*) filter (where "utils_workflow"."runs"."paused"))::integer)::integer as "paused", to_char((min("utils_workflow"."runs"."created")) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "oldest" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."scope" = $2::text) and ("utils_workflow"."runs"."state" in ($3::text));

-- inspect.timeout
select (set_config($1::text, $2::text, true))::text as "value";

-- inspect.totals
select ((select (count(*))::integer as "count" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."run" = ($2::text)::uuid)))::integer as "jobs", ((select (count(*))::integer as "count" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $3::text) and ("utils_workflow"."jobs"."run" = ($4::text)::uuid) and ("utils_workflow"."jobs"."state" = $5::text)))::integer as "ready", ((select (count(*))::integer as "count" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $6::text) and ("utils_workflow"."jobs"."run" = ($7::text)::uuid) and ("utils_workflow"."jobs"."state" = $8::text)))::integer as "claimed", ((select (count(*))::integer as "count" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $9::text) and ("utils_workflow"."instructions"."run" = ($10::text)::uuid) and ("utils_workflow"."instructions"."type" in ($11::text, $12::text, $13::text, $14::text)) and ("utils_workflow"."instructions"."outcome" is null)))::integer as "waiting", ((select (count(*))::integer as "count" from "utils_workflow"."attempts" join "utils_workflow"."jobs" on ("utils_workflow"."jobs"."namespace" = "utils_workflow"."attempts"."namespace") and ("utils_workflow"."jobs"."id" = "utils_workflow"."attempts"."job") where ("utils_workflow"."jobs"."namespace" = $15::text) and ("utils_workflow"."jobs"."run" = ($16::text)::uuid)))::integer as "attempts", ((select (count(*))::integer as "count" from "utils_workflow"."progress" where ("utils_workflow"."progress"."namespace" = $17::text) and ("utils_workflow"."progress"."run" = ($18::text)::uuid)))::integer as "progress", ((select (count(*))::integer as "count" from "utils_workflow"."run_events" as "e" where ("e"."namespace" = $19::text) and ("e"."run" = ($20::text)::uuid)))::integer as "history_events", ((select coalesce(cast(sum(pg_column_size("e")::integer) as integer), $21::integer) as "count" from "utils_workflow"."run_events" as "e" where ("e"."namespace" = $22::text) and ("e"."run" = ($23::text)::uuid)))::integer as "history_bytes";

-- inspect.waitPage
select ("utils_workflow"."instructions"."path")::text as "path", ("utils_workflow"."instructions"."type")::text as "type", to_char(("utils_workflow"."instructions"."due") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "due", ("utils_workflow"."instructions"."child")::text as "child", ("utils_workflow"."instructions"."event")::text as "event", ("utils_workflow"."instructions"."outcome" is not null)::boolean as "resolved", ("utils_workflow"."instructions"."outcome" ->> $1::text)::text as "outcome_type" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $2::text) and ("utils_workflow"."instructions"."run" = ($3::text)::uuid) and ("utils_workflow"."instructions"."type" in ($4::text, $5::text, $6::text, $7::text)) and ("utils_workflow"."instructions"."path" > $8::text) order by "utils_workflow"."instructions"."path" asc limit $9::bigint;

-- jobs.abandon
update "utils_workflow"."attempts" set "state" = $1::text where ("utils_workflow"."attempts"."namespace" = $2::text) and ("utils_workflow"."attempts"."job" = ($3::text)::uuid) and ("utils_workflow"."attempts"."generation" = $4::integer);

-- jobs.add
insert into "utils_workflow"."jobs" ("namespace", "id", "run", "path", "definition", "input", "rules", "state", "budget", "finalizer", "location", "affinity") values ($1::text, ($2::text)::uuid, ($3::text)::uuid, $4::text, ($5::text)::jsonb, ($6::text)::jsonb, ($7::text)::jsonb, $8::text, $9::integer, $10::boolean, cast(null as jsonb), cast(null as jsonb));

-- jobs.at
select ("utils_workflow"."jobs"."id")::text as "id" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."run" = ($2::text)::uuid) and ("utils_workflow"."jobs"."path" = $3::text);

-- jobs.block
update "utils_workflow"."jobs" set "state" = $1::text, "outcome" = ($2::text)::jsonb, "expires" = cast(null as timestamptz) where ("utils_workflow"."jobs"."namespace" = $3::text) and ("utils_workflow"."jobs"."id" = ($4::text)::uuid);

-- jobs.cancel
update "utils_workflow"."jobs" set "state" = $1::text, "outcome" = ($2::text)::jsonb, "generation" = "utils_workflow"."jobs"."generation" + $3::integer, "expires" = cast(null as timestamptz) where ("utils_workflow"."jobs"."namespace" = $4::text) and ("utils_workflow"."jobs"."run" = ($5::text)::uuid) and (not "utils_workflow"."jobs"."finalizer") and ("utils_workflow"."jobs"."state" in ($6::text, $7::text, $8::text));

-- jobs.cancelAttempts
update "utils_workflow"."attempts" set "state" = $1::text, "outcome" = ($2::text)::jsonb, "ended" = clock_timestamp() where ("utils_workflow"."attempts"."namespace" = $3::text) and ("utils_workflow"."attempts"."state" = $4::text) and exists (select 1 as "_" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = "utils_workflow"."attempts"."namespace") and ("utils_workflow"."jobs"."id" = "utils_workflow"."attempts"."job") and ("utils_workflow"."jobs"."run" = ($5::text)::uuid) and (not "utils_workflow"."jobs"."finalizer"));

-- jobs.candidates
select ("utils_workflow"."jobs"."id")::text as "id", ("utils_workflow"."jobs"."run")::text as "run" from "utils_workflow"."jobs" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."state" = $2::text) and ("utils_workflow"."jobs"."available" <= clock_timestamp()) and ("utils_workflow"."runs"."state" in ($3::text, $4::text, $5::text, $6::text)) and ((not "utils_workflow"."runs"."paused") or "utils_workflow"."jobs"."finalizer") and exists (select 1 as "_" from jsonb_array_elements(($7::text)::jsonb) as "d" where "d"."value" = "utils_workflow"."jobs"."definition") and (("utils_workflow"."jobs"."location" is null) or ((coalesce("utils_workflow"."jobs"."location" -> $8::text, ($9::text)::jsonb) <@ ($10::text)::jsonb) and ((("utils_workflow"."jobs"."location" -> $11::text) is null) or (($12::text)::jsonb @> ("utils_workflow"."jobs"."location" -> $13::text))))) and (("utils_workflow"."jobs"."affinity" is null) or ("utils_workflow"."jobs"."affinity" <@ ($14::text)::jsonb)) order by "utils_workflow"."jobs"."finalizer" desc, "utils_workflow"."jobs"."available" asc, "utils_workflow"."jobs"."id" asc limit $15::bigint for update of "runs" skip locked;

-- jobs.candidates.finalizer
select ("utils_workflow"."jobs"."id")::text as "id", ("utils_workflow"."jobs"."run")::text as "run" from "utils_workflow"."jobs" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."state" = $2::text) and ("utils_workflow"."jobs"."available" <= clock_timestamp()) and ("utils_workflow"."runs"."state" in ($3::text, $4::text, $5::text, $6::text)) and ((not "utils_workflow"."runs"."paused") or "utils_workflow"."jobs"."finalizer") and ("utils_workflow"."jobs"."finalizer" = $7::boolean) and exists (select 1 as "_" from jsonb_array_elements(($8::text)::jsonb) as "d" where "d"."value" = "utils_workflow"."jobs"."definition") and (("utils_workflow"."jobs"."location" is null) or ((coalesce("utils_workflow"."jobs"."location" -> $9::text, ($10::text)::jsonb) <@ ($11::text)::jsonb) and ((("utils_workflow"."jobs"."location" -> $12::text) is null) or (($13::text)::jsonb @> ("utils_workflow"."jobs"."location" -> $14::text))))) and (("utils_workflow"."jobs"."affinity" is null) or ("utils_workflow"."jobs"."affinity" <@ ($15::text)::jsonb)) order by "utils_workflow"."jobs"."finalizer" desc, "utils_workflow"."jobs"."available" asc, "utils_workflow"."jobs"."id" asc limit $16::bigint for update of "runs" skip locked;

-- jobs.claim
update "utils_workflow"."jobs" set "state" = $1::text, "generation" = $2::integer, "sequence" = $3::integer, "host" = $4::text, "host_generation" = $5::integer, "expires" = least(clock_timestamp() + $6::double precision * interval '1 millisecond', clock_timestamp() + $7::double precision * interval '1 millisecond'), "deadline" = clock_timestamp() + $8::double precision * interval '1 millisecond' where ("utils_workflow"."jobs"."namespace" = $9::text) and ("utils_workflow"."jobs"."id" = ($10::text)::uuid);

-- jobs.due
select ("utils_workflow"."jobs"."namespace")::text as "namespace", ("utils_workflow"."jobs"."id")::text as "id", ("utils_workflow"."jobs"."run")::text as "run", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."jobs"."definition")::text as "definition", ("utils_workflow"."jobs"."input")::text as "input", ("utils_workflow"."jobs"."rules")::text as "rules", ("utils_workflow"."jobs"."state")::text as "state", ("utils_workflow"."jobs"."finalizer")::boolean as "finalizer", ("utils_workflow"."jobs"."generation")::integer as "generation", ("utils_workflow"."jobs"."sequence")::integer as "sequence", ("utils_workflow"."jobs"."budget")::integer as "budget", ("utils_workflow"."jobs"."host")::text as "host", ("utils_workflow"."jobs"."host_generation")::integer as "host_generation", to_char(("utils_workflow"."jobs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", to_char(("utils_workflow"."jobs"."deadline") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "deadline", to_char(("utils_workflow"."jobs"."available") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "available", ("utils_workflow"."jobs"."outcome")::text as "outcome", ("utils_workflow"."jobs"."location")::text as "location", ("utils_workflow"."jobs"."affinity")::text as "affinity" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."id" = ($2::text)::uuid) and ("utils_workflow"."jobs"."state" = $3::text) and ("utils_workflow"."jobs"."available" <= clock_timestamp()) for update;

-- jobs.extend
update "utils_workflow"."jobs" set "expires" = least("utils_workflow"."jobs"."deadline", clock_timestamp() + $1::double precision * interval '1 millisecond') where ("utils_workflow"."jobs"."namespace" = $2::text) and ("utils_workflow"."jobs"."id" = ($3::text)::uuid);

-- jobs.finish
update "utils_workflow"."jobs" set "state" = $1::text, "outcome" = ($2::text)::jsonb, "expires" = cast(null as timestamptz) where ("utils_workflow"."jobs"."namespace" = $3::text) and ("utils_workflow"."jobs"."id" = ($4::text)::uuid);

-- jobs.guard
select ("utils_workflow"."jobs"."namespace")::text as "namespace", ("utils_workflow"."jobs"."id")::text as "id", ("utils_workflow"."jobs"."run")::text as "run", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."jobs"."definition")::text as "definition", ("utils_workflow"."jobs"."input")::text as "input", ("utils_workflow"."jobs"."rules")::text as "rules", ("utils_workflow"."jobs"."state")::text as "state", ("utils_workflow"."jobs"."finalizer")::boolean as "finalizer", ("utils_workflow"."jobs"."generation")::integer as "generation", ("utils_workflow"."jobs"."sequence")::integer as "sequence", ("utils_workflow"."jobs"."budget")::integer as "budget", ("utils_workflow"."jobs"."host")::text as "host", ("utils_workflow"."jobs"."host_generation")::integer as "host_generation", to_char(("utils_workflow"."jobs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", to_char(("utils_workflow"."jobs"."deadline") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "deadline", to_char(("utils_workflow"."jobs"."available") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "available", ("utils_workflow"."jobs"."outcome")::text as "outcome", ("utils_workflow"."jobs"."location")::text as "location", ("utils_workflow"."jobs"."affinity")::text as "affinity" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."id" = ($2::text)::uuid) and ("utils_workflow"."jobs"."run" = ($3::text)::uuid) and ("utils_workflow"."jobs"."state" = $4::text) and ("utils_workflow"."jobs"."generation" = $5::integer) and ("utils_workflow"."jobs"."host" = $6::text) and ("utils_workflow"."jobs"."host_generation" = $7::integer) and ("utils_workflow"."jobs"."expires" > clock_timestamp()) and ("utils_workflow"."jobs"."deadline" > clock_timestamp()) for update;

-- jobs.lostClaim
select ("utils_workflow"."jobs"."namespace")::text as "namespace", ("utils_workflow"."jobs"."id")::text as "id", ("utils_workflow"."jobs"."run")::text as "run", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."jobs"."definition")::text as "definition", ("utils_workflow"."jobs"."input")::text as "input", ("utils_workflow"."jobs"."rules")::text as "rules", ("utils_workflow"."jobs"."state")::text as "state", ("utils_workflow"."jobs"."finalizer")::boolean as "finalizer", ("utils_workflow"."jobs"."generation")::integer as "generation", ("utils_workflow"."jobs"."sequence")::integer as "sequence", ("utils_workflow"."jobs"."budget")::integer as "budget", ("utils_workflow"."jobs"."host")::text as "host", ("utils_workflow"."jobs"."host_generation")::integer as "host_generation", to_char(("utils_workflow"."jobs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", to_char(("utils_workflow"."jobs"."deadline") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "deadline", to_char(("utils_workflow"."jobs"."available") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "available", ("utils_workflow"."jobs"."outcome")::text as "outcome", ("utils_workflow"."jobs"."location")::text as "location", ("utils_workflow"."jobs"."affinity")::text as "affinity" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."id" = ($2::text)::uuid) and ("utils_workflow"."jobs"."state" = $3::text) and (("utils_workflow"."jobs"."expires" <= clock_timestamp()) or ("utils_workflow"."jobs"."deadline" <= clock_timestamp()) or (not exists (select 1 as "_" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."hosts"."id" = "utils_workflow"."jobs"."host") and ("utils_workflow"."hosts"."generation" = "utils_workflow"."jobs"."host_generation") and (not "utils_workflow"."hosts"."draining") and ("utils_workflow"."hosts"."expires" > clock_timestamp())))) for update;

-- jobs.lostClaims
select ("utils_workflow"."jobs"."id")::text as "id", ("utils_workflow"."jobs"."run")::text as "run" from "utils_workflow"."jobs" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."state" = $2::text) and ("utils_workflow"."runs"."state" in ($3::text, $4::text, $5::text, $6::text)) and (("utils_workflow"."jobs"."expires" <= clock_timestamp()) or ("utils_workflow"."jobs"."deadline" <= clock_timestamp()) or (not exists (select 1 as "_" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."hosts"."id" = "utils_workflow"."jobs"."host") and ("utils_workflow"."hosts"."generation" = "utils_workflow"."jobs"."host_generation") and (not "utils_workflow"."hosts"."draining") and ("utils_workflow"."hosts"."expires" > clock_timestamp())))) order by "utils_workflow"."jobs"."expires" asc limit $7::bigint;

-- jobs.occupied
select ((count(*))::integer)::integer as "active" from "utils_workflow"."jobs" join "utils_workflow"."hosts" on ("utils_workflow"."hosts"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."hosts"."id" = "utils_workflow"."jobs"."host") and ("utils_workflow"."hosts"."generation" = "utils_workflow"."jobs"."host_generation") where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."state" = $2::text) and ("utils_workflow"."jobs"."expires" > clock_timestamp()) and ("utils_workflow"."hosts"."compute" @> ($3::text)::jsonb);

-- jobs.repairable
select ("utils_workflow"."jobs"."namespace")::text as "namespace", ("utils_workflow"."jobs"."id")::text as "id", ("utils_workflow"."jobs"."run")::text as "run", ("utils_workflow"."jobs"."path")::text as "path", ("utils_workflow"."jobs"."definition")::text as "definition", ("utils_workflow"."jobs"."input")::text as "input", ("utils_workflow"."jobs"."rules")::text as "rules", ("utils_workflow"."jobs"."state")::text as "state", ("utils_workflow"."jobs"."finalizer")::boolean as "finalizer", ("utils_workflow"."jobs"."generation")::integer as "generation", ("utils_workflow"."jobs"."sequence")::integer as "sequence", ("utils_workflow"."jobs"."budget")::integer as "budget", ("utils_workflow"."jobs"."host")::text as "host", ("utils_workflow"."jobs"."host_generation")::integer as "host_generation", to_char(("utils_workflow"."jobs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", to_char(("utils_workflow"."jobs"."deadline") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "deadline", to_char(("utils_workflow"."jobs"."available") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "available", ("utils_workflow"."jobs"."outcome")::text as "outcome", ("utils_workflow"."jobs"."location")::text as "location", ("utils_workflow"."jobs"."affinity")::text as "affinity" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $1::text) and ("utils_workflow"."jobs"."run" = ($2::text)::uuid) and ("utils_workflow"."jobs"."state" in ($3::text, $4::text)) order by "utils_workflow"."jobs"."finalizer" desc, "utils_workflow"."jobs"."id" asc for update;

-- jobs.restart
update "utils_workflow"."jobs" set "state" = $1::text, "budget" = "utils_workflow"."jobs"."sequence" + $2::integer, "generation" = "utils_workflow"."jobs"."generation" + $3::integer, "available" = clock_timestamp(), "expires" = cast(null as timestamptz) where ("utils_workflow"."jobs"."namespace" = $4::text) and ("utils_workflow"."jobs"."id" = ($5::text)::uuid);

-- jobs.retry
update "utils_workflow"."jobs" set "state" = $1::text, "outcome" = ($2::text)::jsonb, "expires" = cast(null as timestamptz), "available" = clock_timestamp() + $3::double precision * interval '1 millisecond' where ("utils_workflow"."jobs"."namespace" = $4::text) and ("utils_workflow"."jobs"."id" = ($5::text)::uuid);

-- jobs.revoke
update "utils_workflow"."jobs" set "state" = $1::text, "outcome" = ($2::text)::jsonb, "expires" = cast(null as timestamptz), "generation" = "utils_workflow"."jobs"."generation" + $3::integer where ("utils_workflow"."jobs"."namespace" = $4::text) and ("utils_workflow"."jobs"."run" = ($5::text)::uuid) and starts_with("utils_workflow"."jobs"."path", $6::text) and ("utils_workflow"."jobs"."state" in ($7::text, $8::text));

-- jobs.revokeAttempts
update "utils_workflow"."attempts" set "state" = $1::text, "ended" = clock_timestamp() from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $2::text) and ("utils_workflow"."jobs"."run" = ($3::text)::uuid) and starts_with("utils_workflow"."jobs"."path", $4::text) and ("utils_workflow"."jobs"."state" = $5::text) and ("utils_workflow"."attempts"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."attempts"."job" = "utils_workflow"."jobs"."id") and ("utils_workflow"."attempts"."generation" = "utils_workflow"."jobs"."generation");

-- jobs.revokeAttempts.ordinary
update "utils_workflow"."attempts" set "state" = $1::text, "ended" = clock_timestamp() from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $2::text) and ("utils_workflow"."jobs"."run" = ($3::text)::uuid) and (not "utils_workflow"."jobs"."finalizer") and ("utils_workflow"."jobs"."state" = $4::text) and ("utils_workflow"."attempts"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."attempts"."job" = "utils_workflow"."jobs"."id") and ("utils_workflow"."attempts"."generation" = "utils_workflow"."jobs"."generation");

-- jobs.settle
update "utils_workflow"."attempts" set "state" = $1::text, "outcome" = ($2::text)::jsonb, "ended" = clock_timestamp() where ("utils_workflow"."attempts"."namespace" = $3::text) and ("utils_workflow"."attempts"."job" = ($4::text)::uuid) and ("utils_workflow"."attempts"."generation" = $5::integer);

-- jobs.slots
select ("utils_workflow"."hosts"."activities")::integer as "limit", ((select (count(*))::integer as "count" from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = "utils_workflow"."hosts"."namespace") and ("utils_workflow"."jobs"."host" = "utils_workflow"."hosts"."id") and ("utils_workflow"."jobs"."host_generation" = "utils_workflow"."hosts"."generation") and ("utils_workflow"."jobs"."state" = $1::text) and ("utils_workflow"."jobs"."expires" > clock_timestamp())))::integer as "active" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = $2::text) and ("utils_workflow"."hosts"."id" = $3::text);

-- jobs.start
insert into "utils_workflow"."attempts" ("namespace", "job", "generation", "sequence", "state") values ($1::text, ($2::text)::uuid, $3::integer, $4::integer, $5::text);

-- maintenance.expired
select ("utils_workflow"."runs"."id")::text as "id" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."state" = $2::text) and ("utils_workflow"."runs"."expires" <= clock_timestamp()) order by "utils_workflow"."runs"."expires" asc limit $3::bigint for update skip locked;

-- maintenance.family
select ("r"."id")::text as "id" from "utils_workflow"."runs" as "r" where ("r"."namespace" = $1::text) and (("r"."id" = "r"."family") and ("r"."state" in ($2::text, $3::text, $4::text, $5::text)) and ("r"."finished_at" <= clock_timestamp()) and (not exists (select 1 as "_" from "utils_workflow"."runs" as "m" where ("m"."namespace" = "r"."namespace") and ("m"."family" = "r"."id") and ((not ("m"."state" in ($6::text, $7::text, $8::text, $9::text))) or ("m"."finished_at" is null) or (("m"."finished_at" + greatest(cast(("m"."policy" -> $10::text) ->> $11::text as double precision), cast(("m"."policy" -> $12::text) ->> $13::text as double precision), cast(("m"."policy" -> $14::text) ->> $15::text as double precision)) * interval '1 millisecond') > clock_timestamp()))))) order by "r"."finished_at" asc, "r"."id" asc limit $16::bigint for update of "r" skip locked;

-- maintenance.more
select (exists (select 1 as "_" from "utils_workflow"."runs" as "r" where ("r"."namespace" = $1::text) and (("r"."id" = "r"."family") and ("r"."state" in ($2::text, $3::text, $4::text, $5::text)) and ("r"."finished_at" <= clock_timestamp()) and (not exists (select 1 as "_" from "utils_workflow"."runs" as "m" where ("m"."namespace" = "r"."namespace") and ("m"."family" = "r"."id") and ((not ("m"."state" in ($6::text, $7::text, $8::text, $9::text))) or ("m"."finished_at" is null) or (("m"."finished_at" + greatest(cast(("m"."policy" -> $10::text) ->> $11::text as double precision), cast(("m"."policy" -> $12::text) ->> $13::text as double precision), cast(("m"."policy" -> $14::text) ->> $15::text as double precision)) * interval '1 millisecond') > clock_timestamp())))))))::boolean as "more";

-- maintenance.next
with "deadlines" as ((select clock_timestamp() as "due" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."kind" = $2::text) and ("utils_workflow"."runs"."state" = $3::text) and (not "utils_workflow"."runs"."paused") limit $4::bigint) union all (select "utils_workflow"."runs"."expires" as "due" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $5::text) and ("utils_workflow"."runs"."state" = $6::text) order by "utils_workflow"."runs"."expires" asc limit $7::bigint) union all (select "utils_workflow"."jobs"."expires" as "due" from "utils_workflow"."jobs" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."jobs"."namespace" = $8::text) and ("utils_workflow"."jobs"."state" = $9::text) and ("utils_workflow"."runs"."state" in ($10::text, $11::text, $12::text, $13::text)) order by "utils_workflow"."jobs"."expires" asc limit $14::bigint) union all (select "utils_workflow"."jobs"."available" as "due" from "utils_workflow"."jobs" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."jobs"."namespace" = $15::text) and ("utils_workflow"."jobs"."state" = $16::text) and ("utils_workflow"."runs"."state" in ($17::text, $18::text, $19::text, $20::text)) and ((not "utils_workflow"."runs"."paused") or "utils_workflow"."jobs"."finalizer") order by "utils_workflow"."jobs"."available" asc limit $21::bigint) union all (select "utils_workflow"."instructions"."due" as "due" from "utils_workflow"."instructions" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."instructions"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."instructions"."run") where ("utils_workflow"."instructions"."namespace" = $22::text) and ("utils_workflow"."instructions"."outcome" is null) and ("utils_workflow"."instructions"."due" is not null) and ("utils_workflow"."runs"."state" in ($23::text, $24::text, $25::text)) and (not "utils_workflow"."runs"."paused") order by "utils_workflow"."instructions"."due" asc limit $26::bigint)) select to_char((min("deadlines"."due")) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "due", to_char((clock_timestamp()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "now" from "deadlines";

-- maintenance.next.filtered
with "deadlines" as ((select clock_timestamp() as "due" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."kind" = $2::text) and ("utils_workflow"."runs"."state" = $3::text) and (not "utils_workflow"."runs"."paused") and exists (select 1 as "_" from jsonb_array_elements(($4::text)::jsonb) as "d" where (("d"."value" ->> $5::text) = "utils_workflow"."runs"."definition") and (("d"."value" ->> $6::text) = "utils_workflow"."runs"."version")) limit $7::bigint) union all (select "utils_workflow"."runs"."expires" as "due" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $8::text) and ("utils_workflow"."runs"."state" = $9::text) order by "utils_workflow"."runs"."expires" asc limit $10::bigint) union all (select "utils_workflow"."jobs"."expires" as "due" from "utils_workflow"."jobs" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."jobs"."namespace" = $11::text) and ("utils_workflow"."jobs"."state" = $12::text) and ("utils_workflow"."runs"."state" in ($13::text, $14::text, $15::text, $16::text)) order by "utils_workflow"."jobs"."expires" asc limit $17::bigint) union all (select "utils_workflow"."jobs"."available" as "due" from "utils_workflow"."jobs" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."jobs"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."jobs"."namespace" = $18::text) and ("utils_workflow"."jobs"."state" = $19::text) and ("utils_workflow"."runs"."state" in ($20::text, $21::text, $22::text, $23::text)) and ((not "utils_workflow"."runs"."paused") or "utils_workflow"."jobs"."finalizer") and (exists (select 1 as "_" from jsonb_array_elements(($24::text)::jsonb) as "a" where ("a"."value" = "utils_workflow"."jobs"."definition") and (not "utils_workflow"."jobs"."finalizer")) or exists (select 1 as "_" from jsonb_array_elements(($25::text)::jsonb) as "f" where ("f"."value" = "utils_workflow"."jobs"."definition") and "utils_workflow"."jobs"."finalizer")) order by "utils_workflow"."jobs"."available" asc limit $26::bigint) union all (select "utils_workflow"."instructions"."due" as "due" from "utils_workflow"."instructions" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = "utils_workflow"."instructions"."namespace") and ("utils_workflow"."runs"."id" = "utils_workflow"."instructions"."run") where ("utils_workflow"."instructions"."namespace" = $27::text) and ("utils_workflow"."instructions"."outcome" is null) and ("utils_workflow"."instructions"."due" is not null) and ("utils_workflow"."runs"."state" in ($28::text, $29::text, $30::text)) and (not "utils_workflow"."runs"."paused") order by "utils_workflow"."instructions"."due" asc limit $31::bigint)) select to_char((min("deadlines"."due")) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "due", to_char((clock_timestamp()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "now" from "deadlines";

-- maintenance.orphans
select ("c"."namespace")::text as "namespace", ("c"."id")::text as "id", ("c"."scope")::text as "scope", ("c"."key")::text as "key", ("c"."kind")::text as "kind", ("c"."definition")::text as "definition", ("c"."version")::text as "version", ("c"."input")::text as "input", ("c"."fingerprint")::text as "fingerprint", ("c"."policy")::text as "policy", ("c"."policyhash")::text as "policyhash", ("c"."state")::text as "state", ("c"."epoch")::integer as "epoch", ("c"."generation")::integer as "generation", ("c"."host")::text as "host", ("c"."host_generation")::integer as "host_generation", to_char(("c"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("c"."outcome")::text as "outcome", ("c"."reason")::text as "reason", ("c"."family")::text as "family", ("c"."parent")::text as "parent", ("c"."cancellation")::text as "cancellation", ("c"."reservation")::text as "reservation", ("c"."successors")::integer as "successors", ("c"."children")::integer as "children", to_char(("c"."created") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "created", ("c"."trace")::text as "trace", ("c"."paused")::boolean as "paused", ("c"."control_revision")::integer as "control_revision", to_char(("c"."updated_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updated_at", to_char(("c"."finished_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "finished_at", ("c"."chain_root")::text as "chain_root", ("c"."chain_index")::integer as "chain_index", ("c"."continued_to")::text as "continued_to", ("c"."continuation")::text as "continuation", ("c"."location")::text as "location" from "utils_workflow"."runs" as "c" join "utils_workflow"."runs" as "p" on ("p"."namespace" = "c"."namespace") and ("p"."id" = "c"."parent") where ("c"."namespace" = $1::text) and ("c"."cancellation" in ($2::text, $3::text)) and ((("p"."outcome" ->> $4::text) = $5::text) or exists (select 1 as "_" from "utils_workflow"."instructions" as "i" where ("i"."namespace" = "c"."namespace") and ("i"."child" = "c"."id") and ((("i"."outcome" ->> $6::text) = $7::text) or (("p"."outcome" is not null) and ("i"."outcome" is null) and (not "i"."discard"))))) and (not ("c"."state" in ($8::text, $9::text, $10::text, $11::text, $12::text))) limit $13::bigint;

-- maintenance.prune
delete from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."id" in (select "utils_workflow"."runs"."id" as "id" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $2::text) and ("utils_workflow"."runs"."family" = ($3::text)::uuid) order by ("utils_workflow"."runs"."id" = "utils_workflow"."runs"."family") asc, "utils_workflow"."runs"."id" asc limit $4::bigint)) returning ("utils_workflow"."runs"."id")::text as "id";

-- maintenance.purge.attempts
delete from "utils_workflow"."attempts" where ("utils_workflow"."attempts"."namespace" = $1::text) and (("utils_workflow"."attempts"."namespace", "utils_workflow"."attempts"."job", "utils_workflow"."attempts"."generation") in (select "x"."namespace" as "namespace", "x"."job" as "job", "x"."generation" as "generation" from "utils_workflow"."attempts" as "x" where ("x"."namespace" = $2::text) and exists (select 1 as "_" from "utils_workflow"."jobs" join "utils_workflow"."runs" as "m" on ("m"."namespace" = "utils_workflow"."jobs"."namespace") and ("m"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."jobs"."namespace" = "x"."namespace") and ("utils_workflow"."jobs"."id" = "x"."job") and ("m"."family" = ($3::text)::uuid)) order by "x"."namespace" asc, "x"."job" asc, "x"."generation" asc limit $4::bigint)) returning ("utils_workflow"."attempts"."namespace")::text as "key";

-- maintenance.purge.audit
delete from "utils_workflow"."audit" where ("utils_workflow"."audit"."namespace" = $1::text) and (("utils_workflow"."audit"."namespace", "utils_workflow"."audit"."id") in (select "x"."namespace" as "namespace", "x"."id" as "id" from "utils_workflow"."audit" as "x" where ("x"."namespace" = $2::text) and exists (select 1 as "_" from "utils_workflow"."runs" as "m" where ("m"."namespace" = "x"."namespace") and ("m"."id" = "x"."run") and ("m"."family" = ($3::text)::uuid)) order by "x"."namespace" asc, "x"."id" asc limit $4::bigint)) returning ("utils_workflow"."audit"."namespace")::text as "key";

-- maintenance.purge.cleanups
delete from "utils_workflow"."cleanups" where ("utils_workflow"."cleanups"."namespace" = $1::text) and (("utils_workflow"."cleanups"."namespace", "utils_workflow"."cleanups"."run", "utils_workflow"."cleanups"."path") in (select "x"."namespace" as "namespace", "x"."run" as "run", "x"."path" as "path" from "utils_workflow"."cleanups" as "x" where ("x"."namespace" = $2::text) and exists (select 1 as "_" from "utils_workflow"."runs" as "m" where ("m"."namespace" = "x"."namespace") and ("m"."id" = "x"."run") and ("m"."family" = ($3::text)::uuid)) order by "x"."namespace" asc, "x"."run" asc, "x"."path" asc limit $4::bigint)) returning ("utils_workflow"."cleanups"."namespace")::text as "key";

-- maintenance.purge.events
delete from "utils_workflow"."events" where ("utils_workflow"."events"."namespace" = $1::text) and (("utils_workflow"."events"."namespace", "utils_workflow"."events"."run", "utils_workflow"."events"."event", "utils_workflow"."events"."key") in (select "x"."namespace" as "namespace", "x"."run" as "run", "x"."event" as "event", "x"."key" as "key" from "utils_workflow"."events" as "x" where ("x"."namespace" = $2::text) and exists (select 1 as "_" from "utils_workflow"."runs" as "m" where ("m"."namespace" = "x"."namespace") and ("m"."id" = "x"."run") and ("m"."family" = ($3::text)::uuid)) order by "x"."namespace" asc, "x"."run" asc, "x"."event" asc, "x"."key" asc limit $4::bigint)) returning ("utils_workflow"."events"."namespace")::text as "key";

-- maintenance.purge.instructions
delete from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $1::text) and (("utils_workflow"."instructions"."namespace", "utils_workflow"."instructions"."run", "utils_workflow"."instructions"."path") in (select "x"."namespace" as "namespace", "x"."run" as "run", "x"."path" as "path" from "utils_workflow"."instructions" as "x" where ("x"."namespace" = $2::text) and exists (select 1 as "_" from "utils_workflow"."runs" as "m" where ("m"."namespace" = "x"."namespace") and ("m"."id" = "x"."run") and ("m"."family" = ($3::text)::uuid)) order by "x"."namespace" asc, "x"."run" asc, "x"."path" asc limit $4::bigint)) returning ("utils_workflow"."instructions"."namespace")::text as "key";

-- maintenance.purge.jobs
delete from "utils_workflow"."jobs" where ("utils_workflow"."jobs"."namespace" = $1::text) and (("utils_workflow"."jobs"."namespace", "utils_workflow"."jobs"."id") in (select "x"."namespace" as "namespace", "x"."id" as "id" from "utils_workflow"."jobs" as "x" where ("x"."namespace" = $2::text) and exists (select 1 as "_" from "utils_workflow"."runs" as "m" where ("m"."namespace" = "x"."namespace") and ("m"."id" = "x"."run") and ("m"."family" = ($3::text)::uuid)) order by "x"."namespace" asc, "x"."id" asc limit $4::bigint)) returning ("utils_workflow"."jobs"."namespace")::text as "key";

-- maintenance.purge.progress
delete from "utils_workflow"."progress" where ("utils_workflow"."progress"."namespace" = $1::text) and (("utils_workflow"."progress"."namespace", "utils_workflow"."progress"."run", "utils_workflow"."progress"."job", "utils_workflow"."progress"."effect") in (select "x"."namespace" as "namespace", "x"."run" as "run", "x"."job" as "job", "x"."effect" as "effect" from "utils_workflow"."progress" as "x" where ("x"."namespace" = $2::text) and exists (select 1 as "_" from "utils_workflow"."runs" as "m" where ("m"."namespace" = "x"."namespace") and ("m"."id" = "x"."run") and ("m"."family" = ($3::text)::uuid)) order by "x"."namespace" asc, "x"."run" asc, "x"."job" asc, "x"."effect" asc limit $4::bigint)) returning ("utils_workflow"."progress"."namespace")::text as "key";

-- maintenance.purge.receipts
delete from "utils_workflow"."receipts" where ("utils_workflow"."receipts"."namespace" = $1::text) and (("utils_workflow"."receipts"."namespace", "utils_workflow"."receipts"."job", "utils_workflow"."receipts"."key") in (select "x"."namespace" as "namespace", "x"."job" as "job", "x"."key" as "key" from "utils_workflow"."receipts" as "x" where ("x"."namespace" = $2::text) and exists (select 1 as "_" from "utils_workflow"."jobs" join "utils_workflow"."runs" as "m" on ("m"."namespace" = "utils_workflow"."jobs"."namespace") and ("m"."id" = "utils_workflow"."jobs"."run") where ("utils_workflow"."jobs"."namespace" = "x"."namespace") and ("utils_workflow"."jobs"."id" = "x"."job") and ("m"."family" = ($3::text)::uuid)) order by "x"."namespace" asc, "x"."job" asc, "x"."key" asc limit $4::bigint)) returning ("utils_workflow"."receipts"."namespace")::text as "key";

-- maintenance.purge.run_events
delete from "utils_workflow"."run_events" where ("utils_workflow"."run_events"."namespace" = $1::text) and (("utils_workflow"."run_events"."namespace", "utils_workflow"."run_events"."run", "utils_workflow"."run_events"."sequence") in (select "x"."namespace" as "namespace", "x"."run" as "run", "x"."sequence" as "sequence" from "utils_workflow"."run_events" as "x" where ("x"."namespace" = $2::text) and exists (select 1 as "_" from "utils_workflow"."runs" as "m" where ("m"."namespace" = "x"."namespace") and ("m"."id" = "x"."run") and ("m"."family" = ($3::text)::uuid)) order by "x"."namespace" asc, "x"."run" asc, "x"."sequence" asc limit $4::bigint)) returning ("utils_workflow"."run_events"."namespace")::text as "key";

-- migration.activeHost
select ("utils_workflow"."hosts"."id")::text as "id" from "utils_workflow"."hosts" where (not "utils_workflow"."hosts"."draining") and ("utils_workflow"."hosts"."expires" > clock_timestamp()) limit $1::bigint;

-- migration.install.0
create table if not exists "utils_workflow"."hosts" ("namespace" text not null, "id" text not null, "generation" integer not null, "definitions" jsonb not null, "engine" text not null, "activations" integer not null, "activities" integer not null, "expires" timestamptz not null, "draining" boolean not null default false::boolean, "compute" jsonb not null default ('[]'::text)::jsonb, "affinity" jsonb not null default ('{}'::text)::jsonb, primary key ("namespace", "id"));

-- migration.install.1
create table if not exists "utils_workflow"."runs" ("namespace" text not null, "id" uuid not null, "scope" text not null, "key" text not null, "kind" text not null, "definition" text not null, "version" text not null, "input" jsonb not null, "fingerprint" text not null, "policy" jsonb not null, "policyhash" text not null, "state" text not null, "epoch" integer not null default 1::integer, "generation" integer not null default 0::integer, "host" text, "host_generation" integer, "expires" timestamptz, "outcome" jsonb, "reason" text, "family" uuid not null, "parent" uuid, "cancellation" text, "reservation" jsonb not null, "successors" integer not null default 0::integer, "children" integer not null default 0::integer, "created" timestamptz not null default clock_timestamp(), "trace" jsonb, "paused" boolean not null default false::boolean, "control_revision" integer not null default 0::integer, "updated_at" timestamptz not null default clock_timestamp(), "finished_at" timestamptz, "chain_root" uuid not null, "chain_index" integer not null default 0::integer, "continued_to" uuid, "continuation" jsonb, "location" jsonb, primary key ("namespace", "id"), unique ("namespace", "scope", "kind", "definition", "key"), check ("kind" in ('activity'::text, 'workflow'::text)), check ("state" in ('ready'::text, 'advancing'::text, 'waiting'::text, 'settling'::text, 'blocked'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'continued'::text)));

-- migration.install.10
create table if not exists "utils_workflow"."run_events" ("namespace" text not null, "run" uuid not null, "sequence" bigint not null, "recorded_at" timestamptz not null default clock_timestamp(), "kind" text not null, "job_id" uuid, "prior_state" text, "state" text not null, "paused" boolean not null, "control_revision" integer not null, "epoch" integer not null, "action" text, "actor" text, "reason" text, primary key ("namespace", "run", "sequence"), check ("kind" in ('baseline'::text, 'run'::text, 'job'::text, 'operator'::text)), foreign key ("namespace", "run") references "utils_workflow"."runs" ("namespace", "id"));

-- migration.install.11
create table if not exists "utils_workflow"."compute" ("namespace" text not null, "id" text not null, "generation" bigint not null, "value" jsonb not null, primary key ("namespace", "id"));

-- migration.install.12
alter table "utils_workflow"."runs" add column if not exists "trace" jsonb;

-- migration.install.13
alter table "utils_workflow"."instructions" add column if not exists "parent" text;

-- migration.install.14
alter table "utils_workflow"."instructions" add column if not exists "branches" jsonb;

-- migration.install.15
alter table "utils_workflow"."instructions" add column if not exists "event" text;

-- migration.install.16
alter table "utils_workflow"."instructions" add column if not exists "event_key" text;

-- migration.install.17
alter table "utils_workflow"."runs" add column if not exists "paused" boolean not null default false::boolean;

-- migration.install.18
alter table "utils_workflow"."runs" add column if not exists "control_revision" integer not null default 0::integer;

-- migration.install.19
alter table "utils_workflow"."runs" add column if not exists "updated_at" timestamptz not null default clock_timestamp();

-- migration.install.2
create table if not exists "utils_workflow"."jobs" ("namespace" text not null, "id" uuid not null, "run" uuid not null, "path" text not null, "definition" jsonb not null, "input" jsonb not null, "rules" jsonb not null, "state" text not null, "finalizer" boolean not null default false::boolean, "generation" integer not null default 0::integer, "sequence" integer not null default 0::integer, "budget" integer not null, "host" text, "host_generation" integer, "expires" timestamptz, "deadline" timestamptz, "available" timestamptz not null default clock_timestamp(), "outcome" jsonb, "location" jsonb, "affinity" jsonb, primary key ("namespace", "id"), unique ("namespace", "run", "path"), check ("state" in ('ready'::text, 'claimed'::text, 'completed'::text, 'failed'::text, 'blocked'::text)), foreign key ("namespace", "run") references "utils_workflow"."runs" ("namespace", "id"));

-- migration.install.20
alter table "utils_workflow"."runs" add column if not exists "finished_at" timestamptz;

-- migration.install.21
alter table "utils_workflow"."runs" add column if not exists "chain_root" uuid;

-- migration.install.22
alter table "utils_workflow"."runs" add column if not exists "chain_index" integer not null default 0::integer;

-- migration.install.23
alter table "utils_workflow"."runs" add column if not exists "continued_to" uuid;

-- migration.install.24
alter table "utils_workflow"."runs" add column if not exists "continuation" jsonb;

-- migration.install.25
alter table "utils_workflow"."progress" add column if not exists "reported_at" timestamptz not null default clock_timestamp();

-- migration.install.26
alter table "utils_workflow"."runs" add column if not exists "location" jsonb;

-- migration.install.27
alter table "utils_workflow"."jobs" add column if not exists "location" jsonb;

-- migration.install.28
alter table "utils_workflow"."jobs" add column if not exists "affinity" jsonb;

-- migration.install.29
alter table "utils_workflow"."hosts" add column if not exists "compute" jsonb not null default ('[]'::text)::jsonb;

-- migration.install.3
create table if not exists "utils_workflow"."attempts" ("namespace" text not null, "job" uuid not null, "generation" integer not null, "sequence" integer not null, "state" text not null, "outcome" jsonb, "started" timestamptz not null default clock_timestamp(), "ended" timestamptz, primary key ("namespace", "job", "generation"), foreign key ("namespace", "job") references "utils_workflow"."jobs" ("namespace", "id"));

-- migration.install.30
alter table "utils_workflow"."hosts" add column if not exists "affinity" jsonb not null default ('{}'::text)::jsonb;

-- migration.install.31
update "utils_workflow"."runs" set "chain_root" = "utils_workflow"."runs"."id" where "utils_workflow"."runs"."chain_root" is null;

-- migration.install.32
alter table "utils_workflow"."runs" alter column "chain_root" set not null;

-- migration.install.33
alter table "utils_workflow"."runs" drop constraint if exists "runs_state_check";

-- migration.install.34
alter table "utils_workflow"."runs" add constraint "runs_state_check" check ("state" in ('ready'::text, 'advancing'::text, 'waiting'::text, 'settling'::text, 'blocked'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'continued'::text));

-- migration.install.35
update "utils_workflow"."runs" set "finished_at" = clock_timestamp() where ("utils_workflow"."runs"."state" in ($1::text, $2::text, $3::text, $4::text)) and ("utils_workflow"."runs"."finished_at" is null);

-- migration.install.36
insert into "utils_workflow"."run_events" ("namespace", "run", "sequence", "kind", "state", "paused", "control_revision", "epoch") select "utils_workflow"."runs"."namespace" as "namespace", "utils_workflow"."runs"."id" as "run", ($1::text)::bigint as "sequence", $2::text as "kind", "utils_workflow"."runs"."state" as "state", "utils_workflow"."runs"."paused" as "paused", "utils_workflow"."runs"."control_revision" as "control_revision", "utils_workflow"."runs"."epoch" as "epoch" from "utils_workflow"."runs" where not exists (select "utils_workflow"."run_events"."run" as "run" from "utils_workflow"."run_events" where ("utils_workflow"."run_events"."namespace" = "utils_workflow"."runs"."namespace") and ("utils_workflow"."run_events"."run" = "utils_workflow"."runs"."id"));

-- migration.install.37
create index if not exists "hosts_compute" on "utils_workflow"."hosts" using gin ("compute");

-- migration.install.38
create index if not exists "runs_ready" on "utils_workflow"."runs" ("namespace", "state", "created");

-- migration.install.39
create index if not exists "runs_expiry" on "utils_workflow"."runs" ("namespace", "expires") where "state" = 'advancing'::text;

-- migration.install.4
create table if not exists "utils_workflow"."instructions" ("namespace" text not null, "run" uuid not null, "path" text not null, "fingerprint" text not null, "type" text not null, "job" uuid, "child" uuid, "due" timestamptz, "discard" boolean not null default false::boolean, "outcome" jsonb, "bytes" integer not null, "parent" text, "branches" jsonb, "event" text, "event_key" text, primary key ("namespace", "run", "path"), foreign key ("namespace", "run") references "utils_workflow"."runs" ("namespace", "id"));

-- migration.install.40
create index if not exists "runs_family" on "utils_workflow"."runs" ("namespace", "family", "state");

-- migration.install.41
create index if not exists "runs_parent" on "utils_workflow"."runs" ("namespace", "parent");

-- migration.install.42
create index if not exists "runs_finished" on "utils_workflow"."runs" ("namespace", "finished_at", "id") where ("id" = "family") and ("state" in ('completed'::text, 'failed'::text, 'cancelled'::text, 'continued'::text));

-- migration.install.43
create index if not exists "jobs_due" on "utils_workflow"."jobs" ("namespace", "state", "available");

-- migration.install.44
create index if not exists "jobs_expiry" on "utils_workflow"."jobs" ("namespace", "expires") where "state" = 'claimed'::text;

-- migration.install.45
create index if not exists "jobs_host" on "utils_workflow"."jobs" ("namespace", "host", "host_generation", "state");

-- migration.install.46
create index if not exists "instructions_timers" on "utils_workflow"."instructions" ("namespace", "due") where ("outcome" is null) and ("due" is not null);

-- migration.install.47
create index if not exists "instructions_child" on "utils_workflow"."instructions" ("namespace", "child") where "outcome" is null;

-- migration.install.48
create index if not exists "instructions_parent" on "utils_workflow"."instructions" ("namespace", "run", "parent");

-- migration.install.49
create unique index if not exists "instructions_event" on "utils_workflow"."instructions" ("namespace", "run", "event", "event_key") where "event" is not null;

-- migration.install.5
create table if not exists "utils_workflow"."cleanups" ("namespace" text not null, "run" uuid not null, "path" text not null, "scope" text, "ordinal" bigserial not null, "request" jsonb not null, "state" text not null default 'pending'::text, "job" uuid, "child" uuid, "outcome" jsonb, primary key ("namespace", "run", "path"), foreign key ("namespace", "run") references "utils_workflow"."runs" ("namespace", "id"));

-- migration.install.50
create index if not exists "cleanups_pending" on "utils_workflow"."cleanups" ("namespace", "run", "state", "ordinal");

-- migration.install.51
create or replace function "utils_workflow"."notify"() returns trigger language plpgsql as $body$ begin perform "pg_notify"('utils_workflow'::text, "new"."namespace"); return null; end; $body$;

-- migration.install.52
create or replace function "utils_workflow"."touch_run"() returns trigger language plpgsql as $body$ begin if tg_op = 'INSERT'::text then "new"."chain_root" = coalesce("new"."chain_root", "new"."id"); "new"."updated_at" = clock_timestamp(); else if row("old"."state", "old"."outcome", "old"."reason", "old"."paused", "old"."control_revision", "old"."epoch", "old"."continued_to", "old"."continuation") is distinct from row("new"."state", "new"."outcome", "new"."reason", "new"."paused", "new"."control_revision", "new"."epoch", "new"."continued_to", "new"."continuation") then "new"."updated_at" = clock_timestamp(); end if; end if; if "new"."state" in ('completed'::text, 'failed'::text, 'cancelled'::text, 'continued'::text) then if (tg_op = 'INSERT'::text) or (not ("old"."state" in ('completed'::text, 'failed'::text, 'cancelled'::text, 'continued'::text))) then "new"."finished_at" = clock_timestamp(); end if; else "new"."finished_at" = cast(null as timestamptz); end if; return new; end; $body$;

-- migration.install.53
create or replace function "utils_workflow"."record_run"() returns trigger language plpgsql as $body$ begin if (tg_op = 'UPDATE'::text) and (row("old"."state", "old"."outcome", "old"."reason", "old"."paused", "old"."control_revision", "old"."epoch", "old"."continued_to", "old"."continuation") is not distinct from row("new"."state", "new"."outcome", "new"."reason", "new"."paused", "new"."control_revision", "new"."epoch", "new"."continued_to", "new"."continuation")) then return new; end if; insert into "utils_workflow"."run_events" ("namespace", "run", "sequence", "kind", "prior_state", "state", "paused", "control_revision", "epoch") values ("new"."namespace", "new"."id", (select (coalesce(max("utils_workflow"."run_events"."sequence"), ('0'::text)::bigint) + ('1'::text)::bigint) as "next" from "utils_workflow"."run_events" where ("utils_workflow"."run_events"."namespace" = "new"."namespace") and ("utils_workflow"."run_events"."run" = "new"."id")), 'run'::text, case when tg_op = 'UPDATE'::text then "old"."state" else cast(null as text) end, "new"."state", "new"."paused", "new"."control_revision", "new"."epoch"); return new; end; $body$;

-- migration.install.54
create or replace function "utils_workflow"."record_job"() returns trigger language plpgsql as $body$ begin if (tg_op = 'UPDATE'::text) and ("old"."state" is not distinct from "new"."state") then return new; end if; insert into "utils_workflow"."run_events" ("namespace", "run", "sequence", "kind", "job_id", "prior_state", "state", "paused", "control_revision", "epoch") select "new"."namespace" as "namespace", "new"."run" as "run", (select (coalesce(max("utils_workflow"."run_events"."sequence"), ('0'::text)::bigint) + ('1'::text)::bigint) as "next" from "utils_workflow"."run_events" where ("utils_workflow"."run_events"."namespace" = "new"."namespace") and ("utils_workflow"."run_events"."run" = "new"."run")) as "sequence", 'job'::text as "kind", "new"."id" as "job_id", case when tg_op = 'UPDATE'::text then "old"."state" else cast(null as text) end as "prior_state", "new"."state" as "state", "utils_workflow"."runs"."paused" as "paused", "utils_workflow"."runs"."control_revision" as "control_revision", "utils_workflow"."runs"."epoch" as "epoch" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = "new"."namespace") and ("utils_workflow"."runs"."id" = "new"."run"); if not found then raise exception using message = 'The run of a changed workflow job is missing.'::text; end if; return new; end; $body$;

-- migration.install.55
create or replace function "utils_workflow"."record_operator"() returns trigger language plpgsql as $body$ begin insert into "utils_workflow"."run_events" ("namespace", "run", "sequence", "kind", "state", "paused", "control_revision", "epoch", "action", "actor", "reason") select "new"."namespace" as "namespace", "new"."run" as "run", (select (coalesce(max("utils_workflow"."run_events"."sequence"), ('0'::text)::bigint) + ('1'::text)::bigint) as "next" from "utils_workflow"."run_events" where ("utils_workflow"."run_events"."namespace" = "new"."namespace") and ("utils_workflow"."run_events"."run" = "new"."run")) as "sequence", 'operator'::text as "kind", "utils_workflow"."runs"."state" as "state", "utils_workflow"."runs"."paused" as "paused", "utils_workflow"."runs"."control_revision" as "control_revision", "new"."epoch" as "epoch", "new"."action" as "action", "new"."actor" as "actor", "new"."reason" as "reason" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = "new"."namespace") and ("utils_workflow"."runs"."id" = "new"."run"); if not found then raise exception using message = 'The run of an operator decision is missing.'::text; end if; return new; end; $body$;

-- migration.install.56
drop trigger if exists "hosts_insert" on "utils_workflow"."hosts";

-- migration.install.57
create trigger "hosts_insert" after insert on "utils_workflow"."hosts" for each row execute function "utils_workflow"."notify"();

-- migration.install.58
drop trigger if exists "hosts_change" on "utils_workflow"."hosts";

-- migration.install.59
create trigger "hosts_change" after update of "generation", "draining" on "utils_workflow"."hosts" for each row when (("old"."generation" is distinct from "new"."generation") or ("old"."draining" is distinct from "new"."draining")) execute function "utils_workflow"."notify"();

-- migration.install.6
create table if not exists "utils_workflow"."receipts" ("namespace" text not null, "job" uuid not null, "key" text not null, "contract" text not null, "fingerprint" text not null, "value" jsonb not null, "created" timestamptz not null default clock_timestamp(), primary key ("namespace", "job", "key"), foreign key ("namespace", "job") references "utils_workflow"."jobs" ("namespace", "id"));

-- migration.install.60
drop trigger if exists "runs_insert" on "utils_workflow"."runs";

-- migration.install.61
create trigger "runs_insert" after insert on "utils_workflow"."runs" for each row execute function "utils_workflow"."notify"();

-- migration.install.62
drop trigger if exists "runs_change" on "utils_workflow"."runs";

-- migration.install.63
create trigger "runs_change" after update of "state", "paused" on "utils_workflow"."runs" for each row when (("old"."state" is distinct from "new"."state") or ("old"."paused" is distinct from "new"."paused")) execute function "utils_workflow"."notify"();

-- migration.install.64
drop trigger if exists "jobs_insert" on "utils_workflow"."jobs";

-- migration.install.65
create trigger "jobs_insert" after insert on "utils_workflow"."jobs" for each row execute function "utils_workflow"."notify"();

-- migration.install.66
drop trigger if exists "jobs_change" on "utils_workflow"."jobs";

-- migration.install.67
create trigger "jobs_change" after update of "state", "available" on "utils_workflow"."jobs" for each row when (("old"."state" is distinct from "new"."state") or ("old"."available" is distinct from "new"."available")) execute function "utils_workflow"."notify"();

-- migration.install.68
drop trigger if exists "instructions_insert" on "utils_workflow"."instructions";

-- migration.install.69
create trigger "instructions_insert" after insert on "utils_workflow"."instructions" for each row when (("new"."outcome" is null) and ("new"."due" is not null)) execute function "utils_workflow"."notify"();

-- migration.install.7
create table if not exists "utils_workflow"."audit" ("namespace" text not null, "id" uuid not null, "run" uuid not null, "epoch" integer not null, "actor" text not null, "reason" text not null, "action" text not null, "created" timestamptz not null default clock_timestamp(), primary key ("namespace", "id"), foreign key ("namespace", "run") references "utils_workflow"."runs" ("namespace", "id"));

-- migration.install.70
drop trigger if exists "runs_touch" on "utils_workflow"."runs";

-- migration.install.71
create trigger "runs_touch" before insert or update of "state", "outcome", "reason", "paused", "control_revision", "epoch", "continued_to", "continuation" on "utils_workflow"."runs" for each row execute function "utils_workflow"."touch_run"();

-- migration.install.72
drop trigger if exists "runs_events" on "utils_workflow"."runs";

-- migration.install.73
create trigger "runs_events" after insert or update of "state", "outcome", "reason", "paused", "control_revision", "epoch", "continued_to", "continuation" on "utils_workflow"."runs" for each row execute function "utils_workflow"."record_run"();

-- migration.install.74
drop trigger if exists "jobs_events" on "utils_workflow"."jobs";

-- migration.install.75
create trigger "jobs_events" after insert or update of "state" on "utils_workflow"."jobs" for each row execute function "utils_workflow"."record_job"();

-- migration.install.76
drop trigger if exists "audit_events" on "utils_workflow"."audit";

-- migration.install.77
create trigger "audit_events" after insert on "utils_workflow"."audit" for each row execute function "utils_workflow"."record_operator"();

-- migration.install.78
update "utils_workflow"."version" set "version" = $1::integer where "utils_workflow"."version"."id";

-- migration.install.8
create table if not exists "utils_workflow"."events" ("namespace" text not null, "run" uuid not null, "event" text not null, "key" text not null, "value" jsonb not null, "fingerprint" text not null, "bytes" integer not null, "created" timestamptz not null default clock_timestamp(), primary key ("namespace", "run", "event", "key"), foreign key ("namespace", "run") references "utils_workflow"."runs" ("namespace", "id"));

-- migration.install.9
create table if not exists "utils_workflow"."progress" ("namespace" text not null, "run" uuid not null, "job" uuid not null, "effect" text not null, "generation" integer not null, "sequence" integer not null, "attempt" integer not null, "revision" uuid not null, "occurrence" jsonb not null, "bytes" integer not null, "reported_at" timestamptz not null default clock_timestamp(), primary key ("namespace", "run", "job", "effect"), foreign key ("namespace", "job") references "utils_workflow"."jobs" ("namespace", "id"));

-- migration.installed
select ("information_schema"."columns"."table_name")::text as "table", ("information_schema"."columns"."column_name")::text as "column", ("information_schema"."columns"."data_type")::text as "type" from "information_schema"."columns" where "information_schema"."columns"."table_schema" = $1::text;

-- migration.lock
select ("pg_advisory_xact_lock"(($1::text)::bigint))::text as "locked";

-- migration.lockTimeout
select (set_config($1::text, $2::text, true))::text as "timeout";

-- migration.prepare.0
create schema if not exists "utils_workflow";

-- migration.prepare.1
create table if not exists "utils_workflow"."version" ("id" boolean not null default true::boolean, "version" integer not null, primary key ("id"), check ("id"));

-- migration.prepare.2
insert into "utils_workflow"."version" ("id", "version") values ($1::boolean, $2::integer) on conflict do nothing;

-- migration.present
select (to_regclass($1::text) is not null)::boolean as "version", (to_regclass($2::text) is not null)::boolean as "hosts";

-- migration.registration
select ("pg_advisory_xact_lock_shared"(($1::text)::bigint))::text as "locked";

-- migration.stored
select ("utils_workflow"."version"."version")::integer as "version" from "utils_workflow"."version" where "utils_workflow"."version"."id";

-- runs.activation
select ("utils_workflow"."runs"."id")::text as "id" from "utils_workflow"."runs" where (("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."id" = ($2::text)::uuid)) and ("utils_workflow"."runs"."state" = $3::text) and ("utils_workflow"."runs"."generation" = $4::integer) and ("utils_workflow"."runs"."host" = $5::text) and ("utils_workflow"."runs"."host_generation" = $6::integer) and ("utils_workflow"."runs"."expires" > clock_timestamp());

-- runs.activations
select ("utils_workflow"."hosts"."activations")::integer as "limit", ((select (count(*))::integer as "count" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = "utils_workflow"."hosts"."namespace") and ("utils_workflow"."runs"."host" = "utils_workflow"."hosts"."id") and ("utils_workflow"."runs"."host_generation" = "utils_workflow"."hosts"."generation") and ("utils_workflow"."runs"."state" = $1::text) and ("utils_workflow"."runs"."expires" > clock_timestamp())))::integer as "active" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = $2::text) and ("utils_workflow"."hosts"."id" = $3::text);

-- runs.addChild
update "utils_workflow"."runs" set "children" = "utils_workflow"."runs"."children" + $1::integer where ("utils_workflow"."runs"."namespace" = $2::text) and ("utils_workflow"."runs"."id" = ($3::text)::uuid);

-- runs.addSuccessor
update "utils_workflow"."runs" set "successors" = "utils_workflow"."runs"."successors" + $1::integer where ("utils_workflow"."runs"."namespace" = $2::text) and ("utils_workflow"."runs"."id" = ($3::text)::uuid);

-- runs.admit
insert into "utils_workflow"."runs" ("namespace", "id", "scope", "key", "kind", "definition", "version", "input", "fingerprint", "policy", "policyhash", "state", "family", "parent", "cancellation", "reservation", "trace", "location") values ($1::text, ($2::text)::uuid, $3::text, $4::text, $5::text, $6::text, $7::text, ($8::text)::jsonb, $9::text, ($10::text)::jsonb, $11::text, $12::text, ($13::text)::uuid, cast(null as uuid), $14::text, ($15::text)::jsonb, cast(null as jsonb), cast(null as jsonb));

-- runs.advance
update "utils_workflow"."runs" set "state" = $1::text, "generation" = $2::integer, "host" = $3::text, "host_generation" = $4::integer, "expires" = clock_timestamp() + $5::double precision * interval '1 millisecond' where ("utils_workflow"."runs"."namespace" = $6::text) and ("utils_workflow"."runs"."id" = ($7::text)::uuid);

-- runs.block
update "utils_workflow"."runs" set "state" = $1::text, "reason" = $2::text where ("utils_workflow"."runs"."namespace" = $3::text) and ("utils_workflow"."runs"."id" = ($4::text)::uuid);

-- runs.block.release
update "utils_workflow"."runs" set "state" = $1::text, "reason" = $2::text, "expires" = cast(null as timestamptz) where ("utils_workflow"."runs"."namespace" = $3::text) and ("utils_workflow"."runs"."id" = ($4::text)::uuid);

-- runs.children
select ((count(*))::integer)::integer as "count" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."parent" = ($2::text)::uuid) and ("utils_workflow"."runs"."kind" = $3::text) and ("utils_workflow"."runs"."definition" = $4::text) and ("utils_workflow"."runs"."version" = $5::text);

-- runs.close
update "utils_workflow"."runs" set "state" = $1::text, "reason" = cast(null as text) where ("utils_workflow"."runs"."namespace" = $2::text) and ("utils_workflow"."runs"."id" = ($3::text)::uuid);

-- runs.control
update "utils_workflow"."runs" set "paused" = $1::boolean, "control_revision" = $2::integer where ("utils_workflow"."runs"."namespace" = $3::text) and ("utils_workflow"."runs"."id" = ($4::text)::uuid);

-- runs.extend
update "utils_workflow"."runs" set "expires" = clock_timestamp() + $1::double precision * interval '1 millisecond' where ("utils_workflow"."runs"."namespace" = $2::text) and ("utils_workflow"."runs"."id" = ($3::text)::uuid);

-- runs.keyed
select ("utils_workflow"."runs"."namespace")::text as "namespace", ("utils_workflow"."runs"."id")::text as "id", ("utils_workflow"."runs"."scope")::text as "scope", ("utils_workflow"."runs"."key")::text as "key", ("utils_workflow"."runs"."kind")::text as "kind", ("utils_workflow"."runs"."definition")::text as "definition", ("utils_workflow"."runs"."version")::text as "version", ("utils_workflow"."runs"."input")::text as "input", ("utils_workflow"."runs"."fingerprint")::text as "fingerprint", ("utils_workflow"."runs"."policy")::text as "policy", ("utils_workflow"."runs"."policyhash")::text as "policyhash", ("utils_workflow"."runs"."state")::text as "state", ("utils_workflow"."runs"."epoch")::integer as "epoch", ("utils_workflow"."runs"."generation")::integer as "generation", ("utils_workflow"."runs"."host")::text as "host", ("utils_workflow"."runs"."host_generation")::integer as "host_generation", to_char(("utils_workflow"."runs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("utils_workflow"."runs"."outcome")::text as "outcome", ("utils_workflow"."runs"."reason")::text as "reason", ("utils_workflow"."runs"."family")::text as "family", ("utils_workflow"."runs"."parent")::text as "parent", ("utils_workflow"."runs"."cancellation")::text as "cancellation", ("utils_workflow"."runs"."reservation")::text as "reservation", ("utils_workflow"."runs"."successors")::integer as "successors", ("utils_workflow"."runs"."children")::integer as "children", to_char(("utils_workflow"."runs"."created") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "created", ("utils_workflow"."runs"."trace")::text as "trace", ("utils_workflow"."runs"."paused")::boolean as "paused", ("utils_workflow"."runs"."control_revision")::integer as "control_revision", to_char(("utils_workflow"."runs"."updated_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updated_at", to_char(("utils_workflow"."runs"."finished_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "finished_at", ("utils_workflow"."runs"."chain_root")::text as "chain_root", ("utils_workflow"."runs"."chain_index")::integer as "chain_index", ("utils_workflow"."runs"."continued_to")::text as "continued_to", ("utils_workflow"."runs"."continuation")::text as "continuation", ("utils_workflow"."runs"."location")::text as "location" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."scope" = $2::text) and ("utils_workflow"."runs"."kind" = $3::text) and ("utils_workflow"."runs"."definition" = $4::text) and ("utils_workflow"."runs"."key" = $5::text);

-- runs.note
update "utils_workflow"."runs" set "reason" = $1::text where ("utils_workflow"."runs"."namespace" = $2::text) and ("utils_workflow"."runs"."id" = ($3::text)::uuid);

-- runs.ready
select ("utils_workflow"."runs"."namespace")::text as "namespace", ("utils_workflow"."runs"."id")::text as "id", ("utils_workflow"."runs"."scope")::text as "scope", ("utils_workflow"."runs"."key")::text as "key", ("utils_workflow"."runs"."kind")::text as "kind", ("utils_workflow"."runs"."definition")::text as "definition", ("utils_workflow"."runs"."version")::text as "version", ("utils_workflow"."runs"."input")::text as "input", ("utils_workflow"."runs"."fingerprint")::text as "fingerprint", ("utils_workflow"."runs"."policy")::text as "policy", ("utils_workflow"."runs"."policyhash")::text as "policyhash", ("utils_workflow"."runs"."state")::text as "state", ("utils_workflow"."runs"."epoch")::integer as "epoch", ("utils_workflow"."runs"."generation")::integer as "generation", ("utils_workflow"."runs"."host")::text as "host", ("utils_workflow"."runs"."host_generation")::integer as "host_generation", to_char(("utils_workflow"."runs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("utils_workflow"."runs"."outcome")::text as "outcome", ("utils_workflow"."runs"."reason")::text as "reason", ("utils_workflow"."runs"."family")::text as "family", ("utils_workflow"."runs"."parent")::text as "parent", ("utils_workflow"."runs"."cancellation")::text as "cancellation", ("utils_workflow"."runs"."reservation")::text as "reservation", ("utils_workflow"."runs"."successors")::integer as "successors", ("utils_workflow"."runs"."children")::integer as "children", to_char(("utils_workflow"."runs"."created") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "created", ("utils_workflow"."runs"."trace")::text as "trace", ("utils_workflow"."runs"."paused")::boolean as "paused", ("utils_workflow"."runs"."control_revision")::integer as "control_revision", to_char(("utils_workflow"."runs"."updated_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updated_at", to_char(("utils_workflow"."runs"."finished_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "finished_at", ("utils_workflow"."runs"."chain_root")::text as "chain_root", ("utils_workflow"."runs"."chain_index")::integer as "chain_index", ("utils_workflow"."runs"."continued_to")::text as "continued_to", ("utils_workflow"."runs"."continuation")::text as "continuation", ("utils_workflow"."runs"."location")::text as "location" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."state" = $2::text) and ("utils_workflow"."runs"."kind" = $3::text) and (not "utils_workflow"."runs"."paused") and exists (select 1 as "_" from jsonb_array_elements(($4::text)::jsonb) as "d" where ("d"."value" ->> $5::text) = "utils_workflow"."runs"."definition") and (exists (select 1 as "_" from jsonb_array_elements(($6::text)::jsonb) as "d" where (("d"."value" ->> $7::text) = "utils_workflow"."runs"."definition") and (("d"."value" ->> $8::text) = "utils_workflow"."runs"."version")) or (not exists (select 1 as "_" from "utils_workflow"."hosts" where ("utils_workflow"."hosts"."namespace" = "utils_workflow"."runs"."namespace") and (not "utils_workflow"."hosts"."draining") and ("utils_workflow"."hosts"."expires" > clock_timestamp()) and ("utils_workflow"."hosts"."definitions" @> jsonb_build_array(jsonb_build_object($9::text, $10::text, $11::text, "utils_workflow"."runs"."definition", $12::text, "utils_workflow"."runs"."version")))))) order by "utils_workflow"."runs"."created" asc limit $13::bigint for update skip locked;

-- runs.repair
update "utils_workflow"."runs" set "epoch" = "utils_workflow"."runs"."epoch" + $1::integer, "generation" = "utils_workflow"."runs"."generation" + $2::integer, "state" = $3::text, "reason" = cast(null as text), "expires" = cast(null as timestamptz) where ("utils_workflow"."runs"."namespace" = $4::text) and ("utils_workflow"."runs"."id" = ($5::text)::uuid);

-- runs.rest
update "utils_workflow"."runs" set "state" = $1::text, "expires" = cast(null as timestamptz) where ("utils_workflow"."runs"."namespace" = $2::text) and ("utils_workflow"."runs"."id" = ($3::text)::uuid);

-- runs.run
select ("utils_workflow"."runs"."namespace")::text as "namespace", ("utils_workflow"."runs"."id")::text as "id", ("utils_workflow"."runs"."scope")::text as "scope", ("utils_workflow"."runs"."key")::text as "key", ("utils_workflow"."runs"."kind")::text as "kind", ("utils_workflow"."runs"."definition")::text as "definition", ("utils_workflow"."runs"."version")::text as "version", ("utils_workflow"."runs"."input")::text as "input", ("utils_workflow"."runs"."fingerprint")::text as "fingerprint", ("utils_workflow"."runs"."policy")::text as "policy", ("utils_workflow"."runs"."policyhash")::text as "policyhash", ("utils_workflow"."runs"."state")::text as "state", ("utils_workflow"."runs"."epoch")::integer as "epoch", ("utils_workflow"."runs"."generation")::integer as "generation", ("utils_workflow"."runs"."host")::text as "host", ("utils_workflow"."runs"."host_generation")::integer as "host_generation", to_char(("utils_workflow"."runs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("utils_workflow"."runs"."outcome")::text as "outcome", ("utils_workflow"."runs"."reason")::text as "reason", ("utils_workflow"."runs"."family")::text as "family", ("utils_workflow"."runs"."parent")::text as "parent", ("utils_workflow"."runs"."cancellation")::text as "cancellation", ("utils_workflow"."runs"."reservation")::text as "reservation", ("utils_workflow"."runs"."successors")::integer as "successors", ("utils_workflow"."runs"."children")::integer as "children", to_char(("utils_workflow"."runs"."created") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "created", ("utils_workflow"."runs"."trace")::text as "trace", ("utils_workflow"."runs"."paused")::boolean as "paused", ("utils_workflow"."runs"."control_revision")::integer as "control_revision", to_char(("utils_workflow"."runs"."updated_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updated_at", to_char(("utils_workflow"."runs"."finished_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "finished_at", ("utils_workflow"."runs"."chain_root")::text as "chain_root", ("utils_workflow"."runs"."chain_index")::integer as "chain_index", ("utils_workflow"."runs"."continued_to")::text as "continued_to", ("utils_workflow"."runs"."continuation")::text as "continuation", ("utils_workflow"."runs"."location")::text as "location" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."id" = ($2::text)::uuid);

-- runs.run.locked
select ("utils_workflow"."runs"."namespace")::text as "namespace", ("utils_workflow"."runs"."id")::text as "id", ("utils_workflow"."runs"."scope")::text as "scope", ("utils_workflow"."runs"."key")::text as "key", ("utils_workflow"."runs"."kind")::text as "kind", ("utils_workflow"."runs"."definition")::text as "definition", ("utils_workflow"."runs"."version")::text as "version", ("utils_workflow"."runs"."input")::text as "input", ("utils_workflow"."runs"."fingerprint")::text as "fingerprint", ("utils_workflow"."runs"."policy")::text as "policy", ("utils_workflow"."runs"."policyhash")::text as "policyhash", ("utils_workflow"."runs"."state")::text as "state", ("utils_workflow"."runs"."epoch")::integer as "epoch", ("utils_workflow"."runs"."generation")::integer as "generation", ("utils_workflow"."runs"."host")::text as "host", ("utils_workflow"."runs"."host_generation")::integer as "host_generation", to_char(("utils_workflow"."runs"."expires") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expires", ("utils_workflow"."runs"."outcome")::text as "outcome", ("utils_workflow"."runs"."reason")::text as "reason", ("utils_workflow"."runs"."family")::text as "family", ("utils_workflow"."runs"."parent")::text as "parent", ("utils_workflow"."runs"."cancellation")::text as "cancellation", ("utils_workflow"."runs"."reservation")::text as "reservation", ("utils_workflow"."runs"."successors")::integer as "successors", ("utils_workflow"."runs"."children")::integer as "children", to_char(("utils_workflow"."runs"."created") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "created", ("utils_workflow"."runs"."trace")::text as "trace", ("utils_workflow"."runs"."paused")::boolean as "paused", ("utils_workflow"."runs"."control_revision")::integer as "control_revision", to_char(("utils_workflow"."runs"."updated_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updated_at", to_char(("utils_workflow"."runs"."finished_at") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "finished_at", ("utils_workflow"."runs"."chain_root")::text as "chain_root", ("utils_workflow"."runs"."chain_index")::integer as "chain_index", ("utils_workflow"."runs"."continued_to")::text as "continued_to", ("utils_workflow"."runs"."continuation")::text as "continuation", ("utils_workflow"."runs"."location")::text as "location" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and ("utils_workflow"."runs"."id" = ($2::text)::uuid) for update;

-- runs.settle
update "utils_workflow"."runs" set "state" = $1::text, "outcome" = ($2::text)::jsonb, "expires" = cast(null as timestamptz), "reason" = cast(null as text) where ("utils_workflow"."runs"."namespace" = $3::text) and ("utils_workflow"."runs"."id" = ($4::text)::uuid);

-- runs.usage
with "live_families" as materialized (select distinct "utils_workflow"."runs"."family" as "family" from "utils_workflow"."runs" where ("utils_workflow"."runs"."namespace" = $1::text) and (not ("utils_workflow"."runs"."state" in ($2::text, $3::text, $4::text, $5::text)))) select ((count(*))::integer)::integer as "roots", (coalesce(cast(sum(cast("utils_workflow"."runs"."reservation" ->> $6::text as integer)) as integer), $7::integer))::integer as "successors", (coalesce(cast(sum(cast("utils_workflow"."runs"."reservation" ->> $8::text as integer)) as integer), $9::integer))::integer as "children", (coalesce(cast(sum(cast("utils_workflow"."runs"."reservation" ->> $10::text as integer)) as integer), $11::integer))::integer as "finalizers" from "live_families" join "utils_workflow"."runs" on ("utils_workflow"."runs"."namespace" = $12::text) and ("utils_workflow"."runs"."id" = "live_families"."family") where ("utils_workflow"."runs"."id" = "utils_workflow"."runs"."family") and (("utils_workflow"."runs"."policy" ->> $13::text) = $14::text) and (("utils_workflow"."runs"."policy" ->> $15::text) = $16::text);

-- runs.wake
update "utils_workflow"."runs" set "state" = case when "utils_workflow"."runs"."state" = $1::text then "utils_workflow"."runs"."state" else $2::text end, "expires" = case when "utils_workflow"."runs"."state" = $3::text then "utils_workflow"."runs"."expires" else cast(null as timestamptz) end where ("utils_workflow"."runs"."namespace" = $4::text) and ("utils_workflow"."runs"."id" = ($5::text)::uuid);

-- runs.wake.state
update "utils_workflow"."runs" set "state" = case when "utils_workflow"."runs"."state" = $1::text then "utils_workflow"."runs"."state" else $2::text end where ("utils_workflow"."runs"."namespace" = $3::text) and ("utils_workflow"."runs"."id" = ($4::text)::uuid);

-- shared.due
select (($1::text)::timestamptz <= clock_timestamp())::boolean as "due";

-- shared.history
select (((select coalesce(cast(sum("utils_workflow"."instructions"."bytes") as integer), $1::integer) as "bytes" from "utils_workflow"."instructions" where ("utils_workflow"."instructions"."namespace" = $2::text) and ("utils_workflow"."instructions"."run" = ($3::text)::uuid)) + (select coalesce(cast(sum("utils_workflow"."events"."bytes") as integer), $4::integer) as "bytes" from "utils_workflow"."events" where ("utils_workflow"."events"."namespace" = $5::text) and ("utils_workflow"."events"."run" = ($6::text)::uuid))) + (select coalesce(cast(sum("utils_workflow"."progress"."bytes") as integer), $7::integer) as "bytes" from "utils_workflow"."progress" where ("utils_workflow"."progress"."namespace" = $8::text) and ("utils_workflow"."progress"."run" = ($9::text)::uuid)))::integer as "bytes";

-- shared.later
select to_char((clock_timestamp() + $1::double precision * interval '1 millisecond') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "at";

-- shared.limits.0
select (set_config($1::text, $2::text, true))::text as "value";

-- shared.limits.1
select (set_config($1::text, $2::text, true))::text as "value";

-- shared.limits.2
select (set_config($1::text, $2::text, true))::text as "value";

-- shared.limits.3
select (set_config($1::text, $2::text, true))::text as "value";

-- shared.named
select ("pg_advisory_xact_lock"("hashtextextended"($1::text, ($2::text)::bigint)))::text as "locked";
