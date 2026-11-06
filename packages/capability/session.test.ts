/** Session safety is about observable ownership and cleanup, not only record shape. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as session from './resource/session/mod.ts';

/** Keep ordinary tests away from wall-clock expiry; expiry cases inject their own clock. */
const policy = { leaseMs: 3000, idleMs: 3000, borrowMs: 3000, maximumBorrows: 1 };
/** Reusing a deployment name is deliberate; each reference still has a fresh incarnation. */
const identity = { id: 'thread:one', generation: 1 };

/** Make a new resource identity without publishing it or acquiring a live value. */
function reference(): session.ReferenceType {
	return { id: crypto.randomUUID(), resource: 'counter', owner: identity, incarnation: crypto.randomUUID() };
}

describe('resource session authority', () => {
	it('serializes exclusive borrowing and only permits explicitly bounded sharing', async () => {
		const registry = session.registry(session.memory());
		const ref = reference();
		await registry.create(ref, policy);

		// Both requests arrive before any release. An exclusive reference must
		// reject one competitor rather than silently queue it for later admission.
		const raced = await Promise.allSettled([registry.borrow(ref), registry.borrow(ref)]);
		expect(raced.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
		const claim = raced.find((item) => item.status === 'fulfilled')!;
		if (claim.status !== 'fulfilled') throw new Error('Missing winner.');
		await registry.release(claim.value);

		// A previous borrow token cannot release the newer borrow of the same value.
		const next = await registry.borrow(ref);
		await expect(registry.release(claim.value)).rejects.toMatchObject({ code: 'owner' });
		await registry.release(next);

		const shared = reference();
		await registry.create(shared, { ...policy, maximumBorrows: 2 });
		await Promise.all([registry.borrow(shared), registry.borrow(shared)]);
		await expect(registry.borrow(shared)).rejects.toMatchObject({ code: 'busy' });
	});
	it('makes expiry terminal, persists it even on a failed late renewal, and never regrants an expired borrow', async () => {
		let now = 1000;
		const registry = session.registry(session.memory({ now: () => now }));
		const ref = reference();
		await registry.create(ref, { ...policy, borrowMs: 60 });
		const claim = await registry.borrow(ref);

		// Advance authority time, not a timer guess. Late renewal must persist loss
		// even though the renewal call itself rejects.
		now += 61;
		await expect(registry.renew(ref, [claim.id])).rejects.toMatchObject({ code: 'lost' });
		expect((await registry.inspect(ref.id))!.state).toBe('lost');
		await expect(registry.borrow(ref)).rejects.toMatchObject({ code: 'lost' });
		await registry.close(ref);
		expect((await registry.inspect(ref.id))!.state).toBe('lost');
	});
	it('does not let heartbeats extend idle lifetime and isolates reference mutation', async () => {
		let now = 0;
		const registry = session.registry(session.memory({ now: () => now }));
		const ref = reference();
		await registry.create(ref, { ...policy, idleMs: 30 });
		now = 20;
		await registry.renew(ref);
		const row = (await registry.inspect(ref.id))!;
		row.reference.owner.id = 'mutated';
		now = 31;
		expect((await registry.inspect(ref.id))!.state).toBe('lost');
		expect((await registry.inspect(ref.id))!.reference.owner.id).toBe(identity.id);
	});
	it('bounds retained memory records and requires terminal state before explicit retention removal', async () => {
		const registry = session.registry(session.memory({ maximum: 1 }));
		const ref = reference();
		await registry.create(ref, policy);
		await expect(registry.create(reference(), policy)).rejects.toMatchObject({ code: 'limit' });
		await expect(registry.remove(ref.id)).rejects.toMatchObject({ code: 'busy' });
		await registry.close(ref);
		await registry.remove(ref.id);
		await registry.create(reference(), policy);
	});
});

describe('physical session owner', () => {
	it('joins deferred cleanup before reuse, retains resource state, and closes exactly once', async () => {
		await using ctx = context.create({ id: 'session-test' });
		const registry = session.registry(session.memory());
		let closes = 0;
		let released = false;
		await using owner = session.owner({
			ctx,
			registry,
			owner: identity,
			resource: 'counter',
			maximum: 1,
			policy,
			async create() {
				return {
					value: { count: 0 },
					async [Symbol.asyncDispose]() {
						closes++;
					},
				};
			},
		});
		const ref = await owner.create();
		await expect(owner.create()).rejects.toMatchObject({ code: 'limit' });

		await owner.use(ref, (value, borrow) => {
			value.count++;
			borrow.defer(async () => {
				await new Promise((r) => setTimeout(r, 5));
				released = true;
			});
		});
		expect(await owner.use(ref, (value) => value.count)).toBe(1);
		expect(released).toBe(true);
		await owner.close(ref);
		expect(closes).toBe(1);
		expect(owner.stats()).toEqual({ sessions: 0, borrows: 0 });
		await expect(owner.use(ref, () => 0)).rejects.toMatchObject({ code: 'lost' });
	});
	it('retains exclusive ownership through cancellation until borrower cleanup has joined', async () => {
		await using ctx = context.create({ id: 'cancel-test' });
		const registry = session.registry(session.memory());
		await using owner = session.owner({
			ctx,
			registry,
			owner: identity,
			resource: 'counter',
			maximum: 1,
			policy,
			async create() {
				return { value: {}, async [Symbol.asyncDispose]() {} };
			},
		});
		const ref = await owner.create();
		const started = Promise.withResolvers<void>();
		// Hold cleanup after cancellation to prove it still occupies the borrow slot.
		const release = Promise.withResolvers<void>();
		const abort = new AbortController();
		const active = owner.use(ref, async (_value, borrow) => {
			borrow.defer(() => release.promise);
			started.resolve();
			await new Promise<void>((resolve) => borrow.signal.addEventListener('abort', () => resolve(), { once: true }));
		}, { signal: abort.signal });
		const observed = active.catch((error: unknown) => error);
		await started.promise;

		abort.abort(new Error('cancel'));
		await expect(owner.use(ref, () => 0)).rejects.toMatchObject({ code: 'busy' });

		release.resolve();
		expect(await observed).toBeInstanceOf(Error);
		expect(await owner.use(ref, () => 42)).toBe(42);
	});
	it('closes failed late acquisition and retains cleanup failure including throw undefined', async () => {
		await using ctx = context.create({ id: 'factory-test' });
		const abort = new AbortController();
		let closes = 0;
		const owner = session.owner({
			ctx,
			registry: session.registry(session.memory()),
			owner: identity,
			resource: 'counter',
			maximum: 1,
			policy,
			async create() {
				abort.abort();
				return {
					value: {},
					async [Symbol.asyncDispose]() {
						closes++;
						throw undefined;
					},
				};
			},
		});
		await expect(owner.create({ signal: abort.signal })).rejects.toBeInstanceOf(AggregateError);
		expect(closes).toBe(1);
		await expect(owner[Symbol.asyncDispose]()).rejects.toBeInstanceOf(AggregateError);
	});
	it('idle expiry closes its resource and a replacement owner rejects the saved reference', async () => {
		await using ctx = context.create({ id: 'expiry-test' });
		let now = 0;
		let closes = 0;
		const registry = session.registry(session.memory({ now: () => now }));
		const options = {
			ctx,
			registry,
			owner: identity,
			resource: 'counter',
			maximum: 1,
			policy: { ...policy, idleMs: 30 },
			async create() {
				return {
					value: {},
					async [Symbol.asyncDispose]() {
						closes++;
					},
				};
			},
		};
		await using owner = session.owner(options);
		const ref = await owner.create();
		now = 31;
		await owner.sweep();
		expect(closes).toBe(1);
		expect((await registry.inspect(ref.id))!.state).toBe('lost');
		await using replacement = session.owner(options);
		await expect(replacement.use(ref, () => 0)).rejects.toMatchObject({ code: 'lost' });
		expect((await replacement.create()).id).not.toBe(ref.id);
	});
});

it('publishes owner shutdown before abort observers reenter and joins repeated session close', async () => {
	await using ctx = context.create({ id: 'reentrant-session' });
	let closes = 0;
	let reentered: Promise<void> | undefined;
	const owner = session.owner({
		ctx,
		registry: session.registry(session.memory()),
		owner: identity,
		resource: 'counter',
		maximum: 1,
		policy: { leaseMs: 3000, idleMs: 3000, borrowMs: 3000 },
		async create(_reference, signal) {
			signal.addEventListener('abort', () => {
				reentered = owner[Symbol.asyncDispose]();
			}, { once: true });
			return {
				value: {},
				async [Symbol.asyncDispose]() {
					closes++;
				},
			};
		},
	});
	const ref = await owner.create();
	const closing = owner[Symbol.asyncDispose]();
	expect(reentered).toBe(closing);
	await closing;
	await owner.close(ref);
	expect(closes).toBe(1);
});

it('bounds pending authority admissions before they can accumulate in a database queue', async () => {
	await using ctx = context.create({ id: 'pending-session' });
	const memory = session.memory();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	// Gate authority I/O after publication; pending admission must already count
	// against the local limit while the first request is waiting on the store.
	let gated = false;
	const store: session.Store = {
		async change(id, change) {
			if (gated) {
				entered.resolve();
				await release.promise;
			}
			return await memory.change(id, change);
		},
	};
	await using owner = session.owner({
		ctx,
		registry: session.registry(store),
		owner: identity,
		resource: 'counter',
		maximum: 1,
		policy,
		async create() {
			return { value: {}, async [Symbol.asyncDispose]() {} };
		},
	});
	const ref = await owner.create();
	gated = true;
	const first = owner.use(ref, () => 1);
	await entered.promise;
	try {
		await expect(owner.use(ref, () => 2)).rejects.toMatchObject({ code: 'busy' });
		expect(owner.stats().borrows).toBe(1);
	} finally {
		gated = false;
		release.resolve();
	}
	expect(await first).toBe(1);
});

it('revokes a delayed authority creation before shutdown can finish', async () => {
	await using ctx = context.create({ id: 'opening-session' });
	const memory = session.memory();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let first = true;
	let id = '';
	let acquired = false;
	const registry = session.registry({
		async change(key, change) {
			if (first) {
				first = false;
				id = key;
				entered.resolve();
				await release.promise;
			}
			return await memory.change(key, change);
		},
	});
	await using owner = session.owner({
		ctx,
		registry,
		owner: identity,
		resource: 'counter',
		maximum: 1,
		policy,
		async create() {
			acquired = true;
			return { value: {}, async [Symbol.asyncDispose]() {} };
		},
	});
	const creating = owner.create().then(() => 'unexpected success', (error: unknown) => error);
	await entered.promise;
	const closing = owner[Symbol.asyncDispose]();
	release.resolve();
	await closing;
	expect(await creating).toBeInstanceOf(session.SessionError);
	expect(acquired).toBe(false);
	expect((await registry.inspect(id))!.state).toBe('closed');
	expect(owner.stats().sessions).toBe(0);
});

it('does not renew an opening session before its authority record has committed', async () => {
	await using ctx = context.create({ id: 'session-publication' });
	const memory = session.memory();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let first = true;
	let closes = 0;
	const registry = session.registry({
		async change(id, change) {
			if (first) {
				first = false;
				entered.resolve();
				await release.promise;
			}
			return await memory.change(id, change);
		},
	});
	await using owner = session.owner({
		ctx,
		registry,
		owner: identity,
		resource: 'counter',
		maximum: 1,
		policy,
		async create() {
			return {
				value: 42,
				async [Symbol.asyncDispose]() {
					closes++;
				},
			};
		},
	});
	const creating = owner.create();
	// Observe a possible rejection before releasing publication so the failing version has no unhandled rejection.
	void creating.catch(() => {});
	await entered.promise;
	// Sweep while the first store mutation is still gated. No missing record
	// can be treated as owner loss until that mutation has published it.
	const sweeping = owner.sweep();
	release.resolve();
	await sweeping;
	const ref = await creating;
	expect((await registry.inspect(ref.id))!.state).toBe('open');
	expect(await owner.use(ref, (value) => value)).toBe(42);
	await owner.close(ref);
	expect(closes).toBe(1);
	expect(owner.stats().sessions).toBe(0);
});

it('renews a committed session while its resource factory is still opening', async () => {
	await using ctx = context.create({ id: 'session-factory-renewal' });
	let now = 0;
	const registry = session.registry(session.memory({ now: () => now }));
	const entered = Promise.withResolvers<session.ReferenceType>();
	const release = Promise.withResolvers<void>();
	await using owner = session.owner({
		ctx,
		registry,
		owner: identity,
		resource: 'counter',
		maximum: 1,
		policy: { ...policy, leaseMs: 100, idleMs: 1000 },
		async create(ref) {
			entered.resolve(ref);
			await release.promise;
			return { value: 42, async [Symbol.asyncDispose]() {} };
		},
	});
	const creating = owner.create();
	try {
		const ref = await entered.promise;
		// This time publication succeeded. Renewal must keep the slow factory
		// alive past its initial lease rather than skipping all opening entries.
		now = 80;
		await owner.sweep();
		now = 110;
		expect((await registry.inspect(ref.id))!.state).toBe('open');
	} finally {
		release.resolve();
	}
	const ref = await creating;
	expect(await owner.use(ref, (value) => value)).toBe(42);
});
