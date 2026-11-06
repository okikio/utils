/** One actual flow reused by native and container tests; SQL confirms authority and external cleanup. */
import { expect } from '@std/expect';
import type { Sql } from 'postgres';
import type { ReferenceType, Registry } from '@okikio/capability/resource/session';
import { ResultSchema } from './session-contract.ts';
import type { InputType, ResultType } from './session-contract.ts';

/** Poll committed evidence, not a guessed host-start or lease-expiry sleep. */
export async function until(read: () => Promise<boolean>): Promise<void> {
	const signal = AbortSignal.timeout(20000);
	while (!await read()) {
		signal.throwIfAborted();
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
/** Call the executable coordinator's public memory/durable composition and validate its portable receipt. */
export async function call(origin: string, mode: 'memory' | 'durable', input: InputType): Promise<ResultType> {
	const response = await fetch(`${origin}/${mode}`, {
		method: 'POST',
		body: JSON.stringify(input),
		signal: AbortSignal.timeout(20000),
	});
	if (!response.ok) throw new Error(`Session operation failed: ${await response.text()}`);
	return ResultSchema.parse(await response.json());
}
/** Install test-only release gates and close receipts. Production migration never owns these tables. */
export async function prepare(database: Sql): Promise<void> {
	await database`create schema if not exists utils_session_fixture`;
	await database`create table if not exists utils_session_fixture.closes (namespace text not null, session text not null, instance text not null, primary key(namespace,session))`;
	await database`create table if not exists utils_session_fixture.releases (namespace text not null, session text not null, primary key(namespace,session))`;
}

/**
 * Own one pending native borrow until its committed SQL gate opens. The gate also works after pool retirement
 * removes activity admission. Explicit release and failure cleanup join the same operation exactly once.
 * Keep the borrowed SQL pool and physical host open until this gate's disposal has joined.
 */
export function hold(options: {
	origin: string;
	reference: ReferenceType;
	database: Sql;
	namespace: string;
	host?: InputType['host'];
}) {
	const operation = call(options.origin, 'memory', { op: 'hold', reference: options.reference, host: options.host });
	// Retain early transport failure until the test joins it, rather than creating an unhandled rejection.
	const settled = operation.then(
		(value) => ({ ok: true as const, value }),
		(error: unknown) => ({ ok: false as const, error }),
	);
	/** Explicit release and scope disposal share one SQL write and one joined result. */
	let releasing: Promise<ResultType> | undefined;
	const release = (): Promise<ResultType> =>
		releasing ??= (async () => {
			// The test owns the control row. Remove it only after the pending call
			// settles, including insertion failures and deliberately failed assertions.
			await using cleanup = new AsyncDisposableStack();
			cleanup.defer(async () => {
				await settled;
				await options.database`delete from utils_session_fixture.releases
					where namespace=${options.namespace} and session=${options.reference.id}`;
			});
			await options.database`insert into utils_session_fixture.releases(namespace,session)
			values (${options.namespace},${options.reference.id}) on conflict do nothing`;
			const result = await settled;
			if (!result.ok) throw result.error;
			return result.value;
		})();
	return {
		release,
		async [Symbol.asyncDispose]() {
			await release();
		},
	};
}
/** Test state reuse, contention, cancellation cleanup, saved references, loss, explicit replacement, idle expiry and finalization. */
export async function checkSession(
	options: {
		origin: string;
		registry: Registry;
		database: Sql;
		namespace: string;
		kind: string;
		stop: () => Promise<void>;
	},
): Promise<void> {
	const { origin, registry, database, namespace, kind } = options;

	// Cross memory/durable boundaries with the same saved reference. Resource
	// identity and cleanup counters must come from the actual native host.
	const created = await call(origin, 'memory', { op: 'create' });
	expect(created.status).toBe('ok');
	const reference = created.reference!;
	expect(reference.owner.id).toBe(`${kind}:sessions`);
	const one = await call(origin, 'durable', { op: 'use', reference });
	expect(one).toMatchObject({ status: 'ok', count: 1 });
	const two = await call(origin, 'memory', { op: 'use', reference });
	expect(two).toMatchObject({ status: 'ok', count: 2, finished: 1 });
	expect(two.instance).toBe(one.instance);
	expect(two.count).toBe(2);
	expect(two.finished).toBe(1);
	if (kind === 'thread') expect(one.thread).toBeGreaterThan(0);
	else {
		expect(one.thread).toBe(0);
		const coordinator = Number(await (await fetch(`${origin}/ready`)).text());
		expect(one.pid).not.toBe(coordinator);
	}

	// Observe admission in committed authority before sending a competitor.
	// Cancellation must join its deferred cleanup before the next use succeeds.
	await using holding = hold({ origin, reference, database, namespace });
	await until(async () => (await registry.inspect(reference.id))?.claims.length === 1);
	expect((await call(origin, 'memory', { op: 'use', reference })).status).toBe('busy');
	await holding.release();
	expect((await call(origin, 'durable', { op: 'cancel', reference })).status).toBe('cancelled');
	const afterCancel = await call(origin, 'memory', { op: 'use', reference });
	expect(afterCancel.finished).toBe(4);

	await call(origin, 'durable', { op: 'close', reference });
	expect((await registry.inspect(reference.id))!.state).toBe('closed');
	const closed =
		await database`select instance from utils_session_fixture.closes where namespace=${namespace} and session=${reference.id}`;
	expect(closed[0]!.instance).toBe(one.instance);

	// Operator revocation aborts an active borrow and closes its physical value.
	const revoked = (await call(origin, 'memory', { op: 'create' })).reference!;
	await using pending = hold({ origin, reference: revoked, database, namespace });
	await until(async () => (await registry.inspect(revoked.id))?.claims.length === 1);
	await registry.close(revoked, 'lost');
	expect((await pending.release()).status).toBe('lost');
	await until(async () =>
		(await database`select * from utils_session_fixture.closes where namespace=${namespace} and session=${revoked.id}`)
			.length === 1
	);

	// Forced owner loss cannot run finalization. Keep the old reference terminal
	// and explicitly create a new lifetime instead of silently repairing its ID.
	const saved = (await call(origin, 'durable', { op: 'create' })).reference!;
	const beforeLoss = await call(origin, 'memory', { op: 'use', reference: saved });
	await expect(call(origin, 'memory', { op: 'crash' })).rejects.toBeInstanceOf(Error);
	await until(async () => (await registry.inspect(saved.id))?.state === 'lost');
	expect((await call(origin, 'durable', { op: 'use', reference: saved })).status).toBe('lost');
	const replacementResult = await call(origin, 'durable', { op: 'create' });
	expect(replacementResult.status).toBe('ok');
	const replacement = replacementResult.reference!;
	expect(replacement.id).not.toBe(saved.id);
	expect(replacement.incarnation).not.toBe(saved.incarnation);
	const afterLoss = await call(origin, 'memory', { op: 'use', reference: replacement });
	expect(afterLoss.instance).not.toBe(beforeLoss.instance);
	expect(afterLoss.count).toBe(1);
	const orphan =
		await database`select * from utils_session_fixture.closes where namespace=${namespace} and session=${saved.id}`;
	expect(orphan).toHaveLength(0); // Forced exit cannot execute application cleanup.

	// Healthy idle expiry does run cleanup; graceful host stop must do the same.
	await until(async () => (await registry.inspect(replacement.id))?.state === 'lost');
	await until(async () =>
		(await database`select * from utils_session_fixture.closes where namespace=${namespace} and session=${replacement.id}`)
			.length === 1
	);
	const final = (await call(origin, 'memory', { op: 'create' })).reference!;
	await call(origin, 'memory', { op: 'use', reference: final });
	await options.stop();
	expect((await registry.inspect(final.id))!.state).toBe('closed');
	expect(
		await database`select * from utils_session_fixture.closes where namespace=${namespace} and session=${final.id}`,
	).toHaveLength(1);
	expect(await database`select * from utils_session_fixture.releases where namespace=${namespace}`).toEqual([]);
}

/** Two physical hosts prove selection rather than accidental reuse of a one-host pool. Retirement joins held work, and selected loss never reaches a sibling. */
export async function checkHosts(
	options: { origin: string; registry: Registry; kind: string; database: Sql; namespace: string },
): Promise<void> {
	const { origin, registry, kind, database, namespace } = options;
	/** Discovery is a snapshot only; subsequent selected operations still prove admission. */
	const list = async (): Promise<import('@okikio/workflow').placement.HostType[]> => {
		const response = await fetch(`${origin}/hosts`);
		return await response.json();
	};
	/** Keep raw status for expected transport failures that return no activity receipt. */
	const post = (path: string, input: InputType) =>
		fetch(`${origin}/${path}`, {
			method: 'POST',
			body: JSON.stringify(input),
			signal: AbortSignal.timeout(20000),
		});
	const initial = await list();
	expect(initial).toHaveLength(2);
	const [a, b] = initial;
	expect(a!.pool).toBe(b!.pool);
	expect(a!.id).not.toBe(b!.id);

	// Two resources on two hosts rule out accidental reuse of a single-host pool.
	const createdA = await call(origin, 'durable', { op: 'create', host: a });
	const refA = createdA.reference!;
	const createdB = await call(origin, 'memory', { op: 'create', host: b });
	const refB = createdB.reference!;
	const usedA = await call(origin, 'memory', { op: 'use', host: a, reference: refA });
	const savedA = await call(origin, 'durable', { op: 'use', host: a, reference: refA });
	expect(savedA.host).toEqual(a);
	expect(savedA.instance).toBe(usedA.instance);
	expect(savedA.count).toBe(2);
	const usedB = await call(origin, 'durable', { op: 'use', host: b, reference: refB });
	expect(usedB.host).toEqual(b);
	expect(usedB.instance).not.toBe(usedA.instance);
	expect(kind === 'thread' ? usedB.thread !== usedA.thread : usedB.pid !== usedA.pid).toBe(true);

	// A retiring host disappears from discovery before its held work finishes.
	// New selected admission must reject while already accepted work joins.
	await using held = hold({ origin, reference: refA, database, namespace, host: a });
	await until(async () => (await registry.inspect(refA.id))!.claims.length === 1);
	const busy = await post('memory', { op: 'use', host: a, reference: refA });
	expect(busy.status).toBe(500);
	await busy.text();
	const retirement = post('retire', { op: 'close', host: a });
	await until(async () => (await list()).every((host) => host.id !== a!.id));
	const revoked = await post('memory', { op: 'create', host: a });
	expect(revoked.status).toBe(500);
	await revoked.text();
	expect((await held.release()).host).toEqual(a);
	expect((await retirement).status).toBe(200);
	expect((await registry.inspect(refA.id))!.state).toBe('closed');
	expect(
		await database`select * from utils_session_fixture.releases where namespace=${namespace} and session=${refA.id}`,
	).toEqual([]);
	// The untouched host retains its own resource; selection must never run A's work there.
	expect((await call(origin, 'memory', { op: 'use', host: b, reference: refB })).count).toBe(2);

	// Remove the remaining idle host explicitly, then creation must allocate a new lifetime.
	const retiredB = await post('retire', { op: 'close', host: b });
	expect(retiredB.status).toBe(200);
	await retiredB.text();
	const fresh = await call(origin, 'durable', { op: 'create' });
	expect(fresh.host!.id).not.toBe(a!.id);
	expect(fresh.host!.id).not.toBe(b!.id);
	const stale = await post('durable', { op: 'use', host: a, reference: refA });
	expect(stale.status).toBe(500);
	await stale.text();
	const crashed = await post('memory', { op: 'crash', host: fresh.host });
	expect(crashed.status).toBe(500);
	await crashed.text();
	await until(async () => (await registry.inspect(fresh.reference!.id))!.state === 'lost');
	const replacement = await call(origin, 'memory', { op: 'create' });
	expect(replacement.host!.id).not.toBe(fresh.host!.id);
	const lost = await post('memory', { op: 'create', host: fresh.host });
	expect(lost.status).toBe(500);
	await lost.text();
	expect((await call(origin, 'memory', { op: 'use', host: replacement.host, reference: replacement.reference })).host)
		.toEqual(replacement.host);
	const closed = await post('retire', { op: 'close', host: replacement.host });
	expect(closed.status).toBe(200);
	await closed.text();
}
