/** Supavisor in front of Supabase's PostgreSQL, set up as Supabase's self-hosting stack does. @module */
import { readFile } from 'node:fs/promises';
import { GenericContainer, Network, Wait } from 'testcontainers';
import { images } from './images.ts';
import { password, server } from './server.ts';
import { ready, type StartedType, type TargetType } from './types.ts';

/**
 * One client at a time: clients share the pooler's pool and its process ids, so side by side a 50-statement burst
 * exhausts the pool, and `pg_cancel_backend` with a pooler's pid can stop another client's statement.
 */
export const concurrency = 1;

/** Files read at run time that imports alone do not show: Supabase's set-up files. */
export const inputs: readonly string[] = ['./supabase/'];

/** Read one of Supabase's set-up files. */
const supabaseFile = (name: string) => readFile(new URL(`./supabase/${name}`, import.meta.url), 'utf8');

/**
 * Supavisor 2.10 in front of Supabase's PostgreSQL image, set up as Supabase's self-hosting stack does. Port 5432 is
 * session mode and 6543 transaction mode; the user name carries the tenant, as `postgres.<tenant>`.
 */
function supavisor(mode: 'session' | 'transaction'): TargetType {
	return {
		name: `supavisor-${mode}`,
		about: `Supavisor 2.10 in ${mode} mode in front of Supabase's PostgreSQL 17, as Supabase hosts it.`,
		kind: 'pooler',
		images: [images.supabase, images.supavisor],
		async start(): Promise<StartedType> {
			const network = await new Network().start();
			const database = await server(images.supabase, {
				network,
				command: [
					'postgres',
					'-c',
					'config_file=/etc/postgresql/postgresql.conf',
				],
				env: {
					POSTGRES_HOST: '/var/run/postgresql',
					PGPORT: '5432',
					POSTGRES_PORT: '5432',
					PGPASSWORD: password,
					PGDATABASE: 'postgres',
					POSTGRES_DB: 'postgres',
					JWT_EXP: '3600',
				},
				files: [
					{
						content: await supabaseFile('_supabase.sql'),
						target: '/docker-entrypoint-initdb.d/migrations/97-_supabase.sql',
					},
					{
						content: await supabaseFile('pooler.sql'),
						target: '/docker-entrypoint-initdb.d/migrations/99-pooler.sql',
					},
					{
						content: await supabaseFile('roles.sql'),
						target: '/docker-entrypoint-initdb.d/init-scripts/99-roles.sql',
					},
				],
			});
			const pooler = await new GenericContainer(images.supavisor)
				.withNetwork(network)
				.withEnvironment({
					PORT: '4000',
					POSTGRES_PORT: '5432',
					POSTGRES_HOST: 'db',
					POSTGRES_DB: 'postgres',
					POSTGRES_PASSWORD: password,
					DATABASE_URL: `ecto://supabase_admin:${password}@db:5432/_supabase`,
					CLUSTER_POSTGRES: 'true',
					SECRET_KEY_BASE: 'interop-secret-key-base-that-is-only-used-by-a-disposable-test-container',
					VAULT_ENC_KEY: 'interop-vault-key-32-characters!',
					API_JWT_SECRET: 'interop-jwt-secret-at-least-32-characters',
					METRICS_JWT_SECRET: 'interop-jwt-secret-at-least-32-characters',
					REGION: 'local',
					// The image raises its open-file limit before starting, which a host may forbid; the suite needs no more.
					RLIMIT_NOFILE: '',
					ERL_AFLAGS: '-proto_dist inet_tcp',
					POOLER_TENANT_ID: 'interop',
					POOLER_DEFAULT_POOL_SIZE: '20',
					POOLER_MAX_CLIENT_CONN: '400',
					POOLER_POOL_MODE: 'transaction',
					DB_POOL_SIZE: '5',
				})
				.withCopyContentToContainer([{
					content: await supabaseFile('pooler.exs'),
					target: '/etc/pooler/pooler.exs',
				}])
				.withCommand([
					'/bin/sh',
					'-c',
					'/app/bin/migrate && /app/bin/supavisor eval "$(cat /etc/pooler/pooler.exs)" && /app/bin/server',
				])
				.withExposedPorts(4000, 5432, 6543)
				.withWaitStrategy(Wait.forHttp('/api/health', 4000))
				.withStartupTimeout(180_000)
				.start();
			const port = pooler.getMappedPort(mode === 'session' ? 5432 : 6543);
			const url = `postgres://postgres.interop:${password}@${pooler.getHost()}:${port}/postgres`;
			const version = await ready(url);
			return {
				url,
				version: `Supavisor (${mode}) → ${version}`,
				stop: async () => {
					await pooler.stop();
					await database.container.stop();
					await network.stop();
				},
			};
		},
	};
}

export const targets: readonly TargetType[] = [supavisor('session'), supavisor('transaction')];
