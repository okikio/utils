-- Frozen schema-one fixture from the preserved WIP upload, for upgrade testing only.

create schema if not exists utils_workflow;
create table if not exists utils_workflow.version (id boolean primary key default true check(id), version integer not null);
insert into utils_workflow.version values (true, 1) on conflict do nothing;
create table if not exists utils_workflow.hosts (
 namespace text not null, id text not null, generation integer not null,
 definitions jsonb not null, engine text not null, activations integer not null, activities integer not null,
 expires timestamptz not null, draining boolean not null default false,
 primary key(namespace,id)
);
create table if not exists utils_workflow.runs (
 namespace text not null, id uuid not null, scope text not null, key text not null,
 kind text not null check(kind in ('activity','workflow')), definition text not null, version text not null,
 input jsonb not null, fingerprint text not null, policy jsonb not null, policyhash text not null,
 state text not null check(state in ('ready','advancing','waiting','settling','blocked','completed','failed','cancelled')),
 epoch integer not null default 1, generation integer not null default 0,
 host text, host_generation integer, expires timestamptz,
 outcome jsonb, reason text, family uuid not null, parent uuid, cancellation text,
 reservation jsonb not null, successors integer not null default 0, children integer not null default 0,
 created timestamptz not null default clock_timestamp(),
 primary key(namespace,id), unique(namespace,scope,kind,definition,key)
);
-- Optional diagnostic data. Old rows and older workers remain valid.
alter table utils_workflow.runs add column if not exists trace jsonb;
create index if not exists runs_ready on utils_workflow.runs(namespace,state,created);
create index if not exists runs_expiry on utils_workflow.runs(namespace,expires) where state='advancing';
create index if not exists runs_family on utils_workflow.runs(namespace,family,state);
create index if not exists runs_parent on utils_workflow.runs(namespace,parent);
create table if not exists utils_workflow.jobs (
 namespace text not null, id uuid not null, run uuid not null, path text not null,
 definition jsonb not null, input jsonb not null, rules jsonb not null,
 state text not null check(state in ('ready','claimed','completed','failed','blocked')),
 finalizer boolean not null default false, generation integer not null default 0,
 sequence integer not null default 0, budget integer not null,
 host text, host_generation integer, expires timestamptz, deadline timestamptz,
 available timestamptz not null default clock_timestamp(), outcome jsonb,
 primary key(namespace,id), unique(namespace,run,path),
 foreign key(namespace,run) references utils_workflow.runs(namespace,id)
);
create index if not exists jobs_due on utils_workflow.jobs(namespace,state,available);
create index if not exists jobs_expiry on utils_workflow.jobs(namespace,expires) where state='claimed';
create index if not exists jobs_host on utils_workflow.jobs(namespace,host,host_generation,state);
create table if not exists utils_workflow.attempts (
 namespace text not null, job uuid not null, generation integer not null, sequence integer not null,
 state text not null, outcome jsonb, started timestamptz not null default clock_timestamp(), ended timestamptz,
 primary key(namespace,job,generation), foreign key(namespace,job) references utils_workflow.jobs(namespace,id)
);
create table if not exists utils_workflow.instructions (
 namespace text not null, run uuid not null, path text not null, fingerprint text not null,
 type text not null, job uuid, child uuid, due timestamptz, discard boolean not null default false,
 outcome jsonb, bytes integer not null,
 primary key(namespace,run,path), foreign key(namespace,run) references utils_workflow.runs(namespace,id)
);
create index if not exists instructions_timers on utils_workflow.instructions(namespace,due) where outcome is null and due is not null;
create index if not exists instructions_child on utils_workflow.instructions(namespace,child) where outcome is null;
-- Saved scope cleanup is distinct from registration completion and survives process loss.
create table if not exists utils_workflow.cleanups (
 namespace text not null, run uuid not null, path text not null, scope text,
 ordinal bigserial, request jsonb not null, state text not null default 'pending',
 job uuid, child uuid, outcome jsonb,
 primary key(namespace,run,path), foreign key(namespace,run) references utils_workflow.runs(namespace,id)
);
create index if not exists cleanups_pending on utils_workflow.cleanups(namespace,run,state,ordinal);
create table if not exists utils_workflow.receipts (
 namespace text not null, job uuid not null, key text not null, contract text not null,
 fingerprint text not null, value jsonb not null, created timestamptz not null default clock_timestamp(),
 primary key(namespace,job,key), foreign key(namespace,job) references utils_workflow.jobs(namespace,id)
);
create table if not exists utils_workflow.audit (
 namespace text not null, id uuid not null, run uuid not null, epoch integer not null,
 actor text not null, reason text not null, action text not null, created timestamptz not null default clock_timestamp(),
 primary key(namespace,id), foreign key(namespace,run) references utils_workflow.runs(namespace,id)
);
-- Root instruction counts remain stable when controls add nested steps.
alter table utils_workflow.instructions add column if not exists parent text;
alter table utils_workflow.instructions add column if not exists branches jsonb;
create index if not exists instructions_parent on utils_workflow.instructions(namespace,run,parent);
-- Named events survive delivery before a wait and worker replacement.
alter table utils_workflow.instructions add column if not exists event text;
alter table utils_workflow.instructions add column if not exists event_key text;
create unique index if not exists instructions_event on utils_workflow.instructions(namespace,run,event,event_key) where event is not null;
create table if not exists utils_workflow.events (
 namespace text not null, run uuid not null, event text not null, key text not null,
 value jsonb not null, fingerprint text not null, bytes integer not null,
 created timestamptz not null default clock_timestamp(),
 primary key(namespace,run,event,key), foreign key(namespace,run) references utils_workflow.runs(namespace,id)
);
-- Only the latest report for each activity and declared effect is retained.
create table if not exists utils_workflow.progress (
 namespace text not null, run uuid not null, job uuid not null, effect text not null,
 generation integer not null, sequence integer not null, attempt integer not null,
 revision uuid not null, occurrence jsonb not null, bytes integer not null,
 primary key(namespace,run,job,effect), foreign key(namespace,job) references utils_workflow.jobs(namespace,id)
);
-- Hints are delivered only after commit. PostgreSQL coalesces identical namespace hints in one transaction.
-- Never include business data, and never notify for lease renewal or progress reports.
create or replace function utils_workflow.notify() returns trigger language plpgsql as $$
begin
 perform pg_notify('utils_workflow',new.namespace);
 return null;
