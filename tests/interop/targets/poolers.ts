/** Connection poolers in front of PostgreSQL: PgBouncer, and Supavisor as Supabase runs it. @module */
import { readFile } from 'node:fs/promises';
import { GenericContainer, Network, Wait } from 'testcontainers';
import { images } from './images.ts';
import { password, server } from './postgres.ts';
import { ready, type StartedType, type TargetType } from './types.ts';

/**
 * PgBouncer 1.26 in front of PostgreSQL 18. Transaction mode tracks up to 200 protocol-level prepared statements, as
 * PgBouncer 1.21 and later can; session mode keeps one server connection per client.
 */
function pgbouncer(mode: 'session' | 'transaction'): TargetType {
	return {
		name: `pgbouncer-${mode}`,
		about: `PgBouncer 1.26 in ${mode} mode in front of PostgreSQL 18` +
			(mode === 'transaction' ? ', tracking 200 prepared statements.' : '.'),
		kind: 'pooler',
		async start(): Promise<StartedType> {
			const network = await new Network().start();
			const database = await server(images.postgres18, { network });
			const bouncer = await new GenericContainer(images.pgbouncer)
				.withNetwork(network)
				.withEnvironment({
					DATABASE_URL: `postgres://postgres:${password}@db:5432/postgres`,
					POOL_MODE: mode,
					AUTH_TYPE: 'scram-sha-256',
					MAX_PREPARED_STATEMENTS: '200',
					DEFAULT_POOL_SIZE: '10',
					MAX_CLIENT_CONN: '400',
					// Clients send these startup settings, and PgBouncer refuses a connection that sends one it does not
					// track: pg-promise and others send `extra_float_digits`; Slonik sends `statement_timeout` and
					// `idle_in_transaction_session_timeout`.
					IGNORE_STARTUP_PARAMETERS: 'extra_float_digits,options,statement_timeout,idle_in_transaction_session_timeout',
				})
				.withExposedPorts(5432)
				.withWaitStrategy(Wait.forListeningPorts())
				.start();
			const url = `postgres://postgres:${password}@${bouncer.getHost()}:${bouncer.getMappedPort(5432)}/postgres`;
			const version = await ready(url);
			return {
				url,
				version: `PgBouncer (${mode}) → ${version}`,
				stop: async () => {
					await bouncer.stop();
					await database.container.stop();
					await network.stop();
				},
			};
		},
	};
}

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

export const poolers: readonly TargetType[] = [
	pgbouncer('session'),
	pgbouncer('transaction'),
	supavisor('session'),
	supavisor('transaction'),
];
