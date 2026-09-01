import type { Context } from '@okikio/context';
import * as pool from './mod.ts';

/** Borrowed consumer Context used only to exercise the pool type surface. */
declare const ctx: Context;

/** Compile-time consumer examples prove created values flow unchanged through leases. */
async function poolTypes(): Promise<void> {
	await using clients = await pool.create({
		ctx,
		maximum: 2,
		create: () => ({ kind: 'client' as const, request: (path: string) => path.length }),
		close() {},
	});
	await using lease = await clients.acquire(ctx);

	const kind: 'client' = lease.value.kind;
	const size: number = lease.value.request('/health');
	void kind;
	void size;

	// @ts-expect-error The lease retains the literal value type created by the provider.
	const wrong: 'database' = lease.value.kind;
	void wrong;
}

void poolTypes;
