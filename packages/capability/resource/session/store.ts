/** Atomic session authority shared by local and persistent adapters. @module */
import { ClaimSchema, PolicySchema, RecordSchema, ReferenceSchema } from './schema.ts';
import type { ClaimType, PolicyInputType, RecordType, ReferenceType } from './schema.ts';

/** Synchronous transition under one authority lock. Undefined removes the row. Never perform I/O inside it. */
export type Change = (previous: RecordType | undefined, now: number) => RecordType | undefined;
/** Borrowed atomic authority. Adapters supply their own clock and must isolate input/output containers. */
export interface Store {
	/** Serialize one ID, evaluate change using authority time, commit, then return the committed record. */
	change(id: string, change: Change): Promise<RecordType | undefined>;
}
/** Stable session failure. A lost or closed reference cannot be renewed or silently reconstructed. */
export class SessionError extends Error {
	/** Busy is immediate admission failure; callers choose bounded retry policy. Other codes require recovery or correction. */
	readonly code: 'lost' | 'closed' | 'busy' | 'owner' | 'limit';
	/** Keep stable recovery classification without exposing resource values or private driver errors. */
	constructor(code: SessionError['code'], options?: ErrorOptions) {
		super(`Resource session ${code}.`, options);
		this.name = 'SessionError';
		this.code = code;
	}
}
/** Compare every identity field; matching only a stable executor name permits stale owner reuse. @internal */
export function same(a: ReferenceType, b: ReferenceType): boolean {
	return a.id === b.id && a.resource === b.resource && a.incarnation === b.incarnation &&
		a.owner.id === b.owner.id && a.owner.generation === b.owner.generation;
}
/** Expiry is terminal, including a borrow that may still be running. Never regrant it to a competing borrower. @internal */
function expire(row: RecordType, now: number): RecordType {
	if (
		row.state === 'open' && (now >= row.expires || row.claims.some((claim) => now >= claim.expires) ||
			(row.claims.length === 0 && now >= row.idleExpires))
	) {
		return { ...row, state: 'lost', claims: [], updated: now };
	}
	return row;
}
/**
 * Session authority without live resource ownership. Use the same persistent store from every cooperating process.
 * This trusted deployment API supplies no user authorization; namespaces and executor IDs are not credentials.
 */
export class Registry {
	/** The registry borrows this authority and never closes an injected database or store. */
	readonly #store: Store;
	constructor(store: Store) {
		this.#store = store;
	}
	/** Publish a new, never-reused identity. The physical owner still has to acquire the resource before sharing the reference. */
	async create(reference: ReferenceType, policy: PolicyInputType): Promise<void> {
		const ref = ReferenceSchema.parse(reference), selected = PolicySchema.parse(policy);
		await this.#store.change(ref.id, (previous, now) => {
			if (previous) throw new SessionError('owner');
			return {
				reference: ref,
				policy: selected,
				state: 'open',
				expires: now + selected.leaseMs,
				idleExpires: now + selected.idleMs,
				updated: now,
				claims: [],
			};
		});
	}
	/** Read committed state and atomically mark elapsed leases lost. Missing/removed IDs are undefined. */
	async inspect(id: string): Promise<RecordType | undefined> {
		return await this.#store.change(id, (previous, now) => previous && expire(previous, now));
	}
	/** Acquire an exclusive or explicitly bounded shared borrow. No hidden waiting queue is created. */
	async borrow(reference: ReferenceType): Promise<ClaimType> {
		const id = crypto.randomUUID();
		await this.#change(reference, (row, now) => {
			if (row.claims.length >= row.policy.maximumBorrows) throw new SessionError('busy');
			return { ...row, updated: now, claims: [...row.claims, { id, expires: now + row.policy.borrowMs }] };
		});
		return ClaimSchema.parse({ reference, id });
	}
	/** Renew owner liveness and only its currently running borrows. Idle expiry is deliberately unchanged. */
	async renew(reference: ReferenceType, claims: readonly string[] = []): Promise<void> {
		await this.#change(
			reference,
			(row, now) => ({
				...row,
				updated: now,
				expires: now + row.policy.leaseMs,
				claims: row.claims.map((claim) =>
					claims.includes(claim.id) ? { ...claim, expires: now + row.policy.borrowMs } : claim
				),
			}),
		);
	}
	/** Release after borrower cleanup joins. An elapsed claim loses the session even if no rival has asked for it. */
	async release(claim: ClaimType): Promise<void> {
		const selected = ClaimSchema.parse(claim);
		await this.#change(selected.reference, (row, now) => {
			if (!row.claims.some((entry) => entry.id === selected.id)) throw new SessionError('owner');
			return {
				...row,
				updated: now,
				idleExpires: now + row.policy.idleMs,
				claims: row.claims.filter((entry) => entry.id !== selected.id),
			};
		});
	}
	/** Revoke future use before physical cleanup. Lost never becomes closed, and neither terminal state can reopen. */
	async close(reference: ReferenceType, state: 'closed' | 'lost' = 'closed'): Promise<void> {
		const ref = ReferenceSchema.parse(reference);
		await this.#store.change(ref.id, (previous, now) => {
			if (!previous) return undefined;
			if (!same(previous.reference, ref)) throw new SessionError('owner');
			const row = expire(previous, now);
			return row.state === 'open' ? { ...row, state, updated: now, claims: [] } : row;
		});
	}
	/** Explicit retention removal. Applications must not recycle deleted IDs; normal creation uses fresh UUIDs. */
	async remove(id: string): Promise<void> {
		await this.#store.change(id, (previous, now) => {
			if (previous && expire(previous, now).state === 'open') throw new SessionError('busy');
			return undefined;
		});
	}
	/** Commit observed expiry before reporting failure, so a failed late caller cannot roll back the loss transition. */
	async #change(reference: ReferenceType, change: (row: RecordType, now: number) => RecordType): Promise<void> {
		const ref = ReferenceSchema.parse(reference);
		let failure: SessionError | undefined;
		await this.#store.change(ref.id, (previous, now) => {
			if (!previous) {
				failure = new SessionError('lost');
				return undefined;
			}
			if (!same(previous.reference, ref)) throw new SessionError('owner');
			const row = expire(previous, now);
			if (row.state !== 'open') {
				failure = new SessionError(row.state);
				return row;
			}
			return change(row, now);
		});
		if (failure) throw failure;
	}
}
/** Construct one authority facade; the caller retains store lifetime. */
export function registry(store: Store): Registry {
	return new Registry(store);
}
/** Bounded local authority for memory execution. Its clock is replaceable for deterministic lease tests. */
export function memory(options: { readonly maximum?: number; readonly now?: () => number } = {}): Store {
	const maximum = options.maximum ?? 4096, now = options.now ?? Date.now;
	if (!Number.isSafeInteger(maximum) || maximum < 1) throw new RangeError('Session record maximum must be positive.');
	const rows = new Map<string, RecordType>();
	return {
		async change(id, change) {
			const previous = rows.get(id);
			const next = change(previous && structuredClone(previous), now());
			if (!previous && next && rows.size >= maximum) throw new SessionError('limit');
			if (next) {
				if (next.reference.id !== id) throw new TypeError('Session record ID differs from its storage key.');
				rows.set(id, RecordSchema.parse(next));
			} else rows.delete(id);
			return next && structuredClone(next);
		},
	};
}
