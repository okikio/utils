// @benchmark optional
/** Real SQL ancestor reservations; explicit disposable database, no activity execution. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import process from 'node:process';
import { bench, do_not_optimize, group } from 'mitata';
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import { encode, identity } from '@okikio/workflow/execution';
import { Engine, Policy, Work } from '#fixtures/nested-contract.ts';
import { run } from '#tools/bench/run.ts';

const url = process.env.UTILS_BENCH_DATABASE_URL;
if (!url) throw new TypeError('Set UTILS_BENCH_DATABASE_URL to an explicitly disposable PostgreSQL database.');
const database = postgresjs(url, { max: 12, onnotice() {} });
await using owners = new AsyncDisposableStack();
owners.defer(() => database.end({ timeout: 2 }));
await postgres.migrate({ database });
const namespaces: string[] = [];
/** Delete only benchmark-owned rows, in foreign-key order. Included in each timed batch to bound retention. */
async function clear(namespace: string): Promise<void> {
	await database.begin(async (sql) => {
		for (
			const table of [
				'progress',
				'receipts',
				'attempts',
				'cleanups',
				'instructions',
				'events',
				'audit',
				'run_events',
				'jobs',
				'runs',
			]
		) {
			await sql`delete from ${sql(`utils_workflow.${table}`)} where namespace=${namespace}`;
		}
	});
}
owners.defer(async () => {
	for (const namespace of namespaces) {
		await clear(namespace);
		await database`delete from utils_workflow.hosts where namespace=${namespace}`;
		await database`delete from utils_workflow.compute where namespace=${namespace}`;
	}
});
for (const contenders of [1, 8]) {
	for (const depth of [2, 5]) {
		const namespace = `placement-bench-${crypto.randomUUID()}`;
		namespaces.push(namespace);
		const store = owners.use(postgres.open({ database, namespace }));
		const ancestors = Array.from({ length: depth - 1 }, (_, index) => ({
			id: `boundary:${index}`,
			generation: 1,
			...(index ? { parent: `boundary:${index - 1}` } : {}),
			capacity: 2,
		}));
		const hosts = await Promise.all(
			Array.from(
				{ length: contenders },
				(_, index) =>
					store.register(String(index), [identity(Work)], Engine.id, { activations: 1, activities: 4 }, 600000, {
						compute: { id: `host:${index}`, generation: 1, parent: ancestors.at(-1)!.id, ancestors },
					}),
			),
		);
		/** Four fixed root jobs compete under one shared two-attempt ancestor budget. */
		const cycle = async (): Promise<void> => {
			for (let index = 0; index < 4; index++) {
				await store.accept({
					definition: identity(Work),
					input: encode('sql', 1024),
					policy: Policy,
					scope: 'bench',
					key: String(index),
					location: workflow.placement.within({ id: 'boundary:0', generation: 1 }),
				});
			}
			let completed = 0;
			while (completed < 4) {
				const claims = (await Promise.all(hosts.map((host) => store.take(host, [identity(Work)]))))
					.filter((claim) => claim !== undefined);
				if (claims.length !== Math.min(contenders, 2, 4 - completed)) {
					throw new Error('SQL ancestor budget or progress oracle failed.');
				}
				await Promise.all(claims.map((claim) =>
					store.complete(claim, {
						type: 'success',
						value: encode({
							owner: 'sql',
							instance: 'not-executed',
							value: 'sql',
							pid: 0,
							thread: 0,
							count: 0,
							finished: 0,
							checksum: 0,
						}, 1024),
					}, 'permanent')
				));
				completed += claims.length;
			}
			const rows =
				await database`select count(*)::int as count from utils_workflow.jobs where namespace=${namespace} and state='completed'`;
			if (rows[0]!.count !== 4) throw new Error('SQL settlement oracle failed.');
			do_not_optimize(completed);
			await clear(namespace);
		};
		await cycle();
		group(`${contenders} SQL contenders, ${depth} levels, shared budget 2, four root jobs`, () => {
			bench('admit + competing claims + settle + bounded fixture cleanup', cycle);
		});
	}
}
await run();
