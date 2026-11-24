/**
 * Lease work through a borrowed Postgres.js pool, or any client behind the `@okikio/sql` database port.
 * Construction starts no SQL.
 * Apply migrate() explicitly, then open matching contracts and limits on each host.
 * Database time owns leases; local clocks control only polling. Closing a view joins
 * its requests and leaves saved work and the caller's pool intact.
 * @module
 */
import type { Temporal } from '@okikio/duration/temporal';
import * as sql from '@okikio/sql';
import type { Database, Executor, Statement } from '@okikio/sql';
import * as postgres from '@okikio/sql/postgres';
import type { Pool } from '@okikio/sql/postgres';
import { EventBus } from '@okikio/observables/events';
import { observe } from '@okikio/telemetry/observe';
import * as context from '@okikio/context';
import type { Context } from '@okikio/context';
import * as codec from '@okikio/schema/codec';
import type { Contract, ContractOutput } from '@okikio/schema/codec';
import * as json from '@okikio/collection/record/json';
import * as record from '@okikio/collection/record';
import * as fault from '@okikio/result/fault';
import type { Encoded as EncodedFailure } from '@okikio/result/failure';
import {
	QueueCapacityError,
	QueueClosedError,
	QueueItemCancelledError,
	QueueItemFailedError,
	QueueItemNotFoundError,
	StaleClaimError,
} from '@okikio/scheduler/queue';
import type {
	Queue,
	QueueAddOptions,
	QueueClaim,
	QueueClaimOptions,
	QueueEventType,
	QueueInspectOptions,
	QueuePageType,
	QueuePruneOptions,
	QueuePruneResult,
	QueueRedriveOptions,
	QueueRef,
	QueueRetentionOptions,
	QueueRetryOptions,
	QueueStateType,
	QueueStats,
} from '@okikio/scheduler/queue';
import { cursor, elapsed, inspection, policy, position, pruneLimit } from '@okikio/scheduler/queue/policy';
import * as tables from './schema.ts';
import * as statements from './statements.ts';

/** One saved item, decoded with the column types. */
type Row = sql.RowOf<typeof tables.items.columns>;

/** One persistent queue's authored payloads and shared admission policy. */
export interface Options<Input extends Contract, Output extends Contract> {
	/** Receive local subscriber callback failures without failing committed work. */
	readonly onObserverError?: (error: unknown) => void | PromiseLike<void>;
	/** Borrowed Postgres.js pool or database port. The application opens and closes it. */
	readonly database: Pool | Database;
	/** Isolated queue identity. Use separate namespaces for independently governed queues. */
	readonly namespace: string;
	/** Explicit payload contract revision. Every host using this namespace must agree. */
	readonly contract: string;
	/** Application values are encoded on add and decoded when claimed. */
	readonly input: Input;
	/** Application outputs are encoded on complete and decoded by result. */
	readonly output: Output;
	/** Shared active-item maximum. Defaults to 10,000. */
	readonly capacity?: number;
	/** Bounded terminal history and deduplication window. Defaults to 10,000 rows and 24 hours. */
	readonly retention?: QueueRetentionOptions;
	/** Poll interval in whole milliseconds, from 1 through 60,000. Defaults to 100. */
	readonly pollMilliseconds?: number;
	/** Encoded UTF-8 budget for each input, output, or failure, from 1 through 16 MiB. Defaults to 1 MiB. */
	readonly maximumBytes?: number;
	/** Maximum local waiting operations. Defaults to 1,000; excess waits reject before polling. */
	readonly maximumWaiters?: number;
}

/** Hosts disagree about the contract or limits already registered for a queue. */
export class PolicyConflictError extends Error {
	readonly namespace: string;
	constructor(namespace: string) {
		super('Queue ' + JSON.stringify(namespace) + ' already has a different contract or retention/admission policy.');
		this.name = 'PolicyConflictError';
		this.namespace = namespace;
	}
}

