/**
 * Lease work through a borrowed Postgres.js pool. Construction starts no SQL.
 * Apply migrate() explicitly, then open matching contracts and limits on each host.
 * Database time owns leases; local clocks control only polling. Closing a view joins
 * its requests and leaves saved work and the caller's pool intact.
 * @module
 */
import { temporal } from '@okikio/duration/temporal';
import type { Parameter, Sql, TransactionSql } from 'postgres';
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
import { ddl, revision, upgrade } from './schema.ts';

/** Native SQL remains available to the application; this adapter borrows it. */
type Database = Sql | TransactionSql;
/** Rows stay untrusted until their used columns are inspected. */
type Row = Record<string, unknown>;

/** One persistent queue's authored payloads and shared admission policy. */
export interface Options<Input extends Contract, Output extends Contract> {
	/** Receive local subscriber callback failures without failing committed work. */
	readonly onObserverError?: (error: unknown) => void | PromiseLike<void>;
	/** Borrowed pool. The application opens and closes it. */
	readonly database: Sql;
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
export async function migrate(options: { readonly database: Sql }): Promise<void> {
	await options.database.begin('isolation level read committed', async (tx) => {
		await tx.unsafe('select pg_advisory_xact_lock(776161004)');
		const present = await tx.unsafe("select to_regclass('utils_queue.version') as version");
		if (present[0]!.version !== null) {
			const current = await tx.unsafe('select revision from utils_queue.version where id');
			if (current[0]?.revision === 1) {
				for (const statement of upgrade) await tx.unsafe(statement);
			} else if (current[0]?.revision !== revision) throw new Error('Unsupported persistent queue schema revision.');
			return;
		}
		for (const statement of ddl) await tx.unsafe(statement);
	});
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
	readonly #policy: ReturnType<typeof policy>;
	readonly #poll: number;
	readonly #maximumBytes: number;
	readonly #maximumWaiters: number;
	readonly #events = new EventBus<QueueEventType>();
	readonly #observations: Queue<ContractOutput<Input>, ContractOutput<Output>>['events'];
	readonly #closed = new AbortController();
	// These promises own admitted local SQL through driver settlement. Closing joins
	// them; it neither deletes saved items nor closes the borrowed connection pool.
	readonly #pending = new Set<Promise<unknown>>();
	#initialized = false;
	#closing: Promise<void> | undefined;
	#waitingClaims = 0;
	#waitingResults = 0;

	/** Validate configuration while leaving the borrowed database idle. */
	constructor(options: Options<Input, Output>) {
		this.#observations = observe(this.#events, { onError: options.onObserverError });
		text(options.namespace, 'queue namespace', 128);
		text(options.contract, 'queue contract', 256);
		this.#options = Object.freeze({ ...options });
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
			const available = options.availableAt?.toString() ?? null;
			const admitted = await this.#transaction(signal, async (tx) => {
				await this.#lockPolicy(tx, signal);
				await this.#prune(tx, 1000, signal);
				if (key !== undefined) {
					const prior = await this.#query(tx, 'select id from utils_queue.items where namespace=$1 and key=$2', [
						this.#options.namespace,
						key,
					], signal);
					if (prior[0]) return { ref: Object.freeze({ id: string(prior[0].id) }), added: false };
				}
				const active = await this.#query(
					tx,
					"select count(*)::integer as count from utils_queue.items where namespace=$1 and state in ('queued','claimed')",
					[this.#options.namespace],
					signal,
				);
				if (Number(active[0]!.count) >= this.#policy.capacity) throw new QueueCapacityError(this.#policy.capacity);
				const id = crypto.randomUUID();
				await this.#query(
					tx,
					"insert into utils_queue.items(namespace,id,key,input,priority,state,available) values($1,$2,$3,$4::jsonb,$5,'queued',coalesce($6::timestamptz,clock_timestamp()))",
					[this.#options.namespace, id, key ?? null, value, priority, available],
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
				BigInt(
					string(
						(await this.#query(
							this.#options.database,
							'select coalesce(max(sequence),0)::text as last from utils_queue.items where namespace=$1',
							[this.#options.namespace],
							signal,
						))[0]!.last,
					),
				);
			let after = parsed?.[0] ?? 0n;
			const rows = await this.#query(
				this.#options.database,
				'select id,state,priority,attempt,sequence::text,redriven_from from utils_queue.items where namespace=$1 and sequence>$2::bigint and sequence<=$3::bigint order by sequence limit $4',
				[this.#options.namespace, String(after), String(through), options.maximumScanned],
				signal,
			);
			const entries = [];
			let scanned = 0;
			for (const row of rows) {
				after = BigInt(string(row.sequence));
				scanned++;
				const state = string(row.state) as QueueStateType;
				if (options.state === undefined || state === options.state) {
					entries.push(
						Object.freeze({
							id: string(row.id),
							state,
							priority: Number(row.priority),
							attempt: Number(row.attempt),
							...(row.redriven_from === null ? {} : { redrivenFrom: string(row.redriven_from) }),
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
				const source = (await this.#query(tx, 'select id,state from utils_queue.items where namespace=$1 and id=$2', [
					this.#options.namespace,
					ref.id,
				], signal))[0];
				if (!source) throw new QueueItemNotFoundError(ref.id);
				if (source.state !== 'failed' && source.state !== 'cancelled') {
					throw new TypeError('Redrive requires a retained failed or cancelled item.');
				}
				const prior =
					(await this.#query(tx, 'select id,redriven_from from utils_queue.items where namespace=$1 and key=$2', [
						this.#options.namespace,
						options.key,
					], signal))[0];
				if (prior) {
					if (prior.redriven_from !== ref.id) throw new TypeError('Redrive key belongs to another logical item.');
					return { ref: Object.freeze({ id: string(prior.id) }), added: false };
				}
				const active = (await this.#query(
					tx,
					"select count(*)::integer as count from utils_queue.items where namespace=$1 and state in ('queued','claimed')",
					[this.#options.namespace],
					signal,
				))[0]!;
				if (Number(active.count) >= this.#policy.capacity) throw new QueueCapacityError(this.#policy.capacity);
				const id = crypto.randomUUID();
				await this.#query(
					tx,
					"insert into utils_queue.items(namespace,id,key,input,priority,state,redriven_from) select namespace,$3,$4,input,priority,'queued',id from utils_queue.items where namespace=$1 and id=$2",
					[this.#options.namespace, ref.id, id, options.key],
					signal,
				);
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
						const rows = await this.#query(
							tx,
							"with candidates as (select id from utils_queue.items where namespace=$1 and ($2::uuid is null or id=$2::uuid) and ((state='queued' and available<=clock_timestamp()) or (state='claimed' and expires<=clock_timestamp())) order by priority desc,sequence for update skip locked limit $3) update utils_queue.items i set state='claimed',claim=gen_random_uuid(),owner=$4,claimed=clock_timestamp(),expires=clock_timestamp()+$5::double precision*interval '1 millisecond',attempt=attempt+1 from candidates c where i.namespace=$1 and i.id=c.id returning i.*",
							[this.#options.namespace, options.ref?.id ?? null, limit, owner, lease],
							signal,
						);
						// UPDATE RETURNING has no ordering guarantee, so restore the public priority/FIFO order.
						rows.sort((a, b) => Number(b.priority) - Number(a.priority) || Number(a.sequence) - Number(b.sequence));
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
			await this.#finish(claim, 'completed', encoded, null, null, signal);
			this.#emit({ type: 'completed', itemId: claim.itemId, claimId: claim.id });
		});
	}

	/** Declared failures retain their identity and bounded JSON data. */
	fail(ctx: Context, claim: QueueClaim<ContractOutput<Input>>, failure: EncodedFailure): Promise<void> {
		return this.#perform(ctx, async (signal) => {
			text(failure.id, 'failure id', 512);
			if (typeof failure.message !== 'string') throw new TypeError('Failure message must be text.');
			const encoded = this.#json(failure);
			await this.#finish(claim, 'failed', null, encoded, null, signal);
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
			const priority = options.priority === undefined ? null : integer(options.priority, 'queue priority');
			const rows = await this.#transaction(signal, async (tx) => {
				await this.#lockClaim(tx, claim, signal);
				const rows = await this.#query(
					tx,
					"update utils_queue.items set state='queued',claim=null,owner=null,claimed=null,expires=null,available=coalesce($5::timestamptz,clock_timestamp()+$6::double precision*interval '1 millisecond'),priority=coalesce($7::bigint,priority) where namespace=$1 and id=$2 and claim=$3 and owner=$4 and state='claimed' and expires>clock_timestamp() returning available",
					[
						this.#options.namespace,
						claim.itemId,
						claim.id,
						claim.owner,
						options.availableAt?.toString() ?? null,
						delay,
						priority,
					],
					signal,
				);
				this.#fenced(rows, claim);
				return rows;
			});
			this.#emit({
				type: 'retried',
				itemId: claim.itemId,
				claimId: claim.id,
				availableAt: instant(rows[0]!.available).toString(),
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
				const rows = await this.#query(
					tx,
					"update utils_queue.items set state='cancelled',claim=null,owner=null,claimed=null,expires=null,finished=clock_timestamp(),cancellation=$3 where namespace=$1 and id=$2 and state in ('queued','claimed') and ($4::uuid is null or (claim=$4::uuid and owner=$5 and expires>clock_timestamp())) returning id",
					[this.#options.namespace, id, message, claim?.id ?? null, claim?.owner ?? null],
					signal,
				);
				if (!rows.length) {
					if (claim !== undefined) throw new StaleClaimError(id, claim.id);
					const prior = await this.#query(tx, 'select id from utils_queue.items where namespace=$1 and id=$2', [
						this.#options.namespace,
						id,
					], signal);
					if (!prior.length) throw new QueueItemNotFoundError(id);
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
					const row = await this.#item(ref, signal);
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
				const rows = await this.#query(
					tx,
					"update utils_queue.items set expires=clock_timestamp()+$5::double precision*interval '1 millisecond' where namespace=$1 and id=$2 and claim=$3 and owner=$4 and state='claimed' and expires>clock_timestamp() returning *",
					[this.#options.namespace, claim.itemId, claim.id, claim.owner, milliseconds],
					signal,
				);
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
			const rows = await this.#query(
				this.#options.database,
				"select count(*) filter(where state='queued' or (state='claimed' and expires<=clock_timestamp()))::integer as queued,count(*) filter(where state='claimed' and expires>clock_timestamp())::integer as claimed,count(*) filter(where state='completed')::integer as completed,count(*) filter(where state='failed')::integer as failed,count(*) filter(where state='cancelled')::integer as cancelled from utils_queue.items where namespace=$1",
				[this.#options.namespace],
				signal,
			);
			const row = rows[0]!;
			return Object.freeze({
				queued: Number(row.queued),
				claimed: Number(row.claimed),
				completed: Number(row.completed),
				failed: Number(row.failed),
				cancelled: Number(row.cancelled),
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
		const db = this.#options.database;
		await this.#query(
			db,
			'insert into utils_queue.policies(namespace,contract,capacity,retained,ttl) values($1,$2,$3,$4,$5) on conflict(namespace) do nothing',
			[
				this.#options.namespace,
				this.#options.contract,
				this.#policy.capacity,
				this.#policy.retention.limit,
				this.#policy.retention.milliseconds,
			],
			signal,
		);
		const rows = await this.#query(
			db,
			'select contract,capacity,retained,ttl from utils_queue.policies where namespace=$1',
			[this.#options.namespace],
			signal,
		);
		const row = rows[0]!;
		if (
			row.contract !== this.#options.contract || Number(row.capacity) !== this.#policy.capacity ||
			Number(row.retained) !== this.#policy.retention.limit || Number(row.ttl) !== this.#policy.retention.milliseconds
		) throw new PolicyConflictError(this.#options.namespace);
		this.#initialized = true;
	}

	/**
	 * Cancellation observed during an application decoder must reject before COMMIT.
	 * Once COMMIT starts, its driver result remains authoritative and is joined by close().
	 * READ COMMITTED gives statements after a policy-lock wait the preceding owner's
	 * committed rows, independently of the borrowed pool's application defaults.
	 */
	async #transaction<Value>(signal: AbortSignal, action: (tx: TransactionSql) => Promise<Value>): Promise<Value> {
		signal.throwIfAborted();
		return await this.#options.database.begin('isolation level read committed', async (tx) => {
			signal.throwIfAborted();
			const value = await action(tx);
			signal.throwIfAborted();
			return value;
		}) as Value;
	}

	/**
	 * Serialize admission and terminal retention within one namespace. Acquire this
	 * before item locks so competing terminal transactions cannot invert lock order.
	 * Claim, retry and renewal do not change retained history and need no policy lock.
	 */
	async #lockPolicy(tx: TransactionSql, signal: AbortSignal): Promise<void> {
		await this.#query(tx, 'select namespace from utils_queue.policies where namespace=$1 for update', [
			this.#options.namespace,
		], signal);
	}

	/**
	 * Acquire the exact row before evaluating the live lease in the following UPDATE.
	 * PostgreSQL can evaluate a volatile WHERE predicate before waiting for a row lock;
	 * a separate locked statement makes the subsequent expiry check use the time after that wait.
	 */
	async #lockClaim(tx: TransactionSql, claim: QueueClaim<ContractOutput<Input>>, signal: AbortSignal): Promise<void> {
		const rows = await this.#query(tx, 'select id from utils_queue.items where namespace=$1 and id=$2 for update', [
			this.#options.namespace,
			claim.itemId,
		], signal);
		this.#fenced(rows, claim);
	}

	/** A cancelled query is still joined before its owning operation releases capacity. */
	async #query(
		database: Database,
		statement: string,
		parameters: readonly unknown[],
		signal: AbortSignal,
	): Promise<Row[]> {
		signal.throwIfAborted();
		const pending = database.unsafe(statement, parameters as NonNullable<Parameters<Sql['unsafe']>[1]>);
		const cancel = () => {
			try {
				pending.cancel();
			} catch { /* The query may already have committed. Its promise remains authoritative. */ }
		};
		signal.addEventListener('abort', cancel, { once: true });
		if (signal.aborted) cancel();
		try {
			return await pending as Row[];
		} catch (error) {
			if (
				signal.aborted && typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '57014'
			) {
				throw signal.reason;
			}
			throw error;
		} finally {
			signal.removeEventListener('abort', cancel);
		}
	}

	/** Convert persisted input after validating exact claim fields. */
	async #claimValue(row: Row): Promise<QueueClaim<ContractOutput<Input>>> {
		return Object.freeze({
			id: string(row.claim),
			itemId: string(row.id),
			owner: string(row.owner),
			value: await codec.read(this.#options.input, row.input),
			attempt: count(Number(row.attempt), 'stored attempt'),
			claimedAt: instant(row.claimed),
			expiresAt: instant(row.expires),
		});
	}

	/** Find one stable identity and compute eligibility using the database clock. */
	async #item(ref: QueueRef, signal: AbortSignal): Promise<Row> {
		const rows = await this.#query(
			this.#options.database,
			"select *,((state='queued' and available<=clock_timestamp()) or (state='claimed' and expires<=clock_timestamp())) as claimable from utils_queue.items where namespace=$1 and id=$2",
			[this.#options.namespace, ref.id],
			signal,
		);
		if (!rows[0]) throw new QueueItemNotFoundError(ref.id);
		return rows[0];
	}

	/** Commit terminal data and retention in the same transaction. */
	async #finish(
		claim: QueueClaim<ContractOutput<Input>>,
		state: 'completed' | 'failed',
		output: Parameter | null,
		failure: Parameter | null,
		cancellation: string | null,
		signal: AbortSignal,
	): Promise<void> {
		await this.#transaction(signal, async (tx) => {
			await this.#lockPolicy(tx, signal);
			await this.#lockClaim(tx, claim, signal);
			const rows = await this.#query(
				tx,
				"update utils_queue.items set state=$5,output=$6::jsonb,failure=$7::jsonb,cancellation=$8,claim=null,owner=null,claimed=null,expires=null,finished=clock_timestamp() where namespace=$1 and id=$2 and claim=$3 and owner=$4 and state='claimed' and expires>clock_timestamp() returning id",
				[this.#options.namespace, claim.itemId, claim.id, claim.owner, state, output, failure, cancellation],
				signal,
			);
			this.#fenced(rows, claim);
			await this.#prune(tx, 1000, signal);
		});
	}

	/** Zero changed rows means the caller no longer owns the live claim. */
	#fenced(rows: readonly Row[], claim: QueueClaim<ContractOutput<Input>>): void {
		if (rows.length === 0) throw new StaleClaimError(claim.itemId, claim.id);
	}

	/**
	 * Delete old terminal records under the namespace policy lock. The next statement
	 * sees earlier terminal commits; concurrent completions cannot each prune an
	 * incomplete snapshot. External row locks are skipped and reported through `more`.
	 */
	async #prune(database: TransactionSql, limit: number, signal: AbortSignal): Promise<QueuePruneResult> {
		const parameters = [
			this.#options.namespace,
			this.#policy.retention.limit,
			this.#policy.retention.milliseconds,
			limit,
		];
		const rows = await this.#query(
			database,
			"with ranked as (select id,finished,row_number() over(order by finished desc,sequence desc) as position from utils_queue.items where namespace=$1 and finished is not null), selected as (select i.id from utils_queue.items i join ranked r on i.id=r.id where i.namespace=$1 and (r.position>$2 or r.finished<=clock_timestamp()-$3::double precision*interval '1 millisecond') order by i.finished,i.sequence for update of i skip locked limit $4) delete from utils_queue.items i using selected s where i.namespace=$1 and i.id=s.id returning i.id",
			parameters,
			signal,
		);
		const remaining = await this.#query(
			database,
			"select (count(*)>$2 or coalesce(min(finished)<=clock_timestamp()-$3::double precision*interval '1 millisecond',false)) as more from utils_queue.items where namespace=$1 and finished is not null",
			parameters.slice(0, 3),
			signal,
		);
		return Object.freeze({ deleted: rows.length, more: remaining[0]!.more === true });
	}

	/** Observers cannot change a committed transition or turn success into an ambiguous retry. */
	#emit(event: QueueEventType): void {
		try {
			this.#events.emit(Object.freeze(event));
		} catch { /* Observation is best effort; saved state is authoritative. */ }
	}

	/** Copy inert JSON and reject oversized payloads before any state is accepted. */
	#json(value: unknown): Parameter {
		const copied = json.copy(value, { maximumDepth: 64, maximumNodes: 100_000 });
		const encoded = JSON.stringify(copied);
		if (new TextEncoder().encode(encoded).byteLength > this.#maximumBytes) {
			throw new RangeError('Queue payload exceeds maximumBytes.');
		}
		// The inert copy satisfies the driver's JSON model; readonly only restricts callers.
		return this.#options.database.json(copied as Parameters<Sql['json']>[0]);
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

/** Validate native database timestamp values rather than accepting local-time strings. */
function instant(value: unknown): Temporal.Instant {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
		throw new TypeError('Invalid saved queue timestamp.');
	}
	return temporal.Instant.fromEpochMilliseconds(value.getTime());
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
/** Queue states are constrained by the schema and inspected at the read point. */
function terminal(row: Row): boolean {
	return row.state === 'completed' || row.state === 'failed' || row.state === 'cancelled';
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
/** Stored identifier columns cannot be silently coerced into authority. */
function string(value: unknown): string {
	if (typeof value !== 'string' || !value) throw new TypeError('Invalid saved queue identity.');
	return value;
}