end;
$$;
drop trigger if exists hosts_insert on utils_workflow.hosts;
create trigger hosts_insert after insert on utils_workflow.hosts for each row execute function utils_workflow.notify();
drop trigger if exists hosts_change on utils_workflow.hosts;
create trigger hosts_change after update of generation,draining on utils_workflow.hosts for each row
 when (old.generation is distinct from new.generation or old.draining is distinct from new.draining) execute function utils_workflow.notify();
drop trigger if exists runs_insert on utils_workflow.runs;
create trigger runs_insert after insert on utils_workflow.runs for each row execute function utils_workflow.notify();
drop trigger if exists runs_change on utils_workflow.runs;
create trigger runs_change after update of state on utils_workflow.runs for each row
 when (old.state is distinct from new.state) execute function utils_workflow.notify();
drop trigger if exists jobs_insert on utils_workflow.jobs;
create trigger jobs_insert after insert on utils_workflow.jobs for each row execute function utils_workflow.notify();
drop trigger if exists jobs_change on utils_workflow.jobs;
create trigger jobs_change after update of state,available on utils_workflow.jobs for each row
 when (old.state is distinct from new.state or old.available is distinct from new.available) execute function utils_workflow.notify();
drop trigger if exists instructions_insert on utils_workflow.instructions;
create trigger instructions_insert after insert on utils_workflow.instructions for each row
 when (new.outcome is null and new.due is not null) execute function utils_workflow.notify();