/** Apply the queue schema atomically. Future revisions reject before any schema changes. */
export async function migrate(options: { readonly database: Pool | Database }): Promise<void> {
	await postgres.toDatabase(options.database).begin(async (tx) => {
		await sql.execute(tx, tables.migrationLock);
		for (const statement of tables.prepare) await sql.execute(tx, statement);
		const stored = (await sql.one(tx, tables.stored))?.revision;
		if (stored === undefined || !tables.supported.includes(stored)) {
			throw new Error('Unsupported persistent queue schema revision.');
		}
		for (const statement of tables.install) await sql.execute(tx, statement);
	}, { isolation: 'read committed' });
}

/**
 * Create a queue view without acquiring a connection. The first operation verifies
 * the shared namespace policy. Codecs must declare both persistence directions.
 */
export function open<const Input extends Contract, const Output extends Contract>(
	options: Options<Input, Output>,
): Queue<ContractOutput<Input>, ContractOutput<Output>> {
	codec.input(options.input);
	codec.output(options.input);
	codec.input(options.output);
	codec.output(options.output);
	return new PostgresQueue(options);
}

/** Mutable local ownership is separate from database-owned claims and terminal records. */
class PostgresQueue<Input extends Contract, Output extends Contract>
	implements Queue<ContractOutput<Input>, ContractOutput<Output>> {
	readonly #options: Options<Input, Output>;
	/** The borrowed pool behind the database port. */
	readonly #database: Database;
	/** Compare the local admission contract with the policy already saved for this namespace. */
	readonly #policy: ReturnType<typeof policy>;
	readonly #poll: number;
	readonly #maximumBytes: number;
	readonly #maximumWaiters: number;
	readonly #events = new EventBus<QueueEventType>();
	readonly #observations: Queue<ContractOutput<Input>, ContractOutput<Output>>['events'];
	/** Stop local polling and signal driver cancellation when this view closes. */
	readonly #closed = new AbortController();
	// These promises own admitted local SQL through driver settlement. Closing joins
	// them; it neither deletes saved items nor closes the borrowed connection pool.
	readonly #pending = new Set<Promise<unknown>>();
	/** Once policy initialization succeeds, ordinary operations need no additional initialization query. */
	#initialized = false;
	/** All callers of close join the same local shutdown. */
	#closing: Promise<void> | undefined;
	/** Local claim polls count against the waiter budget until they settle. */
	#waitingClaims = 0;
	/** Local result polls and claim polls share the same waiter budget. */
	#waitingResults = 0;

	/** Validate configuration while leaving the borrowed database idle. */
	constructor(options: Options<Input, Output>) {
		this.#observations = observe(this.#events, { onError: options.onObserverError });
		text(options.namespace, 'queue namespace', 128);
		text(options.contract, 'queue contract', 256);
		this.#options = Object.freeze({ ...options });
		this.#database = postgres.toDatabase(options.database);
		this.#policy = policy(options);
		this.#poll = count(options.pollMilliseconds ?? 100, 'poll milliseconds', 60_000);
		this.#maximumBytes = count(options.maximumBytes ?? 1_048_576, 'maximum bytes', 16_777_216);
		this.#maximumWaiters = count(options.maximumWaiters ?? 1000, 'maximum waiters', 100_000);
	}

	/** Local observations follow commit. They are not a persisted event feed. */
	get events(): EventBus<QueueEventType>['events'] {
		return this.#observations;
	}

	/** Encode before acquiring the admission lock; duplicate keys retain their original item. */
	add(ctx: Context, input: ContractOutput<Input>, options: QueueAddOptions = {}): Promise<QueueRef> {
		return this.#perform(ctx, async (signal) => {
			const key = options.key;
			if (key !== undefined) text(key, 'queue key', 512);
			const priority = integer(options.priority ?? 0, 'queue priority');
			const value = this.#json(await codec.write(this.#options.input, input));
			const admitted = await this.#transaction(signal, async (tx) => {
				await this.#lockPolicy(tx, signal);
				await this.#prune(tx, 1000, signal);
				if (key !== undefined) {
					const prior = await this.#one(tx, statements.keyed(this.#options.namespace, key), signal);
					if (prior) return { ref: Object.freeze({ id: prior.id }), added: false };
				}
				await this.#admit(tx, signal);
				const id = crypto.randomUUID();
				await this.#run(
					tx,
					statements.add({
						namespace: this.#options.namespace,
						id,
						key: key ?? null,
						input: value,
						priority,
						...(options.availableAt === undefined ? {} : { available: options.availableAt }),
					}),
					signal,
				);
				return { ref: Object.freeze({ id }), added: true };
			});
			if (admitted.added) this.#emit({ type: 'added', itemId: admitted.ref.id, ...(key === undefined ? {} : { key }) });
			return admitted.ref;
		});
	}

	/** Inspect admission-order metadata through an indexed finite watermark, without decoding payloads. */
	inspect(options: QueueInspectOptions): Promise<QueuePageType> {
		inspection(options);
		const identity = JSON.stringify(['postgres', this.#options.namespace, this.#options.contract]);
		const parsed = options.cursor === undefined ? undefined : position(options.cursor, identity, options.state);
		return this.#perform(undefined, async (signal) => {
			const through = parsed?.[1] ??
				(await this.#one(this.#database, statements.last(this.#options.namespace), signal))!.last;
			let after = parsed?.[0] ?? 0n;
			const rows = await this.#rows(
				this.#database,
				statements.page(this.#options.namespace, after, through, options.maximumScanned),
				signal,
			);
			const entries = [];
			let scanned = 0;
			for (const row of rows) {
				after = row.sequence;
				scanned++;
				const state: QueueStateType = row.state;
				if (options.state === undefined || state === options.state) {
					entries.push(
						Object.freeze({
							id: row.id,
							state,
							priority: row.priority,
							attempt: row.attempt,
							...(row.redriven_from === null ? {} : { redrivenFrom: row.redriven_from }),
						}),
					);
				}
				if (entries.length === options.limit) break;
			}
			// Fewer SQL rows means the remaining watermark range consists only of pruned holes.
			if (entries.length < options.limit && scanned === rows.length && rows.length < options.maximumScanned) {
				after = through;
			}
			return Object.freeze({
				entries: Object.freeze(entries),
				scanned,
				...(after < through ? { cursor: cursor(identity, options.state, String(after), String(through)) } : {}),
			});
		});
	}

	/** Serialize copy/deduplication/capacity under the namespace policy lock. The source remains terminal. */
	redrive(ctx: Context, ref: QueueRef, options: QueueRedriveOptions): Promise<QueueRef> {
		return this.#perform(ctx, async (signal) => {
			text(options.key, 'redrive key', 512);
			const admitted = await this.#transaction(signal, async (tx) => {
				await this.#lockPolicy(tx, signal);
				const source = await this.#one(tx, statements.item(this.#options.namespace, ref.id), signal);
				if (!source) throw new QueueItemNotFoundError(ref.id);
				if (source.state !== 'failed' && source.state !== 'cancelled') {
					throw new TypeError('Redrive requires a retained failed or cancelled item.');
				}
				const prior = await this.#one(tx, statements.keyed(this.#options.namespace, options.key), signal);
				if (prior) {
					if (prior.redriven_from !== ref.id) throw new TypeError('Redrive key belongs to another logical item.');
					return { ref: Object.freeze({ id: prior.id }), added: false };
				}
				await this.#admit(tx, signal);
				const id = crypto.randomUUID();
				await this.#run(tx, statements.redrive(this.#options.namespace, ref.id, id, options.key), signal);
				return { ref: Object.freeze({ id }), added: true };
			});
			if (admitted.added) this.#emit({ type: 'added', itemId: admitted.ref.id, key: options.key });
			return admitted.ref;
		});
	}

	/** Claim independent rows with SKIP LOCKED; decoding failure rolls the claim back. */
	claim(ctx: Context, options: QueueClaimOptions = {}): Promise<readonly QueueClaim<ContractOutput<Input>>[]> {
		return this.#perform(ctx, async (signal) => {
			const owner = options.owner ?? ctx.id;
			text(owner, 'claim owner', 512);
			const limit = count(options.limit ?? 1, 'claim limit', 1000);
			if (options.ref !== undefined && limit !== 1) throw new TypeError('A specific queue ref claim limit must be 1.');
			const lease = elapsed(options.duration ?? { seconds: 30 }, 'claim duration');
			if (options.wait) this.#admitWait('claims');
			try {
				while (true) {
					const claims = await this.#transaction(signal, async (tx) => {
						const rows = await this.#rows(
							tx,
							statements.claim({
								namespace: this.#options.namespace,
								...(options.ref === undefined ? {} : { ref: options.ref.id }),
								limit,
								owner,
								lease,
							}),
							signal,
						);
						// UPDATE RETURNING has no ordering guarantee, so restore the public priority/FIFO order.
						rows.sort((a, b) => b.priority - a.priority || (a.sequence < b.sequence ? -1 : 1));
						const claims: QueueClaim<ContractOutput<Input>>[] = [];
						for (const row of rows) claims.push(await this.#claimValue(row));
						return Object.freeze(claims);
					}) as readonly QueueClaim<ContractOutput<Input>>[];
					if (claims.length) {
						for (const claim of claims) {
							this.#emit({
								type: 'claimed',
								itemId: claim.itemId,
								claimId: claim.id,
								owner: claim.owner,
								attempt: claim.attempt,
							});
						}
						return claims;
					}
					if (options.ref !== undefined) {
						const row = await this.#item(options.ref, signal);
						if (terminal(row)) return Object.freeze([]);
					}
					if (!options.wait) return Object.freeze([]);
					await ctx.clock.sleep(this.#poll, signal);
				}
			} finally {
				if (options.wait) this.#waitingClaims -= 1;
			}
		});
	}

	/** Observe eligibility without reserving a scarce worker or taking a claim. */
	wait(ctx: Context, ref: QueueRef): Promise<'claimable' | 'terminal'> {
		return this.#perform(ctx, async (signal) => {
			this.#admitWait('claims');
			try {
				while (true) {
					const row = await this.#item(ref, signal);
					if (terminal(row)) return 'terminal';
					if (row.claimable === true) return 'claimable';
					await ctx.clock.sleep(this.#poll, signal);
				}
			} finally {
				this.#waitingClaims -= 1;
			}
		});
	}

	/** Encode the output once and commit it only for the still-live exact claim. */
	complete(ctx: Context, claim: QueueClaim<ContractOutput<Input>>, output: ContractOutput<Output>): Promise<void> {
		return this.#perform(ctx, async (signal) => {
			const encoded = this.#json(await codec.write(this.#options.output, output));
			await this.#finish(claim, { state: 'completed', output: encoded }, signal);
			this.#emit({ type: 'completed', itemId: claim.itemId, claimId: claim.id });
		});
	}

	/** Declared failures retain their identity and bounded JSON data. */
	fail(ctx: Context, claim: QueueClaim<ContractOutput<Input>>, failure: EncodedFailure): Promise<void> {
		return this.#perform(ctx, async (signal) => {
			text(failure.id, 'failure id', 512);
			if (typeof failure.message !== 'string') throw new TypeError('Failure message must be text.');
			const encoded = this.#json(failure);
			await this.#finish(claim, { state: 'failed', failure: encoded }, signal);
			this.#emit({ type: 'failed', itemId: claim.itemId, claimId: claim.id, failureId: failure.id });
		});
	}

	/** Retry keeps stable item identity while discarding the previous claim authority. */
	retry(ctx: Context, claim: QueueClaim<ContractOutput<Input>>, options: QueueRetryOptions = {}): Promise<void> {
		return this.#perform(ctx, async (signal) => {
			if (options.availableAt !== undefined && options.delay !== undefined) {
				throw new TypeError('Retry accepts availableAt or delay, not both.');
			}
			const delay = elapsed(options.delay ?? { milliseconds: 0 }, 'retry delay', true);
			const priority = options.priority === undefined ? undefined : integer(options.priority, 'queue priority');
			const rows = await this.#transaction(signal, async (tx) => {
				await this.#lockClaim(tx, claim, signal);
				const rows = await this.#rows(
					tx,
					statements.retry(this.#options.namespace, claim, {
						delay,
						...(options.availableAt === undefined ? {} : { available: options.availableAt }),
						...(priority === undefined ? {} : { priority }),
					}),
					signal,
				);
				this.#fenced(rows, claim);
				return rows;
			});
			this.#emit({
				type: 'retried',
				itemId: claim.itemId,
				claimId: claim.id,
				availableAt: rows[0]!.available.toString(),
			});
		});
	}

	/** Producer references can cancel work; consumer claims must still hold the live lease. */
	cancel(ctx: Context, owner: QueueRef | QueueClaim<ContractOutput<Input>>, reason?: unknown): Promise<void> {
		return this.#perform(ctx, async (signal) => {
			const message = reason === undefined ? null : fault.message(reason).slice(0, 2048);
			const claim = 'itemId' in owner ? owner : undefined;
			const id = claim?.itemId ?? owner.id;
			const changed = await this.#transaction(signal, async (tx) => {
				await this.#lockPolicy(tx, signal);
				if (claim !== undefined) await this.#lockClaim(tx, claim, signal);
				const rows = await this.#rows(tx, statements.cancel(this.#options.namespace, id, message, claim), signal);
				if (!rows.length) {
					if (claim !== undefined) throw new StaleClaimError(id, claim.id);
					const prior = await this.#one(tx, statements.exists(this.#options.namespace, id), signal);
					if (!prior) throw new QueueItemNotFoundError(id);
				}
				await this.#prune(tx, 1000, signal);
				return rows.length > 0;
			});
			if (changed) this.#emit({ type: 'cancelled', itemId: id });
		});
	}

	/** Read committed results. Retention can remove old references and deduplication keys. */
	result(ctx: Context, ref: QueueRef): Promise<ContractOutput<Output>> {
		return this.#perform(ctx, async (signal) => {
			this.#admitWait('results');
			try {
				while (true) {
					const row = await this.#item(ref, signal, 'join-read');
					if (row.state === 'completed') return await codec.read(this.#options.output, row.output);
					if (row.state === 'failed') throw new QueueItemFailedError(ref.id, readFailure(row.failure));
					if (row.state === 'cancelled') throw new QueueItemCancelledError(ref.id, row.cancellation);
					await ctx.clock.sleep(this.#poll, signal);
				}
			} finally {
				this.#waitingResults -= 1;
			}
		});
	}

	/** Renewal uses the database clock and cannot revive an expired or replaced claim. */
	renew(
		ctx: Context,
		claim: QueueClaim<ContractOutput<Input>>,
		duration: Temporal.Duration | Temporal.DurationLike | string,
	): Promise<QueueClaim<ContractOutput<Input>>> {
		return this.#perform(ctx, async (signal) => {
			const milliseconds = elapsed(duration, 'renewal duration');
			const renewed = await this.#transaction(signal, async (tx) => {
				await this.#lockClaim(tx, claim, signal);
				const rows = await this.#rows(tx, statements.renew(this.#options.namespace, claim, milliseconds), signal);
				this.#fenced(rows, claim);
				return await this.#claimValue(rows[0]!);
			});
			this.#emit({ type: 'renewed', itemId: claim.itemId, claimId: claim.id, expiresAt: renewed.expiresAt.toString() });
			return renewed;
		});
	}

	/** Shared occupancy counts treat expired claims as eligible queued work. */
	stats(): Promise<QueueStats> {
		return this.#perform(undefined, async (signal) => {
			const row = (await this.#one(this.#database, statements.stats(this.#options.namespace), signal))!;
			return Object.freeze({
				queued: row.queued,
				claimed: row.claimed,
				completed: row.completed,
				failed: row.failed,
				cancelled: row.cancelled,
				waitingClaims: this.#waitingClaims,
				waitingResults: this.#waitingResults,
			});
		});
	}

	/** Bounded retention maintenance is safe to call concurrently from several hosts. */
	prune(options?: QueuePruneOptions): Promise<QueuePruneResult> {
		return this.#perform(
			undefined,
			(signal) =>
				this.#transaction(signal, async (tx) => {
					await this.#lockPolicy(tx, signal);
					return await this.#prune(tx, pruneLimit(options?.limit), signal);
				}),
		);
	}

	/** Stop this view's local waits and join admitted SQL without closing the caller's pool. */
	close(reason?: unknown): Promise<void> {
		if (this.#closing !== undefined) return this.#closing;
		this.#closed.abort(new QueueClosedError(reason));
		this.#closing = (async () => {
			await Promise.allSettled([...this.#pending]);
			this.#emit({ type: 'closed' });
			this.#events[Symbol.dispose]();
		})();
		return this.#closing;
	}

	/** Async disposal owns only this adapter view. */
	[Symbol.asyncDispose](): Promise<void> {
		return this.close('Queue view was disposed.');
	}

	/** Join every admitted operation even when cancellation races with database completion. */
	#perform<Value>(ctx: Context | undefined, action: (signal: AbortSignal) => Promise<Value>): Promise<Value> {
		if (ctx !== undefined) {
			try {
				context.check(ctx);
			} catch (error) {
				return Promise.reject(error);
			}
		}
		if (this.#closed.signal.aborted) return Promise.reject(this.#closed.signal.reason);
		const signal = ctx === undefined ? this.#closed.signal : AbortSignal.any([ctx.signal, this.#closed.signal]);
		const pending = (async () => {
			await this.#initialize(signal);
			signal.throwIfAborted();
			return await action(signal);
		})();
		this.#pending.add(pending);
		return pending.finally(() => {
			this.#pending.delete(pending);
		});
	}

	/**
	 * Cache only completed policy validation. Racing first callers each own their cancellable
	 * queries, so one aborted caller neither strands initialization nor cancels another caller.
	 */
	async #initialize(signal: AbortSignal): Promise<void> {
		if (this.#initialized) return;
		await this.#run(
			this.#database,
			statements.addPolicy({
				namespace: this.#options.namespace,
				contract: this.#options.contract,
				capacity: this.#policy.capacity,
				retained: this.#policy.retention.limit,
				ttl: this.#policy.retention.milliseconds,
			}),
			signal,
		);
		const row = (await this.#one(this.#database, statements.policy(this.#options.namespace), signal))!;
		if (
			row.contract !== this.#options.contract || row.capacity !== this.#policy.capacity ||
			row.retained !== this.#policy.retention.limit || row.ttl !== this.#policy.retention.milliseconds
		) throw new PolicyConflictError(this.#options.namespace);
		this.#initialized = true;
	}

	/**
	 * Cancellation observed during an application decoder must reject before COMMIT.
	 * Once COMMIT starts, its driver result remains authoritative and is joined by close().
	 * READ COMMITTED gives statements after a policy-lock wait the preceding owner's
	 * committed rows, independently of the borrowed pool's application defaults.
	 */
	async #transaction<Value>(signal: AbortSignal, action: (tx: Executor) => Promise<Value>): Promise<Value> {
		signal.throwIfAborted();
		return await this.#database.begin(async (tx) => {
			signal.throwIfAborted();
			const value = await action(tx);
			signal.throwIfAborted();
			return value;
		}, { isolation: 'read committed' });
	}

	/**
	 * Serialize admission and terminal retention within one namespace. Acquire this
	 * before item locks so competing terminal transactions cannot invert lock order.
	 * Claim, retry and renewal do not change retained history and need no policy lock.
	 */
	async #lockPolicy(tx: Executor, signal: AbortSignal): Promise<void> {
		await this.#run(tx, statements.policy(this.#options.namespace, true), signal);
	}

	/**
	 * Acquire the exact row before evaluating the live lease in the following UPDATE.
	 * PostgreSQL can evaluate a volatile WHERE predicate before waiting for a row lock;
	 * a separate locked statement makes the subsequent expiry check use the time after that wait.
	 */
	async #lockClaim(tx: Executor, claim: QueueClaim<ContractOutput<Input>>, signal: AbortSignal): Promise<void> {
		this.#fenced(await this.#rows(tx, statements.lockItem(this.#options.namespace, claim.itemId), signal), claim);
	}

	/**
	 * Run a statement and decode its rows. An abort cancels the running query and rejects with the abort reason; the
	 * owning operation still joins it before it releases capacity.
	 */
	#rows<Row>(database: Executor, statement: Statement<Row>, signal: AbortSignal): Promise<Row[]> {
		return sql.rows(database, statement, { signal });
	}

	/** Run a statement and return its one row, if any. */
	#one<Row>(database: Executor, statement: Statement<Row>, signal: AbortSignal): Promise<Row | undefined> {
		return sql.one(database, statement, { signal });
	}

	/** Run a statement and ignore its rows. */
	#run(database: Executor, statement: Statement<unknown>, signal: AbortSignal): Promise<void> {
		return sql.execute(database, statement, { signal });
	}

	/** Reject an admission when the namespace already holds its capacity of active items. */
	async #admit(tx: Executor, signal: AbortSignal): Promise<void> {
		const active = (await this.#one(tx, statements.occupied(this.#options.namespace), signal))!.count;
		if (active >= this.#policy.capacity) throw new QueueCapacityError(this.#policy.capacity);
	}

	/** Convert persisted input after validating exact claim fields. */
	async #claimValue(row: Row): Promise<QueueClaim<ContractOutput<Input>>> {
		// The schema's claim check guarantees these fields together for a claimed row.
		if (row.claim === null || row.owner === null || row.claimed === null || row.expires === null) {
			throw new TypeError('Invalid saved queue claim.');
		}
		return Object.freeze({
			id: row.claim,
			itemId: row.id,
			owner: row.owner,
			value: await codec.read(this.#options.input, row.input),
			attempt: count(row.attempt, 'stored attempt'),
			claimedAt: row.claimed,
			expiresAt: row.expires,
		});
	}

	/** Find one stable identity and compute eligibility using the database clock. */
	async #item(
		ref: QueueRef,
		signal: AbortSignal,
		cancellation: 'cancel-query' | 'join-read' = 'cancel-query',
	): Promise<Row & { readonly claimable: boolean }> {
		const statement = statements.item(this.#options.namespace, ref.id);
		signal.throwIfAborted();
		// A PostgreSQL CancelRequest addresses a backend, not a statement. A late
		// cancel from a finished read can hit the next claim on the borrowed pool.
		// Finish this read before releasing the result waiter slot; sleep remains abortable.
		const row = cancellation === 'join-read'
			? await sql.one(this.#database, statement)
			: await this.#one(this.#database, statement, signal);
		signal.throwIfAborted();
		if (!row) throw new QueueItemNotFoundError(ref.id);
		return row;
	}

	/** Commit terminal data and retention in the same transaction. */
	async #finish(
		claim: QueueClaim<ContractOutput<Input>>,
		result: { state: 'completed'; output: unknown } | { state: 'failed'; failure: unknown },
		signal: AbortSignal,
	): Promise<void> {
		await this.#transaction(signal, async (tx) => {
			await this.#lockPolicy(tx, signal);
			await this.#lockClaim(tx, claim, signal);
			const rows = await this.#rows(tx, statements.finish(this.#options.namespace, claim, result), signal);
			this.#fenced(rows, claim);
			await this.#prune(tx, 1000, signal);
		});
	}

	/** Zero changed rows means the caller no longer owns the live claim. */
	#fenced(rows: readonly unknown[], claim: QueueClaim<ContractOutput<Input>>): void {
		if (rows.length === 0) throw new StaleClaimError(claim.itemId, claim.id);
	}

	/**
	 * Delete old terminal records under the namespace policy lock. The next statement
	 * sees earlier terminal commits; concurrent completions cannot each prune an
	 * incomplete snapshot. External row locks are skipped and reported through `more`.
	 */
	async #prune(tx: Executor, limit: number, signal: AbortSignal): Promise<QueuePruneResult> {
		const retention = { retained: this.#policy.retention.limit, ttl: this.#policy.retention.milliseconds };
		const rows = await this.#rows(tx, statements.prune(this.#options.namespace, retention, limit), signal);
		const remaining = (await this.#one(tx, statements.more(this.#options.namespace, retention), signal))!;
		return Object.freeze({ deleted: rows.length, more: remaining.more });
	}

	/** Observers cannot change a committed transition or turn success into an ambiguous retry. */
	#emit(event: QueueEventType): void {
		try {
			this.#events.emit(Object.freeze(event));
		} catch { /* Observation is best effort; saved state is authoritative. */ }
	}

	/** Copy inert JSON and reject oversized payloads before any state is accepted. */
	#json(value: unknown): unknown {
		const copied = json.copy(value, { maximumDepth: 64, maximumNodes: 100_000 });
		const encoded = JSON.stringify(copied);
		if (new TextEncoder().encode(encoded).byteLength > this.#maximumBytes) {
			throw new RangeError('Queue payload exceeds maximumBytes.');
		}
		return copied;
	}

	/** Bound polling pressure independently of shared active-item capacity. */
	#admitWait(kind: 'claims' | 'results'): void {
		if (this.#waitingClaims + this.#waitingResults >= this.#maximumWaiters) {
			throw new QueueCapacityError(this.#maximumWaiters);
		}
		if (kind === 'claims') this.#waitingClaims += 1;
		else this.#waitingResults += 1;
	}
}

/** Inspect the saved failure envelope without interpreting its domain-specific data. */
function readFailure(value: unknown): EncodedFailure {
	const copied = json.copy(value);
	if (
		!record.is(copied) || typeof copied.id !== 'string' ||
		typeof copied.message !== 'string' || !Object.hasOwn(copied, 'data')
	) throw new TypeError('Invalid saved queue failure.');
	return Object.freeze({ id: copied.id, message: copied.message, data: copied.data });
}
/** Whether an item has ended. */
function terminal(row: Row): boolean {
	return (tables.terminal as readonly string[]).includes(row.state);
}
/** Text identities are bounded before they enter database indexes or protocol observations. */
function text(value: string, label: string, maximum: number): void {
	if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
		throw new TypeError(label + ' must contain 1..' + maximum + ' characters.');
	}
}
/** SQL integer fields use JavaScript's safe range. */
function integer(value: number, label: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(label + ' must be a safe integer.');
	return value;
}
/** Counts have both a lower and a caller-selected upper budget. */
function count(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
	if (integer(value, label) < 1 || value > maximum) {
		throw new RangeError(label + ' is outside its supported count range.');
	}
	return value;
}
