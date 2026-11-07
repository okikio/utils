/**
 * Save jobs and progress through a borrowed Postgres.js pool. The application creates and closes the
 * pool. @module
 */
import type { EffectEncoded } from '@okikio/capability/effect';
import * as telemetry from '@okikio/telemetry/instrument';
import postgresjs from 'postgres';
import type { Options, Sql, TransactionSql } from 'postgres';
import * as codec from '@okikio/schema/codec';
import type { Contract } from '@okikio/schema/codec';
import * as schema from '@okikio/schema';
import * as record from '@okikio/collection/record';
import { ExecutionError, placement } from '@okikio/workflow';
import type { ComputeType, EngineAffinityType } from '@okikio/workflow';
import {
	address,
	ControlOptionsSchema,
	ControlSchema,
	decode,
	encode,
	fingerprint,
	identity,
	OutcomeSchema,
	PolicySchema,
	ReferenceSchema,
	StateSchema,
} from '@okikio/workflow/execution';
import type {
	ActivationType,
	AdmissionType,
	AttemptType,
	Claim,
	ContinuationType,
	ControlOptions,
	ControlType,
	ExecutionStore,
	HostType,
	IdentityType,
	IntentType,
	JobType,
	OutcomeType,
	PolicyType,
	ReferenceType,
	SnapshotType,
} from '@okikio/workflow';
import { migration, version } from './schema.ts';
import * as continuation from './continuation.ts';

/** Native Postgres.js transaction. It remains usable by domain SQL, not just the adapter. */
export type Transaction = TransactionSql;
/**
 * Identify one business write and describe how to read its result.
 * Reuse the same key, input, and contract on retry so a committed receipt can be recognized.
 */
export interface WriteOptions<Input, Value> {
	/** Stable key within this activity job. Reusing it with changed input or contract causes a conflict. */
	readonly key: string;
	/** Plain data used to fingerprint the write. Retries must supply the same data; do not pass live resources. */
	readonly input: Input;
	/**
	 * Schema or codec that encodes and validates the saved result. Keep the result within the policy byte
	 * limit.
	 */
	readonly result: Contract<unknown, Value>;
	/**
	 * Stable version for the meaning of this write. Defaults to `key`.
	 * Changing the result schema alone does not change the saved contract identity.
	 */
	readonly contract?: string;
}
/**
 * A saved write result. A newly returned receipt remains provisional until its enclosing transaction
 * commits.
 */
export interface ReceiptType<Value> {
	/** Validated committed value, or a provisional value until the enclosing transaction commits. */
	readonly value: Value;
}
/**
 * Read or save a result inside `store.transaction`.
 * Call `get()` before changing business data. If it returns a receipt, return that
 * receipt from the callback. Otherwise do the write and return `save(value)`.
 *
 * These methods accept calls only while the callback is running. Calls execute
 * in order and finish before commit or rollback. A failed call aborts the transaction
 * even if the callback catches its error or does not await its promise.
 */
export interface Receipt<Value> {
	/**
	 * Read this write's saved result in the current transaction. A miss means the application must do the
	 * write.
	 */
	get(): Promise<ReceiptType<Value> | undefined>;
	/** Validate and save a provisional receipt in this same native transaction, never in another connection. */
	save(value: Value): Promise<ReceiptType<Value>>;
}
/** One bounded maintenance pass. The budget counts every deleted runtime row, not only runs. */
export interface PruneResult {
	readonly deleted: number;
	readonly runs: number;
	readonly families: number;
	/** Another eligible family or a partly pruned family remains; concurrent maintenance can change this hint. */
	readonly more: boolean;
}
/** Borrowed store with native transactional domain writes. No pool is opened or migrated by construction. */
export interface StoreType extends ExecutionStore {
	/** Explicitly delete expired, wholly terminal families using a total row budget of 1..1000. */
	prune(options: { readonly limit: number }): Promise<PruneResult>;
	/**
	 * Check the claim, then commit business SQL and its receipt together.
	 * The callback must return a receipt from its own `get()` or `save()` call.
	 * Wait for this method to succeed before treating a newly saved value as committed.
	 */
	transaction<Input, Value>(
		claim: Claim | undefined,
		options: WriteOptions<Input, Value>,
		callback: (tx: Transaction, receipt: Receipt<Value>) => Promise<ReceiptType<Value>>,
	): Promise<ReceiptType<Value>>;
	/**
	 * Read an existing write receipt while this attempt has permission, before reopening source bytes or
	 * calling a receiver.
	 */
	getReceipt<Input, Value>(
		claim: Claim | undefined,
		options: WriteOptions<Input, Value>,
	): Promise<ReceiptType<Value> | undefined>;
}
/** Tracks only native transactions admitted through begin; query-shaped foreign objects cannot join. */
const transactions = new WeakMap<object, { database: Sql; active: boolean }>();

/**
 * Open a Postgres.js transaction that `client.in(tx)` can join.
 * Register its pool and callback lifetime so job acceptance can share the business commit.
 * A transaction from another pool, or one used after this callback exits, is rejected.
 */
export async function begin<Value>(database: Sql, callback: (tx: Transaction) => Promise<Value>): Promise<Value> {
	return await database.begin(async (tx) => {
		const lifetime = { database, active: true };
		transactions.set(tx, lifetime);
		try {
			return await callback(tx);
		} finally {
			lifetime.active = false;
		}
	}) as Value;
}

/** Read-only migration evidence. It can become stale before migrate() obtains its lock. */
export interface MigrationStatusType {
	/** Saved revision, or undefined before installation. */
	readonly current: number | undefined;
	/** Exact revision supported by this library. */
	readonly target: number;
	/** Compatibility of the saved revision; incompatible revisions never become an implicit downgrade. */
	readonly state: 'uninstalled' | 'current' | 'upgrade' | 'incompatible';
	/** Whether an unexpired, non-draining host currently prevents an upgrade. */
	readonly activeWorkers: boolean;
}
/**
 * Read version and draining evidence in one read-only repeatable-read transaction. This takes no migration
 * advisory lock and applies no DDL. Concurrent schema changes can invalidate this observation; migrate()
 * always repeats its checks after obtaining the authoritative migration lock.
 */
export async function migrationStatus(options: { readonly database: Sql }): Promise<MigrationStatusType> {
	return await options.database.begin('isolation level repeatable read read only', async (tx) => {
		const present =
			await tx`select to_regclass('utils_workflow.version') as version, to_regclass('utils_workflow.hosts') as hosts`;
		let current: number | undefined;
		if (present[0]!.version !== null) {
			const rows = await tx`select version from utils_workflow.version where id`;
			current = rows[0]?.version;
			if (!Number.isSafeInteger(current) || current === undefined || current < 1) {
				return Object.freeze({ current, target: version, state: 'incompatible' as const, activeWorkers: false });
			}
		}
		const active = present[0]!.hosts === null
			? []
			: await tx`select id from utils_workflow.hosts where not draining and expires>clock_timestamp() limit 1`;
		return Object.freeze({
			current,
			target: version,
			state: current === undefined
				? 'uninstalled' as const
				: current === version
				? 'current' as const
				: current < version
				? 'upgrade' as const
				: 'incompatible' as const,
			activeWorkers: active.length > 0,
		});
	});
}
/** An explicit forward-only maintenance plan; applying it remains a separate migrate() call. */
export interface MigrationPlanType {
	/** Snapshot evidence used to explain the plan. */
	readonly status: MigrationStatusType;
	/** Whether maintenance may currently proceed; current schemas need no draining or DDL. */
	readonly ready: boolean;
	/** Bounded authored transitions, not arbitrary caller-supplied SQL. */
	readonly steps: readonly Readonly<{ from: number | undefined; to: number; action: 'install' | 'upgrade' }>[];
}
/** Inspect installation/upgrade requirements without changing schema or draining hosts. */
export async function planMigrations(options: { readonly database: Sql }): Promise<MigrationPlanType> {
	const status = await migrationStatus(options);
	const steps = status.state === 'uninstalled' || status.state === 'upgrade'
		? [
			Object.freeze({
				from: status.current,
				to: status.target,
				action: status.state === 'uninstalled' ? 'install' as const : 'upgrade' as const,
			}),
		]
		: [];
	return Object.freeze({
		status,
		ready: status.state === 'current' || (status.state !== 'incompatible' && !status.activeWorkers),
		steps: Object.freeze(steps),
	});
}

