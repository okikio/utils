/** Executable physical host assembly. The activity server borrows the session collection; finalize owns its close. */
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import postgresjs from 'postgres';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as session from '@okikio/capability/resource/session';
import * as postgres from '@okikio/storage/session/postgres';
import { Sessions, Timing } from './session-contract.ts';

/** Acquire explicitly in a thread/process entry; imports alone issue no SQL and launch no timers. */
export async function open() {
	// Bound the test gate's SQL too; cancellation checks resume after each completed query.
	const database = postgresjs(process.env.DATABASE_URL!, {
		max: 4,
		connect_timeout: 2,
		connection: { statement_timeout: 5000 },
		onnotice() {},
	});
	const ctx = context.create({ id: 'session-host' });
	const store = postgres.open({ database, namespace: process.env.SESSION_NAMESPACE! });
	let first = true;
	const registry = session.registry({
		async change(id, change) {
			if (first && process.env.SESSION_DELAY_PUBLICATION === '1') {
				first = false;
				// Delay the first authority write on each fresh host, including crash replacements.
				// A different pool connection remains free for a renewal to overtake publication.
				await database`select pg_sleep(${Timing.publicationSeconds})`;
			}
			return await store.change(id, change);
		},
	});
	const resources = resource.create(
		resource.implementations(resource.implement(Sessions, {
			create: () =>
				session.owner({
					ctx,
					registry,
					resource: 'counter',
					maximum: 4,
					owner: { id: process.env.SESSION_TARGET!, generation: 1 },
					policy: {
						leaseMs: Timing.leaseMs,
						borrowMs: Timing.borrowMs,
						idleMs: process.env.POOL_SELECTION === '1' ? 15000 : Timing.idleMs,
						maximumBorrows: 1,
					},
					async create(reference) {
						const value = {
							instance: crypto.randomUUID(),
							count: 0,
							finished: 0,
							/** Release test work without needing a free activity slot on a retiring host. */
							async wait(signal: AbortSignal): Promise<void> {
								while (true) {
									signal.throwIfAborted();
									const rows = await database`select 1 from utils_session_fixture.releases
										where namespace=${process.env.SESSION_NAMESPACE!} and session=${reference.id}`;
									if (rows.length) return;
									await delay(10, undefined, { signal });
								}
							},
						};
						return {
							value,
							async [Symbol.asyncDispose]() {
								// A real external receipt detects shutdown acknowledgement racing resource close.
								await new Promise((resolve) => setTimeout(resolve, 20));
								await database`insert into utils_session_fixture.closes values (${process.env
									.SESSION_NAMESPACE!},${reference.id},${value.instance})`;
							},
						};
					},
				}),
		})),
		{ ctx, host: {} },
	);
	let closing: Promise<void> | undefined;
	const close = () =>
		closing ??= (async () => {
			try {
				await resources[Symbol.asyncDispose]();
			} finally {
				try {
					await ctx[Symbol.asyncDispose]();
				} finally {
					await database.end({ timeout: 2 });
				}
			}
		})();
	return { resources, close };
}
