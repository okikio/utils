// @benchmark optional
/** Live PostgreSQL diagnostics. UTILS_BENCH_DATABASE_URL must name an explicitly disposable database. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '#tools/bench/run.ts';
import postgres from 'postgres';
import * as state from '@okikio/storage/state/postgres';
import { SnapshotSchema } from '@okikio/context/state';
import * as workflow from '@okikio/storage/workflow/postgres';
const url = Deno.env.get('UTILS_BENCH_DATABASE_URL');
if (!url) {
	throw new TypeError('storage.bench.ts requires UTILS_BENCH_DATABASE_URL for a disposable PostgreSQL database.');
}
const database = postgres(url, { max: 12, onnotice() {} });
await using owners = new AsyncDisposableStack();
owners.defer(() => database.end({ timeout: 2 }));
await state.migrate({ database });
await workflow.migrate({ database });
const namespace = `storage-bench-${crypto.randomUUID()}`;
owners.defer(async () => {
	await database`delete from utils_state.snapshots where namespace=${namespace}`;
});
let serial = 0;
for (const bytes of [1024, 1048576]) {
	const configuration = { database, namespace, key: `value-${bytes}` };
	const store = state.open(configuration), peer = state.open(configuration);
	const text = 'x'.repeat(bytes);
	await store.save(SnapshotSchema.parse({ format: 1, contract: 'bench', version: `v${serial++}`, value: text }), {
		expectedVersion: undefined,
	});
	for (const writers of [2, 8]) {
		const compete = async function (): Promise<number> {
			const previous = (await store.load())!;
			const outcomes = await Promise.all(
				Array.from({ length: writers }, (_, index) =>
					(index % 2 ? peer : store).save(
						SnapshotSchema.parse({ format: 1, contract: 'bench', version: `v${serial++}`, value: text }),
						{ expectedVersion: previous.version },
					)),
			);
			const accepted = outcomes.filter(Boolean).length;
			if (accepted !== 1) throw new Error('CAS oracle requires exactly one winner.');
			return accepted;
		};
		await compete();
		group(`PostgreSQL state ${bytes} bytes, ${writers} contenders`, () => {
			bench('real CAS competition including reopen read', async () => do_not_optimize(await compete()));
		});
	}
}
const plan = await workflow.planMigrations({ database });
if (plan.status.state !== 'current' || plan.steps.length) throw new Error('Migration plan oracle failed.');
group('current PostgreSQL schema, borrowed pool', () => {
	bench(
		'read-only migration plan with host evidence',
		async () => do_not_optimize(await workflow.planMigrations({ database })),
	);
	bench(
		'native version query only, less evidence',
		async () => do_not_optimize(await database`select version from utils_workflow.version where id`),
	);
});
await run();