/** Explicit maintenance. Current revisions run no DDL; an upgrade requires drained workers. */
export async function migrate(options: { readonly database: Sql }): Promise<void> {
	await options.database.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(776161003)`;
		const present =
			await tx`select to_regclass('utils_workflow.version') as version, to_regclass('utils_workflow.hosts') as hosts`;
		if (present[0]!.version !== null) {
			const current = await tx`select version from utils_workflow.version where id`;
			if (!Number.isSafeInteger(current[0]?.version) || current[0]!.version < 1 || current[0]!.version > version) {
				throw new ExecutionError('schema_version');
			}
			if (current[0]!.version === version) return;
		}
		if (present[0]!.hosts !== null) {
			const active =
				await tx`select id from utils_workflow.hosts where not draining and expires>clock_timestamp() limit 1`;
			if (active.length) {
				throw new ExecutionError('migration_workers_active', 'Drain workers before upgrading the execution schema.');
			}
		}
		// Registration shares the migration lock. Old workers and unrelated database readers still need operational draining.
		await tx`set local lock_timeout = '5000ms'`;
		await tx.unsafe(migration);
		const rows = await tx`select version from utils_workflow.version where id`;
		if (rows[0]?.version !== version) throw new ExecutionError('schema_version');
	});
}

/** Validate rows read from storage before using them as runtime values. */
const RunSchema = schema.define((input) => {
	if (!record.is(input)) schema.reject('Saved workflow row must be an inert record.');
	if (!Object.hasOwn(input, 'input')) schema.reject('Saved workflow input is required.');
	const id = ReferenceSchema.parse({
		id: input.id,
		namespace: 'row',
		scope: input.scope,
		definition: { kind: input.kind, id: input.definition, version: input.version },
	});
	const integer = (value: unknown): number => {
		if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
			schema.reject('Expected a stored safe integer.');
		}
		return value;
	};
	const nullableText = (value: unknown): string | null => {
		if (value !== null && typeof value !== 'string') schema.reject('Expected stored text or null.');
		return value;
	};
	// Validate the family UUID with the same reference contract. Extra SQL columns stay outside the returned record.
	const family = ReferenceSchema.parse({ ...id, id: input.family }).id;
	return {
		id: id.id,
		location: input.location == null ? undefined : placement.SelectionSchema.parse(input.location),
		trace: telemetry.saved(input.trace),
		scope: id.scope,
		kind: id.definition.kind,
		definition: id.definition.id,
		version: id.definition.version,
		input: input.input,
		policy: PolicySchema.parse(input.policy),
		state: StateSchema.parse(input.state),
		control: ControlSchema.parse({ paused: input.paused, revision: input.control_revision }),
		epoch: integer(input.epoch),
		generation: integer(input.generation),
		family,
		parent: nullableText(input.parent),
		outcome: input.outcome === null ? null : OutcomeSchema.parse(input.outcome),
		reason: nullableText(input.reason),
		successors: integer(input.successors),
		children: integer(input.children),
		chain_root: ReferenceSchema.parse({ ...id, id: input.chain_root }).id,
		chain_index: integer(input.chain_index),
		continued_to: nullableText(input.continued_to),
		continuation: input.continuation ?? null,
	};
});
type RunType = schema.Output<typeof RunSchema>;
type Native = Transaction | Sql;
/** Required order: registration share lock, run update lock, job update lock, then application domain locks. */
type GuardType = { run: RunType; job: Record<string, unknown> };
const terminal = ['completed', 'failed', 'cancelled', 'continued'];

/**

 * Create a store view for one namespace. Borrow the application pool without querying, migrating, or

 * starting workers.

 */
export function open(
	options: {
		readonly database: Sql;
		readonly namespace: string;
		readonly notifications?: boolean;
		readonly instrument?: telemetry.Instrument;
	},
): StoreType {
	if (!options.namespace.trim() || options.namespace.length > 128) {
		throw new TypeError('Namespace must contain 1..128 characters.');
	}
	return new Store(options.database, options.namespace, options.notifications ?? true, telemetry.get(options));
}

/** Save queue and progress changes. Closing this adapter view never closes the borrowed SQL pool. */
class Store implements StoreType {
	readonly namespace: string;
	readonly capabilities = Object.freeze([
		'postgres.transactions',
		'postgres.receipts',
		'reserved.successors',
		'workflow.activities',
		'workflow.children',
		'workflow.timers',
		'workflow.events',
		'workflow.controls',
		'workflow.cleanup',
		'workflow.continue',
		'effects.progress',
	]);
	/** Borrowed query pool. Disposal closes this view and its listeners, never this pool. */
	#database: Sql;
	/** Reject new work on this view after disposal starts; the caller still owns the pool. */
	#closed = false;
	/** When disabled, subscriptions do not acquire a LISTEN connection and callers can poll. */
	#notifications: boolean;
	#instrument: telemetry.Instrument;
	/** Close callbacks for the LISTEN connections owned by this view. */
	#subscriptions = new Set<() => Promise<void>>();
	/**
	 * Only claims created by this store can authorize writes. A guessed job ID or copied fields are
	 * insufficient.
	 */
	#claims = new WeakSet<Claim>();
	constructor(database: Sql, namespace: string, notifications: boolean, instrument: telemetry.Instrument) {
		this.#instrument = instrument;
		this.#database = database;
		this.#notifications = notifications;
		this.namespace = namespace;
	}
	/** Close this view's notification connections without closing the borrowed query pool. */
	async [Symbol.asyncDispose](): Promise<void> {
		this.#closed = true;
		await Promise.all([...this.#subscriptions].map((close) => close()));
	}
	/** Own one notification connection for this subscription. Closing it also releases any reconnected session. */
	async subscribe(notify: () => void): Promise<() => Promise<void>> {
		this.#assert();
		if (!this.#notifications) return async () => {};
		let active = true;
		// Postgres.js itself clones these parsed options for LISTEN. Its public constructor
		// type omits parsed host/port arrays, so keep this adaptation at the driver boundary.
		const listener = postgresjs(
			{ ...this.#database.options, max: 1, onclose() {} } as unknown as Options<Record<string, never>>,
		);
		/** Release this subscription once, including after LISTEN reconnects. */
		const close = async () => {
			if (!active) return;
			active = false;
			this.#subscriptions.delete(close);
			await listener.end({ timeout: 1 });
		};
		this.#subscriptions.add(close);
		try {
			await listener.listen('utils_workflow', (namespace) => {
				if (active && namespace === this.namespace) notify();
			}, () => {
				if (active) notify();
			});
			this.#assert();
			return close;
		} catch (error) {
			await close();
			throw error;
		}
	}

	/** Find runnable work and saved deadlines for the slots this worker can fill. */
	async next(options?: {
		readonly workflows?: readonly IdentityType[];
		readonly activities: readonly IdentityType[];
		readonly finalizers: readonly IdentityType[];
	}): Promise<number | undefined> {
		this.#assert();
		const rows = await this
			.#database`select case when min(due) is null then null else greatest(0,ceil(extract(epoch from (min(due)-clock_timestamp()))*1000))::float8 end as delay from (
			(select clock_timestamp() as due from utils_workflow.runs r where r.namespace=${this.namespace} and r.kind='workflow' and r.state='ready' and not r.paused and ${
			options === undefined || (options.workflows?.length ?? 0) > 0
		}
			and (${options === undefined} or exists(select 1 from jsonb_array_elements(${
			this.#database.json([...(options?.workflows ?? [])])
		}) d where d->>'id'=r.definition and d->>'version'=r.version)) limit 1)
			union all (select expires as due from utils_workflow.runs where namespace=${this.namespace} and state='advancing' order by expires limit 1)
			union all (select j.expires from utils_workflow.jobs j join utils_workflow.runs r on r.namespace=j.namespace and r.id=j.run where j.namespace=${this.namespace} and j.state='claimed' and r.state in ('ready','waiting','advancing','settling') order by j.expires limit 1)
			union all (select j.available from utils_workflow.jobs j join utils_workflow.runs r on r.namespace=j.namespace and r.id=j.run where j.namespace=${this.namespace} and j.state='ready' and r.state in ('ready','waiting','advancing','settling') and (not r.paused or j.finalizer) and ${
			options === undefined || options.activities.length > 0 || options.finalizers.length > 0
		}
			and (${options === undefined} or exists(select 1 from jsonb_array_elements(${
			this.#database.json([...(options?.activities ?? [])])
		}) d where d=j.definition and not j.finalizer) or exists(select 1 from jsonb_array_elements(${
			this.#database.json([...(options?.finalizers ?? [])])
		}) d where d=j.definition and j.finalizer)) order by j.available limit 1)
			union all (select i.due from utils_workflow.instructions i join utils_workflow.runs r on r.namespace=i.namespace and r.id=i.run
			where i.namespace=${this.namespace} and i.outcome is null and i.due is not null and r.state in ('ready','waiting','advancing') and not r.paused order by i.due limit 1)
		) deadlines`;
		// PostgreSQL greatest ignores NULL. Test the aggregate separately to distinguish no saved deadline.
		return rows[0]?.delay == null ? undefined : Number(rows[0].delay);
	}

	/** Reject new work after disposal; an open application pool does not reopen this view. */
	#assert(): void {
		if (this.#closed) throw new ExecutionError('store_closed');
	}
	/**
	 * Run an adapter operation on one connection with finite SQL and lock waits.
	 * The transaction timeout also covers time spent awaiting application code.
	 * These limits belong to this transaction and do not change the borrowed pool defaults.
	 * They start after connection admission and require a responsive server. The
	 * application owns pool queue limits and transport failure detection.
	 */
	#transaction<Value>(callback: (tx: Transaction) => Promise<Value>): Promise<Value> {
		this.#assert();
		return begin(this.#database, async (tx) => {
			// Locks and transactions are bounded even if a caller waits inside its callback.
			await tx`set local statement_timeout = '5000ms'`;
			await tx`set local lock_timeout = '2000ms'`;
			await tx`set local idle_in_transaction_session_timeout = '10000ms'`;
			await tx`set local transaction_timeout = '10000ms'`;
			return await callback(tx);
		});
	}
	/** Accept only a live transaction opened by begin() on this exact borrowed pool. */
	#native(input: unknown): Transaction {
		if ((typeof input !== 'function' && typeof input !== 'object') || input === null) {
			throw new ExecutionError('transaction_binding');
		}
		const entry = transactions.get(input);
		if (!entry?.active || entry.database !== this.#database) throw new ExecutionError('transaction_binding');
		return input as Transaction;
	}
	/** Build a public reference from saved identity, without exposing the mutable run row. */
	#ref(run: Pick<RunType, 'id' | 'scope' | 'kind' | 'definition' | 'version'>): ReferenceType {
		return ReferenceSchema.parse({
			id: run.id,
			namespace: this.namespace,
			scope: run.scope,
			definition: { kind: run.kind, id: run.definition, version: run.version },
		});
	}
	/** Reject malformed references and references owned by another namespace. */
	#reference(ref: ReferenceType): void {
		this.#assert();
		if (ReferenceSchema.parse(ref).namespace !== this.namespace) throw new ExecutionError('reference_conflict');
	}
	/** Require the saved scope and exact definition as well as the namespace and UUID checked by the caller. */
	#matches(run: RunType, ref: ReferenceType): void {
		if (address(this.#ref(run).definition) !== address(ref.definition) || run.scope !== ref.scope) {
			throw new ExecutionError('reference_conflict');
		}
	}
	/**
	 * Read and validate one namespace-owned row; mutating callers request its update lock before
	 * dependent writes.
	 */
	async #run(tx: Native, id: string, lock = false): Promise<RunType> {
		const rows = lock
			? await tx`select * from utils_workflow.runs where namespace=${this.namespace} and id=${id} for update`
			: await tx`select * from utils_workflow.runs where namespace=${this.namespace} and id=${id}`;
		if (!rows[0]) throw new ExecutionError('not_found');
		return RunSchema.parse(rows[0]);
	}
	/**
	 * Read the installed revision and required schema features before declaring this store ready. No
	 * migration runs implicitly.
	 */
	async check(signal?: AbortSignal): Promise<void> {
		this.#assert();
		signal?.throwIfAborted();
		// Refuse a partially installed or incompatible schema before accepting worker readiness.
		const query = this.#database`select version, exists (
      select 1 from information_schema.columns where table_schema='utils_workflow'
      and table_name='runs' and column_name='trace' and data_type='jsonb'
    ) as trace, (to_regclass('utils_workflow.cleanups') is not null and to_regclass('utils_workflow.events') is not null and to_regclass('utils_workflow.progress') is not null and exists(select 1 from information_schema.columns where table_schema='utils_workflow' and table_name='instructions' and column_name='event_key') and exists(select 1 from information_schema.columns where table_schema='utils_workflow' and table_name='instructions' and column_name='parent') and exists(select 1 from information_schema.columns where table_schema='utils_workflow' and table_name='instructions' and column_name='branches')) as reports,
    (to_regclass('utils_workflow.run_events') is not null and (select count(*) from information_schema.columns where table_schema='utils_workflow' and table_name='runs' and column_name in ('paused','control_revision','updated_at','finished_at','chain_root','chain_index','continued_to','continuation'))=8 and exists(select 1 from information_schema.columns where table_schema='utils_workflow' and table_name='progress' and column_name='reported_at')) as operations from utils_workflow.version where id`;
		const abort = () => {
			query.cancel();
		};
		signal?.addEventListener('abort', abort, { once: true });
		try {
			const rows = await query;
			signal?.throwIfAborted();
			if (
				rows[0]?.version !== version || rows[0]?.trace !== true || rows[0]?.reports !== true ||
				rows[0]?.operations !== true
			) {
				throw new ExecutionError('schema_version');
			}
		} finally {
			signal?.removeEventListener('abort', abort);
		}
	}
	/** Admit a root request or a guarded successor, optionally in the caller's own transaction. */
	async accept(input: AdmissionType, native?: unknown): Promise<ReferenceType> {
		this.#assert();
		const work = async (tx: Transaction) => {
			const parent = input.claim === undefined ? undefined : (await this.#guard(tx, input.claim)).run;
			if (
				parent && (parent.scope !== input.scope || await fingerprint(parent.policy) !== await fingerprint(input.policy))
			) throw new ExecutionError('successor_policy');
			return await this.#accept(tx, input, parent, 'successor');
		};
		return native === undefined ? await this.#transaction(work) : await work(this.#native(native));
	}
	/**
	 * Check queue limits and command keys one at a time in this namespace. Ordinary attempts do not take
	 * this lock.
	 */
	async #accept(
		tx: Transaction,
		input: AdmissionType,
		parent?: RunType,
		relation?: 'child' | 'successor',
		cancellation?: string,
	): Promise<ReferenceType> {
		const policy = PolicySchema.parse(input.policy);
		const contract = identity(input.definition);
		const rules = contract.kind === 'activity'
			? policy.activities.find((entry) => address(entry.definition) === address(contract))
			: policy.workflows.find((entry) => address(entry.definition) === address(contract));
		if (!rules) throw new ExecutionError('definition_policy');
		const location = input.location === undefined && parent?.location === undefined
			? undefined
			: placement.intersect(parent?.location, input.location);
		const digest = await fingerprint(
			location === undefined ? decode(input.input) : { input: decode(input.input), location },
		);
		const policyhash = await fingerprint(policy);
		await tx`select pg_advisory_xact_lock(hashtextextended(${this.namespace}, 776161004))`;
		const found =
			await tx`select * from utils_workflow.runs where namespace=${this.namespace} and scope=${input.scope} and kind=${contract.kind} and definition=${contract.id} and key=${input.key}`;
		if (found[0]) {
			if (
				found[0].fingerprint !== digest ||
				await fingerprint(found[0].location ?? null) !== await fingerprint(location ?? null) ||
				found[0].version !== contract.version ||
				found[0].policyhash !== policyhash || (parent !== undefined && found[0].family !== parent.family)
			) throw new ExecutionError('admission_conflict');
			return this.#ref(RunSchema.parse(found[0]));
		}
		const reservation = reserve(policy, contract);
		if (!parent) {
			// Charge a family's root reservation once while any member is live, including after root completion.
			const usage = await tx`with live_families as materialized (
 select distinct family from utils_workflow.runs where namespace=${this.namespace}
 and state not in ('completed','failed','cancelled','continued')
 ) select count(*)::integer as roots,
 coalesce(sum((r.reservation->>'successors')::integer),0)::integer as successors,
 coalesce(sum((r.reservation->>'children')::integer),0)::integer as children,
 coalesce(sum((r.reservation->>'finalizers')::integer),0)::integer as finalizers
 from live_families live join utils_workflow.runs r on r.namespace=${this.namespace} and r.id=live.family
 where r.id=r.family and r.policy->>'id'=${policy.id} and r.policy->>'version'=${policy.version}`;
			const current = usage[0]!;
			if (
				current.roots >= policy.limits.pendingRoots ||
				current.successors + reservation.successors > policy.limits.reservedSuccessors ||
				current.children + reservation.children > policy.limits.pendingChildren ||
				current.finalizers + reservation.finalizers > policy.limits.pendingFinalizers
			) throw new ExecutionError('admission_capacity');
		} else if (relation === 'successor') {
			const allowed = policy.successors.find((entry) =>
				address(entry.from) === address({ kind: parent.kind, id: parent.definition, version: parent.version })
			);
			if (
				!allowed || parent.successors >= allowed.maximum ||
				!allowed.choices.some((entry) => address(entry) === address(contract))
			) throw new ExecutionError('successor_capacity');
			await tx`update utils_workflow.runs set successors=successors+1 where namespace=${this.namespace} and id=${parent.id}`;
		} else {
			const owner = policy.workflows.find((entry) =>
				entry.definition.id === parent.definition && entry.definition.version === parent.version
			);
			const allowed = owner?.children.find((entry) => address(entry.definition) === address(contract));
			const prior =
				await tx`select count(*)::integer as count from utils_workflow.runs where namespace=${this.namespace} and parent=${parent.id} and kind=${contract.kind} and definition=${contract.id} and version=${contract.version}`;
			if (!owner || !allowed || parent.children >= owner.maximumChildren || prior[0]!.count >= allowed.maximum) {
				throw new ExecutionError('child_capacity');
			}
			await tx`update utils_workflow.runs set children=children+1 where namespace=${this.namespace} and id=${parent.id}`;
		}
		const id = crypto.randomUUID();
		await tx`insert into utils_workflow.runs (namespace,id,scope,key,kind,definition,version,input,fingerprint,policy,policyhash,state,family,parent,cancellation,reservation,trace,location)
 values (${this.namespace},${id},${input.scope},${input.key},${contract.kind},${contract.id},${contract.version},${
			tx.json(input.input)
		},${digest},${tx.json(policy)},${policyhash},${contract.kind === 'workflow' ? 'ready' : 'waiting'},${
			parent?.family ?? id
		},${parent?.id ?? null},${cancellation ?? 'independent'},${tx.json(reservation)},${
			tx.json(telemetry.saved(input.trace) ?? this.#instrument.capture() ?? parent?.trace ?? null)
		},${location === undefined ? null : tx.json(location)})`;
		const run = await this.#run(tx, id);
		if (contract.kind === 'activity') {
			await this.#job(
				tx,
				run,
				'root',
				contract,
				input.input,
				policy.activities.find((entry) => address(entry.definition) === address(contract))!,
			);
		}
		return this.#ref(run);
	}
	/**
	 * Read a saved run and bounded progress observations after checking its exact reference. Intended
	 * success can precede required finalization.
	 */
	async get(ref: ReferenceType, options: { readonly children?: boolean } = {}): Promise<SnapshotType> {
		this.#reference(ref);
		const run = await this.#run(this.#database, ref.id);
		this.#matches(run, ref);
		const reports = await this.#database`with recursive tree as (
 select id from utils_workflow.runs where namespace=${this.namespace} and id=${run.id}
 union all select r.id from utils_workflow.runs r join tree t on r.parent=t.id where ${
			options.children ?? false
		} and r.namespace=${this.namespace} and r.scope=${run.scope}
 ) select p.*,j.path,r.scope,r.kind,r.definition,r.version from tree t join utils_workflow.progress p on p.namespace=${this.namespace} and p.run=t.id
 join utils_workflow.runs r on r.namespace=p.namespace and r.id=p.run join utils_workflow.jobs j on j.namespace=p.namespace and j.id=p.job order by p.job,p.effect limit 1001`;
		return Object.freeze({
			ref: this.#ref(run),
			state: run.state,
			control: run.control,
			...(run.continued_to === null ? {} : { continuedTo: this.#ref({ ...run, id: run.continued_to }) }),
			progressTruncated: reports.length > 1000,
			progress: reports.slice(0, 1000).map((row) => {
				const occurrence = decode(row.occurrence as ReturnType<typeof encode>) as EffectEncoded;
				return {
					job: row.job as string,
					attempt: row.attempt as number,
					revision: row.revision as string,
					effect: occurrence,
					progress: occurrence.value,
					operation: row.path as string,
					run: ReferenceSchema.parse({
						id: row.run,
						namespace: this.namespace,
						scope: row.scope,
						definition: { kind: row.kind, id: row.definition, version: row.version },
					}),
				};
			}),
			epoch: run.epoch,
			...(run.outcome === null ? {} : { exit: run.outcome }),
			...(run.reason === null ? {} : { reason: run.reason }),
		});
	}
	/** Persist a bounded latest report under the same attempt check used for business writes. */
	async report(claim: Claim, effect: EffectEncoded, sequence: number): Promise<void> {
		if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ExecutionError('progress_sequence');
		await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, claim);
			const occurrence = decode(encode(effect, run.policy.limits.resultBytes)) as EffectEncoded;
			const old =
				await tx`select * from utils_workflow.progress where namespace=${this.namespace} and run=${run.id} and job=${claim.jobId} and effect=${occurrence.id}`;
			if (old[0] && old[0].generation === claim.generation && old[0].sequence >= sequence) return;
			const saved = encode(occurrence, run.policy.limits.resultBytes);
			const bytes = new TextEncoder().encode(JSON.stringify(saved)).byteLength + occurrence.id.length * 3 + 128;
			await this.#budget(tx, run, bytes - (old[0]?.bytes ?? 0));
			await tx`insert into utils_workflow.progress(namespace,run,job,effect,generation,sequence,attempt,revision,occurrence,bytes)
 values(${this.namespace},${run.id},${claim.jobId},${occurrence.id},${claim.generation},${sequence},${claim.sequence},${crypto.randomUUID()},${
				tx.json(saved)
			},${bytes})
 on conflict(namespace,run,job,effect) do update set generation=excluded.generation,sequence=excluded.sequence,attempt=excluded.attempt,revision=excluded.revision,occurrence=excluded.occurrence,bytes=excluded.bytes,reported_at=clock_timestamp()`;
		});
	}
	/** Retain early delivery. The run lock serializes delivery, wait installation, timeout, and cancellation. */
	async send(ref: ReferenceType, event: string, key: string, value: ReturnType<typeof encode>): Promise<void> {
		this.#reference(ref);
		if (!event.trim() || event.length > 256 || !key.trim() || key.length > 512) throw new ExecutionError('event_key');
		await this.#transaction(async (tx) => {
			const run = await this.#run(tx, ref.id, true);
			this.#matches(run, ref);
			if (run.kind !== 'workflow') throw new ExecutionError('event_binding');
			const checked = encode(decode(value), run.policy.limits.inputBytes);
			const hash = await fingerprint(checked);
			const old =
				await tx`select fingerprint from utils_workflow.events where namespace=${this.namespace} and run=${run.id} and event=${event} and key=${key}`;
			if (old[0]) {
				if (old[0].fingerprint !== hash) throw new ExecutionError('event_conflict');
				return;
			}
			if (
				run.outcome !== null || run.continuation !== null || run.state === 'blocked' || terminal.includes(run.state)
			) throw new ExecutionError('event_closed');
			const waits =
				await tx`select path,outcome,due,due<=clock_timestamp() as expired from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and event=${event} and event_key=${key}`;
			if (waits[0] && (waits[0].outcome !== null || waits[0].expired)) throw new ExecutionError('event_closed');
			const bytes = new TextEncoder().encode(JSON.stringify(checked)).byteLength + event.length * 3 + key.length * 3 +
				128;
			await this.#budget(tx, run, bytes);
			await tx`insert into utils_workflow.events(namespace,run,event,key,value,fingerprint,bytes) values(${this.namespace},${run.id},${event},${key},${
				tx.json(checked)
			},${hash},${bytes})`;
			if (waits[0]) {
				const outcome: OutcomeType = {
					type: 'success',
					value: encode({ type: 'received', value: decode(checked) }, run.policy.limits.resultBytes),
				};
				if (await this.#record(tx, run, waits[0].path as string, outcome)) {
					await tx`update utils_workflow.runs set state=case when state='advancing' then state else 'ready' end,expires=case when state='advancing' then expires else null end where namespace=${this.namespace} and id=${run.id}`;
				}
			}
		});
	}
	/** All retained event and report data shares the run's explicit history budget. */
	async #budget(tx: Transaction, run: RunType, additional: number): Promise<void> {
		const rows = await tx`select (
 (select coalesce(sum(bytes),0) from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id}) +
 (select coalesce(sum(bytes),0) from utils_workflow.events where namespace=${this.namespace} and run=${run.id}) +
 (select coalesce(sum(bytes),0) from utils_workflow.progress where namespace=${this.namespace} and run=${run.id})
 )::integer as bytes`;
		if (rows[0]!.bytes + additional > run.policy.limits.historyBytes) throw new ExecutionError('history_limit');
	}

	/**

	 * Publish one executor lifetime with its definitions and limits. Replacement gets a new generation

	 * so old claims cannot act as the new host.

	 */
	async register(
		id: string,
		definitions: readonly IdentityType[],
		engine: string,
		capacity: { readonly activations: number; readonly activities: number },
		leaseMs: number,
		registration?: { readonly compute?: ComputeType; readonly affinity?: EngineAffinityType },
	): Promise<HostType> {
		const lineage = placement.path(registration?.compute);
		const supplied = registration?.affinity ?? {};
		record.assert(supplied, 'host affinity');
		const affinity = Object.freeze({ ...supplied });
		for (const value of Object.values(affinity)) {
			if (
				!['string', 'boolean', 'number'].includes(typeof value) ||
				(typeof value === 'number' && !Number.isFinite(value))
			) throw new TypeError('Invalid host affinity.');
		}
		return await this.#transaction(async (tx) => {
			// New registrations cannot cross the version check and an actual schema upgrade.
			await tx`select pg_advisory_xact_lock_shared(776161003)`;
			const schema = await tx`select version from utils_workflow.version where id`;
			if (schema[0]?.version !== version) throw new ExecutionError('schema_version');
			await this.#placementLock(tx);
			for (const node of lineage) {
				const saved =
					await tx`select generation,value from utils_workflow.compute where namespace=${this.namespace} and id=${node.id} for update`;
				if (
					saved[0] &&
					(Number(saved[0].generation) > node.generation ||
						(Number(saved[0].generation) === node.generation &&
							await fingerprint(saved[0].value) !== await fingerprint(node)))
				) {
					throw new ExecutionError('compute_conflict');
				}
				await tx`insert into utils_workflow.compute(namespace,id,generation,value) values(${this.namespace},${node.id},${node.generation},${
					tx.json(node)
				}) on conflict(namespace,id) do update set generation=excluded.generation,value=excluded.value`;
			}
			const rows =
				await tx`insert into utils_workflow.hosts(namespace,id,generation,definitions,engine,activations,activities,expires,compute,affinity)
 values (${this.namespace},${id},1,${
					tx.json([...definitions])
				},${engine},${capacity.activations},${capacity.activities},clock_timestamp()+${leaseMs}*interval '1 millisecond',${
					tx.json([...lineage])
				},${tx.json(affinity)})
 on conflict(namespace,id) do update set generation=utils_workflow.hosts.generation+1,definitions=excluded.definitions,engine=excluded.engine,activations=excluded.activations,activities=excluded.activities,expires=excluded.expires,compute=excluded.compute,affinity=excluded.affinity,draining=false returning generation`;
			return Object.freeze({ id, generation: rows[0]!.generation });
		});
	}
	/**
	 * Lock ancestors before the live host generation, then let the caller lock its run and job.
	 * Renewal requests an update lock immediately: two shared locks cannot safely upgrade together.
	 * Ordinary guarded operations keep a shared lock so independent attempts can run concurrently.
	 */
	async #host(tx: Native, host: HostType, mode: 'share' | 'update' = 'share'): Promise<void> {
		const paths =
			await tx`select compute from utils_workflow.hosts where namespace=${this.namespace} and id=${host.id} and generation=${host.generation}`;
		if (!paths[0]) throw new ExecutionError('stale_claim');
		// Lock ancestors root first, before the host row, matching registration lock order.
		for (const node of paths[0].compute as placement.BoundaryType[]) {
			const current =
				await tx`select generation from utils_workflow.compute where namespace=${this.namespace} and id=${node.id} for share`;
			if (Number(current[0]?.generation) !== node.generation) throw new ExecutionError('stale_claim');
		}
		const rows = mode === 'update'
			? await tx`select id from utils_workflow.hosts where namespace=${this.namespace} and id=${host.id} and generation=${host.generation} and expires>clock_timestamp() and not draining for update`
			: await tx`select id from utils_workflow.hosts where namespace=${this.namespace} and id=${host.id} and generation=${host.generation} and expires>clock_timestamp() and not draining for share`;
		if (rows.length !== 1) throw new ExecutionError('stale_claim');
	}
	/** Serialize shared ancestor admission and topology replacement in this namespace. */
	async #placementLock(tx: Transaction): Promise<void> {
		await tx`select pg_advisory_xact_lock(hashtextextended(${this.namespace}, 776161009))`;
	}
	/** Check this worker's free slots one at a time. Release the slot-check lock before running activity code. */
	async #capacity(tx: Transaction, host: HostType): Promise<void> {
		await tx`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([this.namespace, host.id])}, 776161005))`;
	}
	/**
	 * Extend a live host registration, using the database clock.
	 * The generation check rejects a replaced host. Expiry cannot be undone by renewal.
	 * Renew this registration before renewing the attempts that depend on it.
	 */
	async renewHost(host: HostType, leaseMs: number): Promise<void> {
		await this.#transaction(async (tx) => {
			await this.#host(tx, host, 'update');
			await tx`update utils_workflow.hosts set expires=clock_timestamp()+${leaseMs}*interval '1 millisecond' where namespace=${this.namespace} and id=${host.id} and generation=${host.generation}`;
		});
	}
	/** Stop admission for this generation only; an older host cannot drain its replacement. */
	async leave(host: HostType): Promise<void> {
		await this
			.#database`update utils_workflow.hosts set draining=true where namespace=${this.namespace} and id=${host.id} and generation=${host.generation}`;
	}
	/**
	 * Create and retain an object-identity permission token; copying its public fields cannot authorize
	 * adapter writes.
	 */
	#claim(run: RunType, jobId: string, generation: number, sequence: number, host: HostType): Claim {
		const claim = Object.freeze({
			runId: run.id,
			jobId,
			epoch: run.epoch,
			generation,
			sequence,
			hostId: host.id,
			hostGeneration: host.generation,
		});
		this.#claims.add(claim);
		return claim;
	}
	/**
	 * Claim a ready workflow turn only when the current host has activation capacity. The transaction
	 * records permission before the worker rebuilds code.
	 */
	async activate(host: HostType, definitions: readonly IdentityType[]): Promise<ActivationType | undefined> {
		return await this.#transaction(async (tx) => {
			await this.#host(tx, host);
			await this.#capacity(tx, host);
			const capacity =
				await tx`select h.activations, (select count(*) from utils_workflow.runs r where r.namespace=h.namespace and r.host=h.id and r.host_generation=h.generation and r.state='advancing' and r.expires>clock_timestamp())::integer as active from utils_workflow.hosts h where namespace=${this.namespace} and id=${host.id}`;
			if (capacity[0]!.active >= capacity[0]!.activations) return;
			const rows =
				await tx`select * from utils_workflow.runs r where namespace=${this.namespace} and state='ready' and kind='workflow' and not paused
 and exists(select 1 from jsonb_array_elements(${tx.json([...definitions])}) d where d->>'id'=r.definition)
 and (exists(select 1 from jsonb_array_elements(${
					tx.json([...definitions])
				}) d where d->>'id'=r.definition and d->>'version'=r.version)
 or not exists(select 1 from utils_workflow.hosts h where h.namespace=r.namespace and not h.draining and h.expires>clock_timestamp()
 and h.definitions @> jsonb_build_array(jsonb_build_object('kind','workflow','id',r.definition,'version',r.version))))
 order by created for update skip locked limit 1`;
			if (!rows[0]) return;
			const run = RunSchema.parse(rows[0]);
			if (!definitions.some((entry) => address(entry) === address(this.#ref(run).definition))) {
				await tx`update utils_workflow.runs set state='blocked',reason='missing_version' where namespace=${this.namespace} and id=${run.id}`;
				return;
			}
			const generation = run.generation + 1;
			await tx`update utils_workflow.runs set state='advancing',generation=${generation},host=${host.id},host_generation=${host.generation},expires=clock_timestamp()+${run.policy.claims.leaseMs}*interval '1 millisecond' where namespace=${this.namespace} and id=${run.id}`;
			return {
				claim: this.#claim(run, run.id, generation, 0, host),
				ref: this.#ref(run),
				trace: run.trace,
				...(run.location === undefined ? {} : { location: run.location }),
				input: encode(decode(run.input as ReturnType<typeof encode>), run.policy.limits.inputBytes),
				policy: run.policy,
			};
		});
	}
	/**
	 * Reserve an eligible activity and all required ancestor capacity in one transaction. Competing hosts
	 * must not each admit against the same free slot.
	 */
	async take(host: HostType, definitions: readonly IdentityType[], finalizer?: boolean): Promise<JobType | undefined> {
		return await this.#transaction(async (tx) => {
			await this.#placementLock(tx);
			await this.#host(tx, host);
			await this.#capacity(tx, host);
			const capacity =
				await tx`select h.activities, (select count(*) from utils_workflow.jobs j where j.namespace=h.namespace and j.host=h.id and j.host_generation=h.generation and j.state='claimed' and j.expires>clock_timestamp())::integer as active from utils_workflow.hosts h where namespace=${this.namespace} and id=${host.id}`;
			if (capacity[0]!.active >= capacity[0]!.activities) return;
			const registered =
				await tx`select compute,affinity from utils_workflow.hosts where namespace=${this.namespace} and id=${host.id}`;
			const lineage = registered[0]!.compute as placement.BoundaryType[];
			for (const node of lineage) {
				if (node.capacity === undefined) continue;
				const occupied =
					await tx`select count(*)::integer as active from utils_workflow.jobs j join utils_workflow.hosts h on h.namespace=j.namespace and h.id=j.host and h.generation=j.host_generation where j.namespace=${this.namespace} and j.state='claimed' and j.expires>clock_timestamp() and h.compute @> ${
						tx.json([{ id: node.id, generation: node.generation }])
					}::jsonb`;
				if (occupied[0]!.active >= node.capacity) return;
			}
			// Exclude locked owners before the bounded scan, then take each job under its owner lock.
			const candidates =
				await tx`select j.id,j.run from utils_workflow.jobs j join utils_workflow.runs r on r.namespace=j.namespace and r.id=j.run
 where j.namespace=${this.namespace} and j.state='ready' and j.available<=clock_timestamp()
 and r.state in ('waiting','ready','advancing','settling')
 and (not r.paused or j.finalizer)
 and (${finalizer ?? null}::boolean is null or j.finalizer=${finalizer ?? null})
 and exists(select 1 from jsonb_array_elements(${tx.json([...definitions])}) d where d=j.definition)
 and (j.location is null or (coalesce(j.location->'within','[]'::jsonb) <@ ${tx.json([...lineage])}::jsonb
 and (j.location->'on' is null or ${tx.json(lineage.at(-1) ?? {})}::jsonb @> (j.location->'on'))))
 and (j.affinity is null or j.affinity <@ ${tx.json(registered[0]!.affinity)}::jsonb)
 order by j.finalizer desc,j.available,j.id for update of r skip locked limit 32`;
			for (const candidate of candidates) {
				const locked =
					await tx`select * from utils_workflow.runs where namespace=${this.namespace} and id=${candidate.run} for update skip locked`;
				if (!locked[0]) continue;
				const run = RunSchema.parse(locked[0]);
				const jobs =
					await tx`select * from utils_workflow.jobs where namespace=${this.namespace} and id=${candidate.id} and state='ready' and available<=clock_timestamp() for update`;
				if (
					!jobs[0] || !['waiting', 'ready', 'advancing', 'settling'].includes(run.state) ||
					(run.control.paused && !jobs[0].finalizer)
				) continue;
				const job = jobs[0];
				const originPath = (job.path as string).startsWith('cleanup:')
					? (job.path as string).slice(8)
					: job.path as string;
				const origins =
					await tx`select fingerprint from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and path=${originPath}`;
				const admissions = origins.length
					? origins
					: await tx`select fingerprint from utils_workflow.runs where namespace=${this.namespace} and id=${run.id}`;
				const rules = job.rules as AttemptType;
				const generation = job.generation + 1;
				const sequence = job.sequence + 1;
				await tx`update utils_workflow.jobs set state='claimed',generation=${generation},sequence=${sequence},host=${host.id},host_generation=${host.generation},expires=least(clock_timestamp()+${run.policy.claims.leaseMs}*interval '1 millisecond',clock_timestamp()+${rules.deadlineMs}*interval '1 millisecond'),deadline=clock_timestamp()+${rules.deadlineMs}*interval '1 millisecond' where namespace=${this.namespace} and id=${job.id}`;
				await tx`insert into utils_workflow.attempts(namespace,job,generation,sequence,state) values (${this.namespace},${job.id},${generation},${sequence},'started')`;
				return {
					claim: this.#claim(run, job.id, generation, sequence, host),
					ref: this.#ref(run),
					trace: run.trace,
					input: job.input as ReturnType<typeof encode>,
					// Preserve the activity-specific intersection, which can be narrower than its parent run.
					...(job.location == null ? {} : { location: placement.SelectionSchema.parse(job.location) }),
					policy: run.policy,
					definition: identity(job.definition as IdentityType),
					attempt: rules,
					path: job.path as string,
					fingerprint: admissions[0]!.fingerprint as string,
				};
			}
		});
	}
	/**
	 * Check that this attempt still has permission before any application row can change.
	 * Lock worker registration, run, then job. Cancellation and replacement wait for these locks.
	 * A permitted write may finish while holding them even if its lease time passes before commit.
	 * A later write with the old permission is rejected. Keep application row locks after this check.
	 */
	async #guard(tx: Transaction, claim: Claim | undefined, activation = false): Promise<GuardType> {
		// Object identity proves that this view issued the claim; copied fields do not grant permission.
		if (!claim || !this.#claims.has(claim)) throw new ExecutionError('claim_binding');
		await this.#host(tx, { id: claim.hostId, generation: claim.hostGeneration });
		const run = await this.#run(tx, claim.runId, true);
		if (run.epoch !== claim.epoch || terminal.includes(run.state) || run.state === 'blocked') {
			throw new ExecutionError('stale_claim');
		}
		// A workflow activation owns the run itself. An activity attempt owns a separate job row.
		if (activation) {
			const valid =
				await tx`select id from utils_workflow.runs where namespace=${this.namespace} and id=${run.id} and state='advancing' and generation=${claim.generation} and host=${claim.hostId} and host_generation=${claim.hostGeneration} and expires>clock_timestamp()`;
			if (!valid.length) throw new ExecutionError('stale_claim');
			return { run, job: {} };
		}
		const jobs =
			await tx`select * from utils_workflow.jobs where namespace=${this.namespace} and id=${claim.jobId} and run=${run.id} and state='claimed' and generation=${claim.generation} and host=${claim.hostId} and host_generation=${claim.hostGeneration} and expires>clock_timestamp() and deadline>clock_timestamp() for update`;
		if (!jobs[0] || (run.state === 'settling' && !jobs[0].finalizer)) throw new ExecutionError('stale_claim');
		return { run, job: jobs[0] };
	}
	/**
	 * Extend a live activation or activity claim after checking its host and run.
	 * An activity keeps its original deadline: renewal extends permission to work,
	 * but does not grant more total time to finish the attempt.
	 */
	async renew(claim: Claim): Promise<void> {
		await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, claim, claim.jobId === claim.runId);
			if (claim.jobId === claim.runId) {
				await tx`update utils_workflow.runs set expires=clock_timestamp()+${run.policy.claims.leaseMs}*interval '1 millisecond' where namespace=${this.namespace} and id=${run.id}`;
			} else {
				await tx`update utils_workflow.jobs set expires=least(deadline,clock_timestamp()+${run.policy.claims.leaseMs}*interval '1 millisecond') where namespace=${this.namespace} and id=${claim.jobId}`;
			}
		});
	}
	/** Save the next runnable activity before its requesting transaction commits. No activity code runs here. */
	async #job(
		tx: Transaction,
		run: RunType,
		path: string,
		definition: IdentityType,
		input: ReturnType<typeof encode>,
		rules: AttemptType,
		finalizer = false,
		selection?: placement.SelectionType,
		affinity?: EngineAffinityType,
	): Promise<string> {
		const id = crypto.randomUUID();
		await tx`insert into utils_workflow.jobs(namespace,id,run,path,definition,input,rules,state,budget,finalizer,location,affinity) values (${this.namespace},${id},${run.id},${path},${
			tx.json(definition)
		},${tx.json(input)},${tx.json(rules)},'ready',${rules.maxAttempts},${finalizer},${
			tx.json(placement.intersect(run.location, selection))
		},${affinity === undefined ? null : tx.json(affinity)})`;
		return id;
	}
	/**
	 * Return a completed step during replay, or save its requested work and waiting state together.
	 * A job cannot become visible without its instruction. A worker result cannot be lost to a later waiting update.
	 * The shared run lock orders those changes even when different containers advance and complete the work.
	 */
	async instruction(
		activation: ActivationType,
		intent: IntentType,
		options = { park: true },
	): Promise<OutcomeType | undefined> {
		return await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			const found =
				await tx`select * from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and path=${intent.path}`;
			if (found[0]) {
				if (found[0].fingerprint !== intent.fingerprint) throw new ExecutionError('replay_conflict');
				if (found[0].outcome !== null) return OutcomeSchema.parse(found[0].outcome);
				if (options.park) {
					await tx`update utils_workflow.runs set state='waiting',expires=null where namespace=${this.namespace} and id=${run.id}`;
				}
				return;
			}
			const rule = run.policy.workflows.find((entry) =>
				address(entry.definition) === address(this.#ref(run).definition)
			);
			const count =
				await tx`select count(*)::integer as count from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id}`;
			if (rule && count[0]!.count >= rule.maxInstructions) throw new ExecutionError('instruction_limit');
			let bytes = new TextEncoder().encode(JSON.stringify(intent)).byteLength;
			const history = await tx`select (
 (select coalesce(sum(bytes),0) from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id}) +
 (select coalesce(sum(bytes),0) from utils_workflow.events where namespace=${this.namespace} and run=${run.id}) +
 (select coalesce(sum(bytes),0) from utils_workflow.progress where namespace=${this.namespace} and run=${run.id})
 )::integer as bytes`;
			if (history[0]!.bytes + bytes > run.policy.limits.historyBytes) throw new ExecutionError('history_limit');
			const due = intent.type === 'sleep'
				? (await tx`select clock_timestamp()+${intent.delay!}*interval '1 millisecond' as due`)[0]!.due as Date
				: intent.due;
			let job: string | null = null;
			let child: string | null = null;
			let outcome: OutcomeType | null = null;
			if (intent.type === 'defer') {
				if (!intent.cleanup || !['activity', 'child-workflow'].includes(intent.cleanup.type)) {
					throw new ExecutionError('cleanup_binding');
				}
				if (!rule?.requires.includes('workflow.cleanup')) throw new ExecutionError('cleanup_policy');
				await tx`insert into utils_workflow.cleanups(namespace,run,path,scope,request) values (${this.namespace},${run.id},${intent.path},${
					intent.parent ?? null
				},${tx.json(encode(intent.cleanup, run.policy.limits.historyBytes))})`;
				outcome = { type: 'success', value: encode(undefined, run.policy.limits.resultBytes) };
			} else if (intent.type === 'activity') {
				const rules = run.policy.activities.find((entry) => address(entry.definition) === address(intent.definition!));
				if (!rules) throw new ExecutionError('definition_policy');
				job = await this.#job(
					tx,
					run,
					intent.path,
					intent.definition!,
					intent.input!,
					rules,
					false,
					intent.location,
					intent.affinity,
				);
			} else if (intent.type === 'child-workflow') {
				const ref = await this.#accept(
					tx,
					{
						definition: intent.definition!,
						location: intent.location,
						input: intent.input!,
						policy: run.policy,
						scope: run.scope,
						key: `child:${run.id}:${intent.path}`,
					},
					run,
					'child',
					intent.cancellation,
				);
				child = ref.id;
				if (intent.discard) outcome = { type: 'success', value: encode(undefined, run.policy.limits.resultBytes) };
			} else if (intent.type === 'wait-event') {
				const other =
					await tx`select path from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and event=${intent
						.event!} and event_key=${intent.eventKey!}`;
				if (other.length) throw new ExecutionError('event_wait_conflict');
				const events =
					await tx`select value from utils_workflow.events where namespace=${this.namespace} and run=${run.id} and event=${intent
						.event!} and key=${intent.eventKey!} and (${intent.due ?? null}::timestamptz is null or created<=${
						intent.due ?? null
					}::timestamptz)`;
				if (events[0]) {
					outcome = {
						type: 'success',
						value: encode(
							{ type: 'received', value: decode(events[0].value as ReturnType<typeof encode>) },
							run.policy.limits.resultBytes,
						),
					};
				} else if (
					intent.due !== undefined && (await tx`select ${intent.due}::timestamptz<=clock_timestamp() as due`)[0]!.due
				) outcome = { type: 'success', value: encode({ type: 'timeout' }, run.policy.limits.resultBytes) };
			} else if (intent.type !== 'control') {
				const ready = await tx`select ${due!}::timestamptz<=clock_timestamp() as due`;
				if (ready[0]!.due) {
					outcome = {
						type: 'success',
						value: encode(due instanceof Date ? due.toISOString() : due, run.policy.limits.resultBytes),
					};
				}
			}
			if (outcome !== null) bytes += new TextEncoder().encode(JSON.stringify(outcome)).byteLength;
			if (history[0]!.bytes + bytes > run.policy.limits.historyBytes) throw new ExecutionError('history_limit');
			await tx`insert into utils_workflow.instructions(namespace,run,path,fingerprint,type,job,child,due,discard,outcome,bytes,event,event_key,parent,branches) values (${this.namespace},${run.id},${intent.path},${intent.fingerprint},${intent.type},${job},${child},${
				due ?? null
			},${intent.discard ?? false},${outcome === null ? null : tx.json(outcome)},${bytes},${intent.event ?? null},${
				intent.eventKey ?? null
			},${intent.parent ?? null},${intent.branches === undefined ? null : tx.json([...intent.branches])})`;
			if (outcome !== null) return outcome;
			if (options.park) {
				await tx`update utils_workflow.runs set state='waiting',expires=null where namespace=${this.namespace} and id=${run.id}`;
			}
		});
	}
	/** No completion can fall between the final check and the saved waiting state. */
	async park(activation: ActivationType, pending: readonly string[]): Promise<void> {
		await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			if (pending.length === 0) throw new ExecutionError('empty_wait');
			const scopes = pending.filter((path) => path.startsWith('@cleanup:')).map((path) => path.slice(9));
			const ordinary = pending.filter((path) => !path.startsWith('@cleanup:'));
			const completed =
				await tx`select path,outcome from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and path in ${
					tx(ordinary.length ? ordinary : ['@none'])
				}`;
			if (completed.length !== new Set(ordinary).size) throw new ExecutionError('replay_conflict');
			let cleanupReady = false;
			for (const scope of scopes) {
				const pendingCleanup =
					await tx`select path from utils_workflow.cleanups where namespace=${this.namespace} and run=${run.id} and (scope=${scope} or starts_with(scope,${
						scope + '/'
					})) and state!='completed' limit 1`;
				if (!pendingCleanup.length) cleanupReady = true;
			}
			await tx`update utils_workflow.runs set state=${
				cleanupReady || completed.some((step) => step.outcome !== null) ? 'ready' : 'waiting'
			},expires=null where namespace=${this.namespace} and id=${run.id}`;
		});
	}
	/** A removed nested step must block replay just like a removed root step. */
	async verify(activation: ActivationType, parent: string, instructions: number): Promise<void> {
		await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			const rows =
				await tx`select count(*)::integer as count from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and parent=${parent}`;
			if (rows[0]!.count !== instructions) throw new ExecutionError('replay_conflict');
		});
	}

	/** Winner selection and permission revocation share the parent run lock with activity writes. */
	async choose(activation: ActivationType, path: string, key: string): Promise<string> {
		return await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			const rows =
				await tx`select * from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and path=${path} and type='control'`;
			const entry = rows[0];
			if (!entry || !Array.isArray(entry.branches) || !entry.branches.includes(key)) {
				throw new ExecutionError('race_binding');
			}
			if (entry.outcome !== null) {
				const saved = OutcomeSchema.parse(entry.outcome);
				if (saved.type !== 'success') throw new ExecutionError('race_binding');
				return decode(saved.value) as string;
			}
			const outcome: OutcomeType = { type: 'cancelled', reason: 'Another race branch finished.' };
			for (const loser of entry.branches as string[]) {
				if (loser === key) continue;
				const prefix = `${path}/${encodeURIComponent(loser)}/`;
				await tx`update utils_workflow.attempts a set state='cancelled',ended=clock_timestamp() from utils_workflow.jobs j where j.namespace=${this.namespace} and j.run=${run.id} and starts_with(j.path,${prefix}) and j.state='claimed' and a.namespace=j.namespace and a.job=j.id and a.generation=j.generation`;
				await tx`update utils_workflow.jobs set state='failed',outcome=${
					tx.json(outcome)
				},expires=null,generation=generation+1 where namespace=${this.namespace} and run=${run.id} and starts_with(path,${prefix}) and state in ('ready','claimed')`;
				const abandoned =
					await tx`select path from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and starts_with(path,${prefix}) and outcome is null`;
				for (const step of abandoned) {
					if (!await this.#record(tx, run, step.path, outcome)) throw new ExecutionError('history_limit');
				}
			}
			if (!await this.#record(tx, run, path, { type: 'success', value: encode(key, run.policy.limits.resultBytes) })) {
				throw new ExecutionError('history_limit');
			}
			return key;
		});
	}

	/** Save a bounded continuation and finish this segment's cleanup before publishing its successor. */
	async continue(activation: ActivationType, request: ContinuationType, instructions: number): Promise<void> {
		await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			await continuation.request(tx, { namespace: this.namespace, run, request, instructions });
			await this.#settle(tx, await this.#run(tx, run.id));
		});
	}
	/** Verify the complete root instruction count before freezing the workflow intended exit. */
	async finish(activation: ActivationType, outcome: OutcomeType, instructions: number): Promise<void> {
		await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			const counts =
				await tx`select count(*)::integer as count from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and parent is null`;
			if (counts[0]!.count !== instructions) throw new ExecutionError('replay_conflict');
			await this.#exit(tx, run, OutcomeSchema.parse(outcome));
		});
	}
	/**
	 * Freeze the intended outcome, revoke ordinary sibling attempts, then admit durable cleanup and
	 * finalization.
	 */
	async #exit(tx: Transaction, run: RunType, outcome: OutcomeType): Promise<void> {
		await tx`update utils_workflow.runs set state=${'settling'},outcome=${
			tx.json(outcome)
		},expires=null,reason=null where namespace=${this.namespace} and id=${run.id}`;
		// A terminal parent no longer permits ordinary siblings to write. Retain their attempts as cancellation evidence.
		const cancelled: OutcomeType = { type: 'cancelled', reason: 'The parent workflow finished.' };
		await tx`update utils_workflow.attempts a set state='cancelled',ended=clock_timestamp() from utils_workflow.jobs j where j.namespace=${this.namespace} and j.run=${run.id} and not j.finalizer and j.state='claimed' and a.namespace=j.namespace and a.job=j.id and a.generation=j.generation`;
		await tx`update utils_workflow.jobs set state='failed',outcome=${
			tx.json(cancelled)
		},expires=null,generation=generation+1 where namespace=${this.namespace} and run=${run.id} and not finalizer and state in ('ready','claimed')`;

		await this.#settle(tx, { ...run, outcome });
	}
	/** Run saved cleanup first, then the configured exit activity. Keep the original outcome unchanged. */
	async #settle(tx: Transaction, run: RunType): Promise<void> {
		if (!await this.#cleanupNext(tx, run)) return;
		if (run.continuation !== null) {
			await continuation.rollover(tx, { namespace: this.namespace, run });
			return;
		}
		const outcome = run.outcome!;
		const finalizer = run.policy.finalizers.find((entry) =>
			entry.roots.some((root) => address(root) === address(this.#ref(run).definition))
		);
		if (finalizer) {
			const prior =
				await tx`select id from utils_workflow.jobs where namespace=${this.namespace} and run=${run.id} and path='finalizer'`;
			if (prior.length) return;
			await this.#job(
				tx,
				run,
				'finalizer',
				finalizer.activity,
				encode({
					run: {
						id: run.id,
						scope: run.scope,
						definition: this.#ref(run).definition,
						input: decode(run.input as ReturnType<typeof encode>),
					},
					exit: outcome,
				}, run.policy.limits.inputBytes + run.policy.limits.resultBytes + 8192),
				{ ...finalizer, recovery: 'retry', requires: ['postgres.transactions', 'postgres.receipts'] },
				true,
			);
		} else {await tx`update utils_workflow.runs set state=${
				outcome.type === 'success' ? 'completed' : outcome.type === 'cancelled' ? 'cancelled' : 'failed'
			},reason=null where namespace=${this.namespace} and id=${run.id}`;}
		// Recovery finds waiting parents through saved indexed rows. Do not lock a parent while holding its child lock.
	}
	/** Close a branch without closing the run. Registrations are durable before this method can start them. */
	async cleanupScope(activation: ActivationType, parent: string): Promise<boolean> {
		return await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			return await this.#cleanupNext(tx, run, parent);
		});
	}
	/** Start one cleanup at a time in reverse registration order within the selected scope. */
	async #cleanupNext(tx: Transaction, run: RunType, scope?: string): Promise<boolean> {
		const rows = await tx`select * from utils_workflow.cleanups where namespace=${this.namespace} and run=${run.id}
 and state!='completed' and (${scope ?? null}::text is null or scope=${scope ?? null} or starts_with(scope,${
			(scope ?? '') + '/'
		}))
 order by ordinal desc for update`;
		if (!rows.length) return true;
		// An already-running cleanup keeps its position even if another branch registered later.
		if (rows.some((row) => row.state === 'running')) return false;
		const next = rows[0]!;
		if (next.state === 'failed') return false;
		const request = decode(next.request as ReturnType<typeof encode>) as IntentType;
		let job: string | null = null;
		let child: string | null = null;
		if (request.type === 'activity') {
			const rules = run.policy.activities.find((entry) => address(entry.definition) === address(request.definition!));
			if (!rules) throw new ExecutionError('cleanup_binding');
			job = await this.#job(
				tx,
				run,
				`cleanup:${next.path as string}`,
				request.definition!,
				request.input!,
				rules,
				true,
				request.location,
				request.affinity,
			);
		} else {
			const reference = await this.#accept(
				tx,
				{
					definition: request.definition!,
					location: request.location,
					input: request.input!,
					policy: run.policy,
					scope: run.scope,
					key: `cleanup:${run.id}:${next.path as string}`,
				},
				run,
				'child',
				'independent',
			);
			child = reference.id;
		}
		await tx`update utils_workflow.cleanups set state='running',job=${job},child=${child} where namespace=${this.namespace} and run=${run.id} and path=${next
			.path as string}`;
		return false;
	}
	/** Cleanup failure blocks inspection without replacing the intended business outcome. */
	async #cleanupDone(
		tx: Transaction,
		run: RunType,
		path: string,
		scope: string | null,
		outcome: OutcomeType,
	): Promise<void> {
		await tx`update utils_workflow.cleanups set state=${outcome.type === 'success' ? 'completed' : 'failed'},outcome=${
			tx.json(outcome)
		} where namespace=${this.namespace} and run=${run.id} and path=${path}`;
		if (outcome.type !== 'success') {
			await tx`update utils_workflow.runs set state='blocked',reason='cleanup_exhausted' where namespace=${this.namespace} and id=${run.id}`;
			return;
		}
		if (run.outcome !== null || run.continuation !== null) await this.#settle(tx, run);
		else {
			await this.#cleanupNext(tx, run, scope ?? undefined);
			await tx`update utils_workflow.runs set state=case when state='advancing' then state else 'ready' end where namespace=${this.namespace} and id=${run.id}`;
		}
	}
	/** Persist a blocking reason only while this activation still holds the live claim. */
	async block(activation: ActivationType, reason: string): Promise<void> {
		await this.#transaction(async (tx) => {
			await this.#guard(tx, activation.claim, true);
			await tx`update utils_workflow.runs set state='blocked',reason=${reason},expires=null where namespace=${this.namespace} and id=${activation.ref.id}`;
		});
	}
	/** Validate live permission and persist the attempt result plus its next action in the same transaction. */
	async complete(
		job: JobType,
		outcome: OutcomeType,
		disposition: 'transient' | 'permanent' | 'unknown',
	): Promise<void> {
		await this.#transaction(async (tx) => {
			const { run, job: current } = await this.#guard(tx, job.claim);
			await this.#outcome(tx, run, current, OutcomeSchema.parse(outcome), disposition);
		});
	}
	/**
	 * The run lock serializes history accounting. Accepted job evidence survives even when replay history
	 * has no room.
	 */
	async #record(tx: Transaction, run: RunType, path: string, outcome: OutcomeType): Promise<boolean> {
		const bytes = new TextEncoder().encode(JSON.stringify(outcome)).byteLength;
		const history = await tx`select (
 (select coalesce(sum(bytes),0) from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id}) +
 (select coalesce(sum(bytes),0) from utils_workflow.events where namespace=${this.namespace} and run=${run.id}) +
 (select coalesce(sum(bytes),0) from utils_workflow.progress where namespace=${this.namespace} and run=${run.id})
 )::integer as bytes`;
		if (history[0]!.bytes + bytes > run.policy.limits.historyBytes) {
			await tx`update utils_workflow.runs set state='blocked',reason='history_limit',expires=null where namespace=${this.namespace} and id=${run.id}`;
			return false;
		}
		await tx`update utils_workflow.instructions set outcome=${
			tx.json(outcome)
		},bytes=bytes+${bytes} where namespace=${this.namespace} and run=${run.id} and path=${path} and outcome is null`;
		return true;
	}
	/**
	 * Completion and wake use the same run lock as admission. No waiting transition can overwrite an
	 * accepted wake.
	 */
	async #outcome(
		tx: Transaction,
		run: RunType,
		job: Record<string, unknown>,
		outcome: OutcomeType,
		disposition: 'transient' | 'permanent' | 'unknown',
	): Promise<void> {
		const rules = job.rules as AttemptType;
		await tx`update utils_workflow.attempts set state=${outcome.type},outcome=${
			tx.json(outcome)
		},ended=clock_timestamp() where namespace=${this.namespace} and job=${job.id as string} and generation=${job
			.generation as number}`;
		if (outcome.type !== 'success' && disposition === 'unknown') {
			await tx`update utils_workflow.jobs set state='blocked',outcome=${
				tx.json(outcome)
			},expires=null where namespace=${this.namespace} and id=${job.id as string}`;
			await tx`update utils_workflow.runs set state='blocked',reason='reconciliation' where namespace=${this.namespace} and id=${run.id}`;
			return;
		}
		if (
			outcome.type !== 'success' && disposition === 'transient' && rules.retry === 'transient' &&
			(job.sequence as number) < (job.budget as number)
		) {
			const delay = Math.min(
				rules.delay.maximumMs,
				rules.delay.initialMs * 2 ** Math.min(30, (job.sequence as number) - 1),
			);
			await tx`update utils_workflow.jobs set state='ready',outcome=${
				tx.json(outcome)
			},expires=null,available=clock_timestamp()+${delay}*interval '1 millisecond' where namespace=${this.namespace} and id=${job
				.id as string}`;
			return;
		}
		await tx`update utils_workflow.jobs set state=${outcome.type === 'success' ? 'completed' : 'failed'},outcome=${
			tx.json(outcome)
		},expires=null where namespace=${this.namespace} and id=${job.id as string}`;
		const cleanup =
			await tx`select * from utils_workflow.cleanups where namespace=${this.namespace} and run=${run.id} and job=${job
				.id as string}`;
		if (cleanup[0]) {
			await this.#cleanupDone(tx, run, cleanup[0].path as string, cleanup[0].scope as string | null, outcome);
			return;
		}
		if (job.finalizer) {
			if (outcome.type !== 'success') {
				await tx`update utils_workflow.runs set state='blocked',reason='finalizer_exhausted' where namespace=${this.namespace} and id=${run.id}`;
				return;
			}
			const intended = run.outcome!;
			await tx`update utils_workflow.runs set state=${
				intended.type === 'success' ? 'completed' : intended.type === 'cancelled' ? 'cancelled' : 'failed'
			},reason=null where namespace=${this.namespace} and id=${run.id}`;
			return;
		}
		if (run.kind === 'activity') {
			await this.#exit(tx, run, outcome);
			return;
		}
		if (!await this.#record(tx, run, job.path as string, outcome)) return;
		await tx`update utils_workflow.runs set state=case when state='advancing' then state else 'ready' end,expires=case when state='advancing' then expires else null end where namespace=${this.namespace} and id=${run.id}`;
	}
	/**
	 * Rebuild progress from saved rows after process loss. A live JS timer or notification is never required.
	 * First expire abandoned attempts, then wake workflow advances, due timers, and child waits.
	 * Retry only activities whose saved rules allow repetition; otherwise retain a blocked result for inspection.
	 */
	async recover(limit: number): Promise<void> {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
			throw new RangeError('Recovery limit must be 1..1000.');
		}
		// Filter inactive owners before the limit so retained history cannot starve live recovery.
		// Recheck each candidate while holding its run and job locks.
		const expired = await this
			.#database`select j.id,j.run from utils_workflow.jobs j join utils_workflow.runs r on r.namespace=j.namespace and r.id=j.run where j.namespace=${this.namespace} and j.state='claimed' and r.state in ('ready','waiting','advancing','settling')
 and (j.expires<=clock_timestamp() or j.deadline<=clock_timestamp() or not exists(select 1 from utils_workflow.hosts h where h.namespace=j.namespace and h.id=j.host and h.generation=j.host_generation and not h.draining and h.expires>clock_timestamp())) order by j.expires limit ${limit}`;
		for (const candidate of expired) {
			await this.#transaction(async (tx) => {
				const run = await this.#run(tx, candidate.run, true);
				const rows =
					await tx`select * from utils_workflow.jobs j where namespace=${this.namespace} and id=${candidate.id} and state='claimed' and (expires<=clock_timestamp() or deadline<=clock_timestamp() or not exists(select 1 from utils_workflow.hosts h where h.namespace=j.namespace and h.id=j.host and h.generation=j.host_generation and not h.draining and h.expires>clock_timestamp())) for update`;
				if (!rows[0] || !['ready', 'waiting', 'advancing', 'settling'].includes(run.state)) return;
				const job = rows[0];
				const rules = job.rules as AttemptType;
				await this.#outcome(tx, run, job, {
					type: 'fault',
					code: 'abandoned',
					message: 'Attempt lost its execution authority.',
				}, rules.recovery === 'retry' ? 'transient' : 'unknown');
				await tx`update utils_workflow.attempts set state='abandoned' where namespace=${this.namespace} and job=${job.id} and generation=${job.generation}`;
			});
		}
		await this.#transaction(async (tx) => {
			const rows =
				await tx`select * from utils_workflow.runs where namespace=${this.namespace} and state='advancing' and expires<=clock_timestamp() order by expires for update skip locked limit ${limit}`;
			for (const run of rows) {
				await tx`update utils_workflow.runs set state='ready',expires=null where namespace=${this.namespace} and id=${run.id}`;
			}
		});
		const waits = await this
			.#database`select i.run,i.path from utils_workflow.instructions i join utils_workflow.runs r on r.namespace=i.namespace and r.id=i.run where i.namespace=${this.namespace} and r.state in ('waiting','ready','advancing') and i.outcome is null and ((i.due is not null and i.due<=clock_timestamp()) or (i.child is not null and exists(select 1 from utils_workflow.runs c where c.namespace=i.namespace and c.id=i.child and c.state in ('completed','failed','cancelled')))) order by i.run,i.path limit ${limit}`;
		for (const wait of waits) {
			await this.#transaction(async (tx) => {
				const run = await this.#run(tx, wait.run, true);
				if (!['waiting', 'ready', 'advancing'].includes(run.state)) return;
				const rows =
					await tx`select * from utils_workflow.instructions where namespace=${this.namespace} and run=${run.id} and path=${wait.path} and outcome is null for update`;
				if (!rows[0]) return;
				const entry = rows[0];
				let outcome: OutcomeType;
				if (entry.child) {
					const child = await this.#run(tx, entry.child);
					if (!terminal.includes(child.state) || !child.outcome) return;
					outcome = child.outcome;
				} else {outcome = {
						type: 'success',
						value: encode(
							entry.type === 'wait-event' ? { type: 'timeout' } : (entry.due as Date).toISOString(),
							run.policy.limits.resultBytes,
						),
					};}
				if (!await this.#record(tx, run, entry.path, outcome)) return;
				await tx`update utils_workflow.runs set state=case when state='advancing' then state else 'ready' end,expires=case when state='advancing' then expires else null end where namespace=${this.namespace} and id=${run.id}`;
			});
		}
		// Child cleanup has its own run. Observe it without holding child and parent locks together.
		const cleanups = await this
			.#database`select c.run,c.path,c.scope,c.child from utils_workflow.cleanups c
 join utils_workflow.runs r on r.namespace=c.namespace and r.id=c.child
 join utils_workflow.runs p on p.namespace=c.namespace and p.id=c.run
 where c.namespace=${this.namespace} and c.state='running' and p.state in ('ready','waiting','advancing','settling')
 and (r.state in ('completed','failed','cancelled') or (r.state='blocked' and p.reason is distinct from 'cleanup_child_blocked'))
 order by c.ordinal,c.run,c.path limit ${limit}`;
		for (const cleanup of cleanups) {
			await this.#transaction(async (tx) => {
				const run = await this.#run(tx, cleanup.run as string, true);
				if (!['ready', 'waiting', 'advancing', 'settling'].includes(run.state)) return;
				const rows =
					await tx`select state from utils_workflow.cleanups where namespace=${this.namespace} and run=${run.id} and path=${cleanup
						.path as string} for update`;
				if (rows[0]?.state !== 'running') return;
				const child = await this.#run(tx, cleanup.child as string);
				if (child.state === 'blocked') {
					// The child owns its repair budget. Leave the parent waiting, with a diagnostic reason.
					if (run.reason !== 'cleanup_child_blocked') {
						await tx`update utils_workflow.runs set reason='cleanup_child_blocked' where namespace=${this.namespace} and id=${run.id}`;
					}
					return;
				}
				// A child can be repaired between discovery and this read; wait for its new terminal result.
				if (!terminal.includes(child.state) || child.outcome === null) return;
				await this.#cleanupDone(tx, run, cleanup.path as string, cleanup.scope as string | null, child.outcome!);
			});
		}
		const children = await this
			.#database`select c.* from utils_workflow.runs c join utils_workflow.runs p on p.namespace=c.namespace and p.id=c.parent where c.namespace=${this.namespace} and c.cancellation in ('follow-parent','request') and (p.outcome->>'type'='cancelled' or exists(select 1 from utils_workflow.instructions i where i.namespace=c.namespace and i.child=c.id and (i.outcome->>'type'='cancelled' or (p.outcome is not null and i.outcome is null and not i.discard)))) and c.state not in ('completed','failed','cancelled','continued','settling') limit ${limit}`;
		for (const child of children) await this.cancel(this.#ref(RunSchema.parse(child)), 'Parent cancelled.');
	}
	/** Pause future admissions without revoking already granted execution permission. */
	pause(ref: ReferenceType, options: ControlOptions): Promise<ControlType> {
		return this.#control(ref, options, true);
	}
	/** Resume future admissions; blocked repair requirements remain unchanged. */
	resume(ref: ReferenceType, options: ControlOptions): Promise<ControlType> {
		return this.#control(ref, options, false);
	}
	/**
	 * Compare the inspected revision under the run lock and save operator attribution with an actual
	 * pause/resume change.
	 */
	async #control(ref: ReferenceType, input: ControlOptions, paused: boolean): Promise<ControlType> {
		this.#reference(ref);
		const options = ControlOptionsSchema.parse(input);
		return await this.#transaction(async (tx) => {
			const run = await this.#run(tx, ref.id, true);
			this.#matches(run, ref);
			if (run.control.revision !== options.revision) throw new ExecutionError('control_conflict');
			if (run.outcome !== null || terminal.includes(run.state)) throw new ExecutionError('control_closed');
			if (run.control.paused === paused) return run.control;
			const revision = run.control.revision + 1;
			await tx`update utils_workflow.runs set paused=${paused},control_revision=${revision} where namespace=${this.namespace} and id=${run.id}`;
			await tx`insert into utils_workflow.audit(namespace,id,run,epoch,actor,reason,action)
 values(${this.namespace},${crypto.randomUUID()},${run.id},${run.epoch},${options.actor},${options.reason},${
				paused ? 'pause' : 'resume'
			})`;
			return { paused, revision };
		});
	}
	/** Preserve every member until the whole terminal family has outlived all promised retention windows. */
	async prune(options: { readonly limit: number }): Promise<PruneResult> {
		if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
			throw new RangeError('Pruning limit must be 1..1000 total rows.');
		}
		return await this.#transaction(async (tx) => {
			let deleted = 0, runs = 0, families = 0;
			const eligible = () =>
				tx`r.namespace=${this.namespace} and r.id=r.family
 and r.state in ('completed','failed','cancelled','continued') and r.finished_at<=clock_timestamp()
 and not exists(select 1 from utils_workflow.runs m where m.namespace=r.namespace and m.family=r.id
  and (m.state not in ('completed','failed','cancelled','continued') or m.finished_at is null
   or extract(epoch from (clock_timestamp()-m.finished_at))*1000 < greatest(
    (m.policy->'retention'->>'dedupeMs')::numeric,(m.policy->'retention'->>'resultsMs')::numeric,(m.policy->'retention'->>'auditMs')::numeric)))`;
			// Bound discovery as well as deletions; a family can resume across many small maintenance calls.
			for (let examined = 0; examined < 32 && deleted < options.limit; examined++) {
				const roots = await tx`select r.id from utils_workflow.runs r where ${eligible()}
 order by r.finished_at,r.id for update of r skip locked limit 1`;
				if (!roots[0]) break;
				const family = roots[0].id as string;
				// Identifiers are fixed here. Delete referencing rows before their jobs/runs.
				for (
					const table of [
						'progress',
						'receipts',
						'attempts',
						'instructions',
						'cleanups',
						'events',
						'audit',
						'run_events',
						'jobs',
					] as const
				) {
					if (deleted === options.limit) break;
					const belongs = table === 'receipts' || table === 'attempts'
						? tx`exists(select 1 from utils_workflow.jobs j join utils_workflow.runs m on m.namespace=j.namespace and m.id=j.run where j.namespace=x.namespace and j.id=x.job and m.family=${family})`
						: tx`exists(select 1 from utils_workflow.runs m where m.namespace=x.namespace and m.id=x.run and m.family=${family})`;
					const removed = await tx`delete from ${
						tx(`utils_workflow.${table}`)
					} d where d.namespace=${this.namespace} and d.ctid in (
 select x.ctid from ${tx(`utils_workflow.${table}`)} x where x.namespace=${this.namespace} and ${belongs}
 order by x.ctid limit ${options.limit - deleted}) returning 1`;
					deleted += removed.length;
				}
				if (deleted === options.limit) break;
				// The root remains discoverable until every other family run has been removed.
				const removed = await tx`delete from utils_workflow.runs where namespace=${this.namespace} and id in (
 select id from utils_workflow.runs where namespace=${this.namespace} and family=${family}
 order by (id=family),id limit ${options.limit - deleted}) returning id`;
				deleted += removed.length;
				runs += removed.length;
				if (removed.some((row) => row.id === family)) families++;
			}
			const remaining = await tx`select exists(select 1 from utils_workflow.runs r where ${eligible()}) as more`;
			return { deleted, runs, families, more: remaining[0]!.more as boolean };
		});
	}
	/**
	 * Record a cancellation request only while the run can still change its intended outcome. Already
	 * settling or continued work reports too_late.
	 */
	async cancel(ref: ReferenceType, reason: string): Promise<'requested' | 'too_late'> {
		this.#reference(ref);
		return await this.#transaction(async (tx) => {
			const run = await this.#run(tx, ref.id, true);
			this.#matches(run, ref);
			if (
				run.state === 'settling' || terminal.includes(run.state) || run.outcome !== null || run.continuation !== null
			) return 'too_late';
			const outcome: OutcomeType = { type: 'cancelled', reason: reason.slice(0, 2048) };
			await tx`update utils_workflow.attempts a set state='cancelled',outcome=${
				tx.json(outcome)
			},ended=clock_timestamp()
 where a.namespace=${this.namespace} and a.state='started' and exists(select 1 from utils_workflow.jobs j
 where j.namespace=a.namespace and j.id=a.job and j.run=${run.id} and not j.finalizer)`;
			await tx`update utils_workflow.jobs set state='failed',outcome=${
				tx.json(outcome)
			},generation=generation+1,expires=null where namespace=${this.namespace} and run=${run.id} and not finalizer and state in ('ready','claimed','blocked')`;
			await this.#exit(tx, run, outcome);
			return 'requested';
		});
	}
	/**
	 * Grant bounded extra attempts at an inspected recovery epoch; preserve pinned history limits and
	 * evidence that needs reconciliation.
	 */
	async repair(
		ref: ReferenceType,
		options: { readonly actor: string; readonly reason: string; readonly epoch: number; readonly attempts: number },
	): Promise<void> {
		this.#reference(ref);
		if (
			!options.actor.trim() || options.actor.length > 256 || !options.reason.trim() || options.reason.length > 2048 ||
			!Number.isSafeInteger(options.attempts) ||
			options.attempts < 1 || options.attempts > 1000
		) throw new ExecutionError('repair_input');
		await this.#transaction(async (tx) => {
			const run = await this.#run(tx, ref.id, true);
			this.#matches(run, ref);
			if (run.state !== 'blocked' || run.epoch !== options.epoch) throw new ExecutionError('repair_conflict');
			if (run.reason === 'history_limit' || run.reason === 'continuation_limit') {
				throw new ExecutionError('repair_policy', 'A pinned execution bound cannot be increased by granting attempts.');
			}
			const failedChildCleanup =
				await tx`select path from utils_workflow.cleanups where namespace=${this.namespace} and run=${run.id} and state='failed' and child is not null limit 1`;
			if (failedChildCleanup.length) {
				throw new ExecutionError(
					'repair_policy',
					'A terminal failed child cleanup needs explicit reconciliation; granting local attempts cannot replace it.',
				);
			}
			const jobs =
				await tx`select * from utils_workflow.jobs where namespace=${this.namespace} and run=${run.id} and state in ('blocked','failed') order by finalizer desc,id for update`;
			await tx`insert into utils_workflow.audit(namespace,id,run,epoch,actor,reason,action) values (${this.namespace},${crypto.randomUUID()},${run.id},${
				run.epoch + 1
			},${options.actor},${options.reason},'repair')`;
			if (jobs[0]) {
				const job = jobs[0];
				await tx`update utils_workflow.jobs set state='ready',budget=sequence+${options.attempts},generation=generation+1,available=clock_timestamp(),expires=null where namespace=${this.namespace} and id=${job.id}`;
			}
			await tx`update utils_workflow.runs set epoch=epoch+1,generation=generation+1,state=${
				jobs[0]?.finalizer && (run.outcome !== null || run.continuation !== null)
					? 'settling'
					: jobs[0]
					? 'waiting'
					: 'ready'
			},reason=null,expires=null where namespace=${this.namespace} and id=${run.id}`;
		});
	}
	/** Validate current attempt permission before looking up a committed write result for retry reconciliation. */
	async getReceipt<Input, Value>(
		claim: Claim | undefined,
		options: WriteOptions<Input, Value>,
	): Promise<ReceiptType<Value> | undefined> {
		return await this.#transaction(async (tx) => {
			await this.#guard(tx, claim);
			const prior = await this.#receipt(tx, claim!, options);
			if (prior !== undefined) this.#instrument.notice('postgres.workflow.receipt.reused', { job_id: claim?.jobId });
			return prior;
		});
	}
	/**
	 * Read the saved result for this job and write key.
	 * A matching key is not enough: the input and contract must also match.
	 * When saving again, `expected` checks that the result did not change either.
	 * Reject a conflict before returning a value through the application decoder.
	 */
	async #receipt<Input, Value>(
		tx: Transaction,
		claim: Claim,
		options: WriteOptions<Input, Value>,
		expected?: ReturnType<typeof encode>,
	): Promise<ReceiptType<Value> | undefined> {
		if (!options.key.trim() || options.key.length > 512) throw new ExecutionError('receipt_key');
		const digest = await fingerprint(options.input);
		const rows =
			await tx`select * from utils_workflow.receipts where namespace=${this.namespace} and job=${claim.jobId} and key=${options.key}`;
		if (!rows[0]) return;
		if (rows[0].fingerprint !== digest || rows[0].contract !== (options.contract ?? options.key)) {
			throw new ExecutionError('receipt_conflict');
		}
		const wire = decode(rows[0].value as ReturnType<typeof encode>);
		// Check the persisted representation and budget before applying its application decoder.
		encode(wire, 16_777_216);
		if (expected !== undefined && await fingerprint(wire) !== await fingerprint(decode(expected))) {
			throw new ExecutionError('receipt_conflict');
		}
		return Object.freeze({ value: await codec.read(options.result, wire) });
	}
	/**
	 * Record the duration and outcome of a guarded write, including rollback on failure.
	 * Telemetry observes the write; the transaction remains the source of its result.
	 */
	async transaction<Input, Value>(
		claim: Claim | undefined,
		options: WriteOptions<Input, Value>,
		callback: (tx: Transaction, receipt: Receipt<Value>) => Promise<ReceiptType<Value>>,
	): Promise<ReceiptType<Value>> {
		codec.output(options.result);
		return await this.#instrument.span(
			'postgres.workflow.write',
			{ job_id: claim?.jobId },
			() => this.#write(claim, options, callback),
		);
	}

	/**
	 * Keep the application write and its receipt in one transaction.
	 * First lock and check the claim. Then run the callback and finish every receipt
	 * operation it started. Only a receipt issued here may be returned for commit.
	 * A receipt operation that fails makes the write fail even if the callback caught it.
	 */
	async #write<Input, Value>(
		claim: Claim | undefined,
		options: WriteOptions<Input, Value>,
		callback: (tx: Transaction, receipt: Receipt<Value>) => Promise<ReceiptType<Value>>,
	): Promise<ReceiptType<Value>> {
		return await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, claim);
			const write = { ...options, input: decode(encode(options.input, run.policy.limits.inputBytes)) };
			// Track issued objects, not matching shapes: a caller cannot fabricate proof of a saved write.
			const receipts = new WeakSet<ReceiptType<Value>>();
			let active = true;
			let pending = Promise.resolve();
			let failed: { readonly reason: unknown } | undefined;
			/**
			 * Queue receipt operations on this transaction's single connection.
			 * Keep the first failure so a later operation cannot hide it. The queue tail
			 * settles without rejecting; the callback exit checks that saved failure.
			 * Once the callback exits, reject new operations but finish those already queued.
			 */
			const admit = <Result>(operation: () => Promise<Result>): Promise<Result> => {
				if (!active) return Promise.reject(new ExecutionError('receipt_closed'));
				const result = pending.then(() => {
					if (failed !== undefined) throw failed.reason;
					return operation();
				});
				pending = result.then(() => {}, (reason) => {
					failed ??= { reason };
				});
				return result;
			};
			const receipt: Receipt<Value> = Object.freeze({
				get: () =>
					admit(async () => {
						const prior = await this.#receipt(tx, claim!, write);
						if (prior !== undefined) {
							this.#instrument.notice('postgres.workflow.receipt.reused', { job_id: claim?.jobId });
							receipts.add(prior);
						}
						return prior;
					}),
				save: (input: Value) =>
					admit(async () => {
						const wire = await codec.write(write.result, input);
						const encoded = encode(wire, run.policy.limits.resultBytes);
						const previous = await this.#receipt(tx, claim!, write, encoded);
						if (previous !== undefined) {
							receipts.add(previous);
							return previous;
						}
						await tx`insert into utils_workflow.receipts(namespace,job,key,contract,fingerprint,value) values (${this.namespace},${
							claim!.jobId
						},${write.key},${write.contract ?? write.key},${await fingerprint(write.input)},${tx.json(encoded)})`;
						const saved = Object.freeze({ value: await codec.read(write.result, decode(encoded)) });
						receipts.add(saved);
						return saved;
					}),
			});
			let result: ReceiptType<Value>;
			try {
				result = await callback(tx, receipt);
			} finally {
				// Close admission before waiting, so retained receipt methods cannot extend the transaction.
				active = false;
				// Encoders and decoders are allowed to suspend. Even a dropped save()
				// promise must finish while this exact transaction still owns its SQL.
				await pending;
			}
			if (failed !== undefined) throw failed.reason;
			// Only get() or save() on this receipt can supply the callback result.
			if (!receipts.has(result)) throw new ExecutionError('receipt_return');
			return result;
		});
	}
}

/**
 * Count the finite follow-up work promised by a root command before accepting that command.
 * Add each permitted child's worst-case descendants. For alternative successors, use the largest cost per category.
 * This reserves enough space for already promised work even when new root commands fill their own queue limit.
 * Reject cycles because an unbounded promise cannot fit a finite reservation.
 */
function reserve(
	policy: PolicyType,
	definition: IdentityType,
	ancestors = new Set<string>(),
): { successors: number; children: number; finalizers: number } {
	const key = address(definition);
	if (ancestors.has(key)) throw new ExecutionError('reservation_cycle');
	const next = new Set(ancestors).add(key);
	const result = {
		successors: 0,
		children: 0,
		finalizers: policy.finalizers.some((entry) => entry.roots.some((root) => address(root) === key)) ||
				policy.workflows.some((entry) =>
					address(entry.definition) === key && entry.requires.includes('workflow.cleanup')
				)
			? 1
			: 0,
	};
	const children = policy.workflows.find((entry) => address(entry.definition) === key)?.children ?? [];
	for (const child of children) {
		const cost = reserve(policy, child.definition, next);
		result.children += child.maximum * (1 + cost.children);
		result.successors += child.maximum * cost.successors;
		result.finalizers += child.maximum * cost.finalizers;
	}
	const successor = policy.successors.find((entry) => address(entry.from) === key);
	if (successor) {
		const choices = successor.choices.map((choice) => reserve(policy, choice, next));
		result.successors += successor.maximum * (1 + Math.max(...choices.map((entry) => entry.successors)));
		result.children += successor.maximum * Math.max(...choices.map((entry) => entry.children));
		result.finalizers += successor.maximum * Math.max(...choices.map((entry) => entry.finalizers));
	}
	return ancestors.size === 0 ? continuation.reservation(policy, definition, result) : result;
}
