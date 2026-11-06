/** Own a synchronous primary/standby pair for destructive local tests. @module */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, Wait } from 'testcontainers';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { until } from './evidence.ts';

/** Keep both servers on the same image used to test acknowledged-commit replication. */
export const PostgresImage = 'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db';
const command = promisify(execFile);

/**
 * Start an owned primary and physical standby for destructive failover tests.
 * Acknowledged commits wait for the standby to apply them (`remote_apply`).
 * Tests choose when to kill the primary and promote the standby; there is no automatic election.
 *
 * The returned fixture owns its pools, containers, and network. Dispose it to save
 * the standby SQL dump and server logs, then release those resources. Register cleanup
 * as each resource starts so a setup failure also releases everything already created.
 */
export async function cluster(save: (name: string, value: unknown) => Promise<void>) {
	const cleanup = new AsyncDisposableStack();
	const pools: Sql[] = [];
	const logs: Record<string, string> = {};
	try {
		const network = await new Network().start();
		cleanup.defer(async () => {
			await network.stop();
		});
		const primary = await new PostgreSqlContainer(PostgresImage).withNetwork(network).withNetworkAliases('primary')
			.withDatabase('test').withUsername('fixture').withPassword('fixture')
			.withCommand(['postgres', '-c', 'wal_level=replica', '-c', 'max_wal_senders=5']).start();
		cleanup.defer(async () => {
			await primary.stop({ timeout: 0 });
		});
		logs.primary = '';
		(await primary.logs()).on('data', (chunk) => {
			logs.primary += String(chunk);
		});
		const allow = await primary.exec([
			'sh',
			'-c',
			'echo "host replication fixture all scram-sha-256" >> "$PGDATA/pg_hba.conf"',
		]);
		if (allow.exitCode !== 0) throw new Error(allow.output);
		const direct = postgres(primary.getConnectionUri(), { max: 2, onnotice() {} });
		pools.push(direct);
		await direct`select pg_reload_conf()`;
		// Copy the primary once, then follow its WAL stream over the private container network.
		const replica = await new GenericContainer(PostgresImage).withNetwork(network).withUser('postgres')
			.withEnvironment({ PGPASSWORD: 'fixture' }).withCommand([
				'sh',
				'-c',
				'pg_basebackup -h primary -U fixture -D /tmp/standby -R -X stream -d "application_name=test" && exec postgres -D /tmp/standby -c listen_addresses=*',
			])
			.withExposedPorts(5432).withWaitStrategy(
				Wait.forLogMessage('database system is ready to accept read-only connections'),
			).start();
		cleanup.defer(async () => {
			await replica.stop({ timeout: 0 });
		});
		logs.standby = '';
		(await replica.logs()).on('data', (chunk) => {
			logs.standby += String(chunk);
		});
		const standby = postgres({
			host: replica.getHost(),
			port: replica.getMappedPort(5432),
			database: 'test',
			username: 'fixture',
			password: 'fixture',
			max: 2,
			connect_timeout: 2,
			onnotice() {},
		});
		pools.push(standby);
		await until(
			async () => (await direct`select sync_state from pg_stat_replication where application_name='test'`).length === 1,
			'standby is streaming',
		);
		// Do not start the workload until acknowledged writes are applied on the standby.
		await direct.unsafe("alter system set synchronous_standby_names = 'test'");
		await direct.unsafe("alter system set synchronous_commit = 'remote_apply'");
		await direct`select pg_reload_conf()`;
		await until(
			async () => (await direct`select sync_state from pg_stat_replication`)[0]?.sync_state === 'sync',
			'standby applies acknowledged commits',
		);
		const url = `postgres://fixture:fixture@${primary.getHost()}:${primary.getMappedPort(5432)},${replica.getHost()}:${
			replica.getMappedPort(5432)
		}/test`;
		return {
			primary,
			replica,
			direct,
			standby,
			url,
			/**
			 * Open a fixture-owned pool that follows the server role after promotion.
			 * `primary` rejects the standby before promotion even if its read-only default is off.
			 */
			pool(max: number) {
				const pool = postgres(url, {
					max,
					connect_timeout: 2,
					target_session_attrs: 'primary',
					onnotice() {},
					connection: { statement_timeout: 5000, lock_timeout: 3000 },
				});
				pools.push(pool);
				return pool;
			},
			/** Stop only the owned primary with SIGKILL; leave the client process and standby running. */
			async kill() {
				await command('docker', ['kill', '--signal=KILL', primary.getId()]);
			},
			/** Promote the survivor, then remove the missing standby requirement so new commits can finish. */
			async promote() {
				const result = await replica.exec(['pg_ctl', '-D', '/tmp/standby', '-w', 'promote']);
				if (result.exitCode !== 0) throw new Error(result.output);
				await until(
					async () => (await standby`select pg_is_in_recovery() as recovery`)[0]?.recovery === false,
					'standby is writable',
				);
				await standby.unsafe("alter system set synchronous_standby_names = ''");
				await standby`select pg_reload_conf()`;
			},
			/** Preserve database evidence first. Nested finally blocks still release resources if saving fails. */
			async [Symbol.asyncDispose]() {
				try {
					const dump = await replica.exec(['pg_dump', '-U', 'fixture', '-d', 'test']);
					await save('database.sql', dump.output);
					if (dump.exitCode !== 0) throw new Error('Cannot preserve the test SQL dump.');
				} finally {
					try {
						await Promise.all(pools.map((pool) => pool.end({ timeout: 2 })));
						for (const [name, log] of Object.entries(logs)) await save(`${name}.log`, log);
					} finally {
						// Failed report writes or pool shutdown must not leave owned containers running.
						await cleanup.disposeAsync();
					}
				}
			},
		};
	} catch (error) {
		try {
			await Promise.all(pools.map((pool) => pool.end({ timeout: 2 })));
		} finally {
			await cleanup.disposeAsync();
		}
		throw error;
	}
}
