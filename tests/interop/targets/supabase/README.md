# Supabase pooler set-up

`_supabase.sql`, `pooler.sql` and `pooler.exs` are copied unchanged from
Supabase's self-hosting stack (`docker/volumes/` in
[supabase/supabase](https://github.com/supabase/supabase) at `d6f0249`,
Apache-2.0). They create the `_supabase` database Supavisor stores tenants in
and register the one tenant the suite connects through. `roles.sql` keeps only
the line of Supabase's file that gives the `pgbouncer` role its password; the
other lines set passwords for services the suite does not start. Update them
with the image versions in `../images.ts`.
