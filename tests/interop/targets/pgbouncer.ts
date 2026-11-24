/** PgBouncer in front of PostgreSQL, in session and transaction mode. @module */
import { GenericContainer, Network, Wait } from 'testcontainers';
import { images } from './images.ts';
import { password, server } from './server.ts';
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
		images: [images.postgres18, images.pgbouncer],
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

export const targets: readonly TargetType[] = [pgbouncer('session'), pgbouncer('transaction')];
