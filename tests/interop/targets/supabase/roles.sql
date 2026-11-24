-- Give the pgbouncer role the database password, so Supavisor can look up other roles through it.
-- A reduced copy of Supabase's roles.sql, which also sets passwords for services the suite does not start.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER pgbouncer WITH PASSWORD :'pgpass';
