// @benchmark optional
/**
 * Measure one SQL borrow competition, release of all winners and owner renewal.
 * Compare one/eight contenders with one/four permitted borrows on the same pool.
 * Migration, record creation and terminal cleanup are outside the timed callback.
 * Native resource execution, host startup and network topology are not measured.
 * @module
 */
import process from 'node:process';
import { bench, do_not_optimize, group } from 'mitata';
import postgresjs from 'postgres';
import * as session from '@okikio/capability/resource/session';
import * as postgres from '@okikio/storage/session/postgres';
import { run } from '#tools/bench/run.ts';

const url = process.env.UTILS_BENCH_DATABASE_URL;
if (!url) throw new Error('Set UTILS_BENCH_DATABASE_URL to an explicitly disposable PostgreSQL database.');
const database = postgresjs(url, { max: 12, onnotice() {} });

try {
	await postgres.migrate({ database });
	const references: session.ReferenceType[] = [];
	const registry = session.registry(postgres.open({ database, namespace: `session-bench-${crypto.randomUUID()}` }));
	try {
		for (const maximumBorrows of [1, 4]) {
			const reference = {
				id: crypto.randomUUID(),
				resource: 'bench',
				owner: { id: 'bench', generation: 1 },
				incarnation: crypto.randomUUID(),
			};
			references.push(reference);
			await registry.create(reference, { leaseMs: 600000, idleMs: 600000, borrowMs: 60000, maximumBorrows });

			for (const contenders of [1, 8]) {
				/** Every successful claim releases; losers must be explicit busy outcomes, never dropped or queued. */
				const cycle = async () => {
					const outcomes = await Promise.allSettled(
						Array.from({ length: contenders }, () => registry.borrow(reference)),
					);
					const claims = outcomes.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);

					// Do not release early winners while competitors are still arriving:
					// otherwise one slot could serve several contenders in this round.
					if (
						claims.length !== Math.min(contenders, maximumBorrows) ||
						outcomes.some((result) =>
							result.status === 'rejected' &&
							(!(result.reason instanceof session.SessionError) || result.reason.code !== 'busy')
						)
					) {
						throw new Error('SQL session contention oracle failed.');
					}
					const released = await Promise.allSettled(claims.map((claim) => registry.release(claim)));
					const failed = released.filter((result) => result.status === 'rejected');
					if (failed.length) throw new AggregateError(failed.map((result) => result.reason), 'Claim release failed.');
					await registry.renew(reference);
					do_not_optimize(claims.length);
				};
				await cycle();
				// Validate the fixture outside timing, including in --check mode.
				// A round must leave no claim behind for the next benchmark sample.
				const record = await registry.inspect(reference.id);
				if (record?.state !== 'open' || record.claims.length !== 0) {
					throw new Error('SQL session round retained a claim or lost its owner.');
				}
				group(`${contenders} SQL contenders, session borrow limit ${maximumBorrows}`, () => {
					bench('claim competition + release winners + renew owner', cycle);
				});
			}
			// Records stay available through measurement and are removed afterward.
		}
		await run();
	} finally {
		for (const reference of references) {
			await registry.close(reference);
			await registry.remove(reference.id);
		}
	}
} finally {
	await database.end({ timeout: 2 });
}
