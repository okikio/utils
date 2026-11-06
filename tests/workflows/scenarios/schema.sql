create table sources (
  scope uuid not null, id uuid not null, revision integer not null,
  digest text not null, body text not null,
  parsed boolean not null default false, verified boolean not null default false,
  rejected boolean not null default false,
  primary key (scope, id), check (octet_length(body) <= 2097152)
);
create table source_rows (
  scope uuid not null, source uuid not null, position integer not null,
  original text[] not null, correction text,
  primary key (scope, source, position),
  foreign key (scope, source) references sources(scope, id)
);
create table accounts (
  scope uuid not null, source uuid not null, position integer not null,
  revision integer not null, value text not null,
  primary key (scope, source, position)
);
create table exits (
  run uuid primary key, scope uuid not null, definition text not null, outcome jsonb not null
);
create table research (
  scope uuid not null, id uuid not null, grant_id uuid not null,
  expires_at timestamptz not null, latest_at timestamptz not null default clock_timestamp(),
  closed boolean not null default false,
  primary key (scope, id)
);
create table captures (
  scope uuid not null, research uuid not null, effect text not null,
  version uuid not null, digest text not null, body text,
  primary key (scope, research, effect), unique (scope, research, version),
  foreign key (scope, research) references research(scope, id)
);
create table contributions (
  scope uuid not null, research uuid not null, digest text not null,
  stage uuid not null, commit uuid,
  primary key (scope, research, digest),
  foreign key (scope, research) references research(scope, id)
);