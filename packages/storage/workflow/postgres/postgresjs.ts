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
import * as sql from '@okikio/sql';
import { executor } from '@okikio/sql/postgres';
import { temporal } from '@okikio/duration/temporal';
import type { Temporal } from '@okikio/duration/temporal';
import * as tables from './schema/mod.ts';
import type { Executor, Statement } from '@okikio/sql';
import { cleanups, history, hosts, jobs, maintenance, runs, shared } from './statements/mod.ts';
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
/** One executor per native pool or transaction, so statements run on exactly that connection. */
const executors = new WeakMap<object, Executor>();

/** The `@okikio/sql` executor of a native Postgres.js pool or transaction. */
function on(native: Sql | TransactionSql): Executor {
	let found = executors.get(native);
	if (found === undefined) executors.set(native, found = executor(native));
	return found;
}

/** Run a statement and decode its rows. */
function rows<Row>(native: Sql | TransactionSql, statement: Statement<Row>): Promise<Row[]> {
	return sql.rows(on(native), statement);
}

/** Run a statement and return its one row, if any. */
function one<Row>(native: Sql | TransactionSql, statement: Statement<Row>): Promise<Row | undefined> {
	return sql.one(on(native), statement);
}

/** Run a statement and ignore its rows. */
function exec(native: Sql | TransactionSql, statement: Statement<unknown>): Promise<void> {
	return sql.execute(on(native), statement);
}

/** A saved time in the ISO form `Date.toISOString` writes, which replayed workflow code already received. */
function iso(instant: Temporal.Instant): string {
	return instant.toString({ fractionalSecondDigits: 3, roundingMode: 'trunc' });
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
	return await options.database.begin('isolation level repeatable read read only', async (native) => {
		const tx = executor(native);
		const present = (await sql.one(tx, tables.present))!;
		let current: number | undefined;
		if (present.version) {
			current = (await sql.one(tx, tables.stored))?.version;
			if (current === undefined || current < 1) {
				return Object.freeze({
					current,
					target: tables.revision,
					state: 'incompatible' as const,
					activeWorkers: false,
				});
			}
		}
		const active = present.hosts ? await sql.rows(tx, tables.activeHost) : [];
		return Object.freeze({
			current,
			target: tables.revision,
			state: current === undefined
				? 'uninstalled' as const
				: current === tables.revision
				? 'current' as const
				: current < tables.revision
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
	await options.database.begin(async (native) => {
		const tx = executor(native);
		await sql.execute(tx, tables.migrationLock);
		const present = (await sql.one(tx, tables.present))!;
		if (present.version) {
			const current = (await sql.one(tx, tables.stored))?.version;
			if (current === undefined || current < 1 || current > tables.revision) throw new ExecutionError('schema_version');
			if (current === tables.revision) return;
		}
		if (present.hosts && (await sql.rows(tx, tables.activeHost)).length) {
			throw new ExecutionError('migration_workers_active', 'Drain workers before upgrading the execution schema.');
		}
		// Registration shares the migration lock. Old workers and unrelated database readers still need operational draining.
		await sql.execute(tx, tables.lockTimeout);
		for (const statement of [...tables.prepare, ...tables.install]) await sql.execute(tx, statement);
		if ((await sql.one(tx, tables.stored))?.version !== tables.revision) throw new ExecutionError('schema_version');
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
/** One saved job, decoded with the column types. */
type JobRow = sql.RowOf<typeof tables.jobs.columns>;
/** Required order: registration share lock, run update lock, job update lock, then application domain locks. */
type GuardType = { run: RunType; job: JobRow | undefined };
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
		const found = (await one(this.#database, maintenance.next(this.namespace, options)))!;
		if (found.due === null) return undefined;
		// Round up to whole milliseconds, never below zero, as the deadline's distance from database time.
		const distance = Number(found.due.epochNanoseconds - found.now.epochNanoseconds) / 1_000_000;
		return Math.max(0, Math.ceil(distance));
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
			for (const statement of shared.limits()) await exec(tx, statement);
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
		const found = await one(tx, runs.run(this.namespace, id, lock));
		if (!found) throw new ExecutionError('not_found');
		return RunSchema.parse(found);
	}
	/**
	 * Read the installed revision and required schema features before declaring this store ready. No
	 * migration runs implicitly.
	 */
	async check(signal?: AbortSignal): Promise<void> {
		this.#assert();
		signal?.throwIfAborted();
		// Refuse a partially installed or incompatible schema before accepting worker readiness: the revision must match
		// and every column this revision defines must exist with its type.
		const tx = executor(this.#database);
		const stored = await sql.one(tx, tables.stored, { signal }).catch((error) => {
			signal?.throwIfAborted();
			if ((error as { code?: unknown }).code === '42P01') return undefined;
			throw error;
		});
		const found = new Set(
			(await sql.rows(tx, tables.installed, { signal })).map((item) => `${item.table}.${item.column} ${item.type}`),
		);
		signal?.throwIfAborted();
		if (stored?.version !== tables.revision || [...tables.expected].some((item) => !found.has(item))) {
			throw new ExecutionError('schema_version');
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
		await exec(tx, shared.named(this.namespace, shared.keys.admission));
		const found = await one(
			tx,
			runs.keyed(this.namespace, { scope: input.scope, kind: contract.kind, definition: contract.id, key: input.key }),
		);
		if (found) {
			if (
				found.fingerprint !== digest ||
				await fingerprint(found.location ?? null) !== await fingerprint(location ?? null) ||
				found.version !== contract.version ||
				found.policyhash !== policyhash || (parent !== undefined && found.family !== parent.family)
			) throw new ExecutionError('admission_conflict');
			return this.#ref(RunSchema.parse(found));
		}
		const reservation = reserve(policy, contract);
		if (!parent) {
			// Charge a family's root reservation once while any member is live, including after root completion.
			const current = (await one(tx, runs.usage(this.namespace, policy)))!;
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
			await exec(tx, runs.addSuccessor(this.namespace, parent.id));
		} else {
			const owner = policy.workflows.find((entry) =>
				entry.definition.id === parent.definition && entry.definition.version === parent.version
			);
			const allowed = owner?.children.find((entry) => address(entry.definition) === address(contract));
			const prior = (await one(tx, runs.children(this.namespace, parent.id, contract)))!.count;
			if (!owner || !allowed || parent.children >= owner.maximumChildren || prior >= allowed.maximum) {
				throw new ExecutionError('child_capacity');
			}
			await exec(tx, runs.addChild(this.namespace, parent.id));
		}
		const id = crypto.randomUUID();
		await exec(
			tx,
			runs.admit({
				namespace: this.namespace,
				id,
				scope: input.scope,
				key: input.key,
				kind: contract.kind,
				definition: contract.id,
				version: contract.version,
				input: input.input,
				fingerprint: digest,
				policy,
				policyhash,
				state: contract.kind === 'workflow' ? 'ready' : 'waiting',
				family: parent?.family ?? id,
				parent: parent?.id ?? null,
				cancellation: cancellation ?? 'independent',
				reservation,
				trace: telemetry.saved(input.trace) ?? this.#instrument.capture() ?? parent?.trace ?? null,
				location: location ?? null,
			}),
		);
		const saved = await this.#run(tx, id);
		if (contract.kind === 'activity') {
			await this.#job(
				tx,
				saved,
				'root',
				contract,
				input.input,
				policy.activities.find((entry) => address(entry.definition) === address(contract))!,
			);
		}
		return this.#ref(saved);
	}
	/**
	 * Read a saved run and bounded progress observations after checking its exact reference. Intended
	 * success can precede required finalization.
	 */
	async get(ref: ReferenceType, options: { readonly children?: boolean } = {}): Promise<SnapshotType> {
		this.#reference(ref);
		const run = await this.#run(this.#database, ref.id);
		this.#matches(run, ref);
		const reports = await rows(this.#database, history.reports(this.namespace, run, options.children ?? false));
		return Object.freeze({
			ref: this.#ref(run),
			state: run.state,
			control: run.control,
			...(run.continued_to === null ? {} : { continuedTo: this.#ref({ ...run, id: run.continued_to }) }),
			progressTruncated: reports.length > 1000,
			progress: reports.slice(0, 1000).map((row) => {
				const occurrence = decode(row.occurrence as ReturnType<typeof encode>) as EffectEncoded;
				return {
					job: row.job,
					attempt: row.attempt,
					revision: row.revision,
					effect: occurrence,
					progress: occurrence.value,
					operation: row.path,
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
			const old = await one(tx, history.report(this.namespace, run.id, claim.jobId, occurrence.id));
			if (old && old.generation === claim.generation && old.sequence >= sequence) return;
			const saved = encode(occurrence, run.policy.limits.resultBytes);
			const bytes = new TextEncoder().encode(JSON.stringify(saved)).byteLength + occurrence.id.length * 3 + 128;
			await this.#budget(tx, run, bytes - (old?.bytes ?? 0));
			await exec(
				tx,
				history.saveReport({
					namespace: this.namespace,
					run: run.id,
					job: claim.jobId,
					effect: occurrence.id,
					generation: claim.generation,
					sequence,
					attempt: claim.sequence,
					revision: crypto.randomUUID(),
					occurrence: saved,
					bytes,
				}),
			);
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
			const old = await one(tx, history.event(this.namespace, run.id, event, key));
			if (old) {
				if (old.fingerprint !== hash) throw new ExecutionError('event_conflict');
				return;
			}
			if (
				run.outcome !== null || run.continuation !== null || run.state === 'blocked' || terminal.includes(run.state)
			) throw new ExecutionError('event_closed');
			const wait = await one(tx, history.waiting(this.namespace, run.id, event, key));
			if (wait && (wait.outcome !== null || wait.expired)) throw new ExecutionError('event_closed');
			const bytes = new TextEncoder().encode(JSON.stringify(checked)).byteLength + event.length * 3 + key.length * 3 +
				128;
			await this.#budget(tx, run, bytes);
			await exec(
				tx,
				history.deliver({
					namespace: this.namespace,
					run: run.id,
					event,
					key,
					value: checked,
					fingerprint: hash,
					bytes,
				}),
			);
			if (wait) {
				const outcome: OutcomeType = {
					type: 'success',
					value: encode({ type: 'received', value: decode(checked) }, run.policy.limits.resultBytes),
				};
				if (await this.#record(tx, run, wait.path, outcome)) await exec(tx, runs.wake(this.namespace, run.id));
			}
		});
	}
	/** All retained event and report data shares the run's explicit history budget. */
	async #budget(tx: Transaction, run: RunType, additional: number): Promise<void> {
		const used = (await one(tx, shared.history(this.namespace, run.id)))!.bytes;
		if (used + additional > run.policy.limits.historyBytes) throw new ExecutionError('history_limit');
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
			await exec(tx, tables.registrationLock);
			if ((await one(tx, tables.stored))?.version !== tables.revision) {
				throw new ExecutionError('schema_version');
			}
			await this.#placementLock(tx);
			for (const node of lineage) {
				const saved = await one(tx, hosts.node(this.namespace, node.id));
				if (
					saved &&
					(saved.generation > node.generation ||
						(saved.generation === node.generation && await fingerprint(saved.value) !== await fingerprint(node)))
				) {
					throw new ExecutionError('compute_conflict');
				}
				await exec(tx, hosts.saveNode(this.namespace, { id: node.id, generation: node.generation, value: node }));
			}
			const registered = await one(
				tx,
				hosts.register({
					namespace: this.namespace,
					id,
					definitions: [...definitions],
					engine,
					activations: capacity.activations,
					activities: capacity.activities,
					lease: leaseMs,
					compute: [...lineage],
					affinity,
				}),
			);
			return Object.freeze({ id, generation: registered!.generation });
		});
	}
	/**
	 * Lock ancestors before the live host generation, then let the caller lock its run and job.
	 * Renewal requests an update lock immediately: two shared locks cannot safely upgrade together.
	 * Ordinary guarded operations keep a shared lock so independent attempts can run concurrently.
	 */
	async #host(tx: Native, host: HostType, mode: 'share' | 'update' = 'share'): Promise<void> {
		const path = await one(tx, hosts.lineage(this.namespace, host));
		if (!path) throw new ExecutionError('stale_claim');
		// Lock ancestors root first, before the host row, matching registration lock order.
		for (const node of path.compute as placement.BoundaryType[]) {
			const current = await one(tx, hosts.nodeShare(this.namespace, node.id));
			if (current?.generation !== node.generation) throw new ExecutionError('stale_claim');
		}
		if ((await rows(tx, hosts.guard(this.namespace, host, mode))).length !== 1) throw new ExecutionError('stale_claim');
	}
	/** Serialize shared ancestor admission and topology replacement in this namespace. */
	async #placementLock(tx: Transaction): Promise<void> {
		await exec(tx, shared.named(this.namespace, shared.keys.placement));
	}
	/** Check this worker's free slots one at a time. Release the slot-check lock before running activity code. */
	async #capacity(tx: Transaction, host: HostType): Promise<void> {
		await exec(tx, shared.named(JSON.stringify([this.namespace, host.id]), shared.keys.capacity));
	}
	/**
	 * Extend a live host registration, using the database clock.
	 * The generation check rejects a replaced host. Expiry cannot be undone by renewal.
	 * Renew this registration before renewing the attempts that depend on it.
	 */
	async renewHost(host: HostType, leaseMs: number): Promise<void> {
		await this.#transaction(async (tx) => {
			await this.#host(tx, host, 'update');
			await exec(tx, hosts.renew(this.namespace, host, leaseMs));
		});
	}
	/** Stop admission for this generation only; an older host cannot drain its replacement. */
	async leave(host: HostType): Promise<void> {
		await exec(this.#database, hosts.drain(this.namespace, host));
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
			const capacity = (await one(tx, runs.activations(this.namespace, host.id)))!;
			if (capacity.active >= capacity.limit) return;
			const found = await one(tx, runs.ready(this.namespace, [...definitions]));
			if (!found) return;
			const run = RunSchema.parse(found);
			if (!definitions.some((entry) => address(entry) === address(this.#ref(run).definition))) {
				await exec(tx, runs.block(this.namespace, run.id, 'missing_version'));
				return;
			}
			const generation = run.generation + 1;
			await exec(
				tx,
				runs.advance(this.namespace, run.id, {
					generation,
					host: host.id,
					hostGeneration: host.generation,
					lease: run.policy.claims.leaseMs,
				}),
			);
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
			const capacity = (await one(tx, jobs.slots(this.namespace, host.id)))!;
			if (capacity.active >= capacity.limit) return;
			const registered = (await one(tx, hosts.placement(this.namespace, host.id)))!;
			const lineage = registered.compute as placement.BoundaryType[];
			for (const node of lineage) {
				if (node.capacity === undefined) continue;
				const occupied = (await one(tx, jobs.occupied(this.namespace, { id: node.id, generation: node.generation })))!;
				if (occupied.active >= node.capacity) return;
			}
			// Exclude locked owners before the bounded scan, then take each job under its owner lock.
			const candidates = await rows(
				tx,
				jobs.candidates(this.namespace, {
					definitions: [...definitions],
					lineage,
					affinity: registered.affinity,
					...(finalizer === undefined ? {} : { finalizer }),
				}),
			);
			for (const candidate of candidates) {
				const locked = await one(tx, runs.run(this.namespace, candidate.run).for({ skipLocked: true }));
				if (!locked) continue;
				const run = RunSchema.parse(locked);
				const job = await one(tx, jobs.due(this.namespace, candidate.id));
				if (
					!job || !['waiting', 'ready', 'advancing', 'settling'].includes(run.state) ||
					(run.control.paused && !job.finalizer)
				) continue;
				const originPath = job.path.startsWith('cleanup:') ? job.path.slice(8) : job.path;
				// A job's admission fingerprint is its instruction's, or the run's own for a root activity.
				const origin = await one(tx, history.instruction(this.namespace, run.id, originPath));
				const admission = origin?.fingerprint ?? (await one(tx, runs.run(this.namespace, run.id)))!.fingerprint;
				const rules = job.rules as AttemptType;
				const generation = job.generation + 1;
				const sequence = job.sequence + 1;
				await exec(
					tx,
					jobs.claim(this.namespace, job.id, {
						generation,
						sequence,
						host: host.id,
						hostGeneration: host.generation,
						lease: run.policy.claims.leaseMs,
						deadline: rules.deadlineMs,
					}),
				);
				await exec(tx, jobs.start(this.namespace, job.id, generation, sequence));
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
					path: job.path,
					fingerprint: admission,
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
			const valid = await one(
				tx,
				runs.activation(this.namespace, run.id, {
					generation: claim.generation,
					host: claim.hostId,
					hostGeneration: claim.hostGeneration,
				}),
			);
			if (!valid) throw new ExecutionError('stale_claim');
			return { run, job: undefined };
		}
		const job = await one(
			tx,
			jobs.guard(this.namespace, {
				job: claim.jobId,
				run: run.id,
				generation: claim.generation,
				host: claim.hostId,
				hostGeneration: claim.hostGeneration,
			}),
		);
		if (!job || (run.state === 'settling' && !job.finalizer)) throw new ExecutionError('stale_claim');
		return { run, job };
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
				await exec(tx, runs.extend(this.namespace, run.id, run.policy.claims.leaseMs));
			} else {
				await exec(tx, jobs.extend(this.namespace, claim.jobId, run.policy.claims.leaseMs));
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
		await exec(
			tx,
			jobs.add({
				namespace: this.namespace,
				id,
				run: run.id,
				path,
				definition,
				input,
				rules,
				state: 'ready',
				budget: rules.maxAttempts,
				finalizer,
				location: placement.intersect(run.location, selection) ?? null,
				affinity: affinity ?? null,
			}),
		);
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
			const found = await one(tx, history.instruction(this.namespace, run.id, intent.path));
			if (found) {
				if (found.fingerprint !== intent.fingerprint) throw new ExecutionError('replay_conflict');
				if (found.outcome !== null) return OutcomeSchema.parse(found.outcome);
				if (options.park) await exec(tx, runs.rest(this.namespace, run.id, 'waiting'));
				return;
			}
			const rule = run.policy.workflows.find((entry) =>
				address(entry.definition) === address(this.#ref(run).definition)
			);
			const count = (await one(tx, history.count(this.namespace, run.id)))!.count;
			if (rule && count >= rule.maxInstructions) throw new ExecutionError('instruction_limit');
			let bytes = new TextEncoder().encode(JSON.stringify(intent)).byteLength;
			const used = (await one(tx, shared.history(this.namespace, run.id)))!.bytes;
			if (used + bytes > run.policy.limits.historyBytes) throw new ExecutionError('history_limit');
			// A sleep's due time comes from the database clock; other timers carry a saved ISO time.
			const due = intent.type === 'sleep' ? iso((await one(tx, shared.later(intent.delay!)))!.at) : intent.due;
			let job: string | null = null;
			let child: string | null = null;
			let outcome: OutcomeType | null = null;
			if (intent.type === 'defer') {
				if (!intent.cleanup || !['activity', 'child-workflow'].includes(intent.cleanup.type)) {
					throw new ExecutionError('cleanup_binding');
				}
				if (!rule?.requires.includes('workflow.cleanup')) throw new ExecutionError('cleanup_policy');
				await exec(
					tx,
					cleanups.defer({
						namespace: this.namespace,
						run: run.id,
						path: intent.path,
						scope: intent.parent ?? null,
						request: encode(intent.cleanup, run.policy.limits.historyBytes),
					}),
				);
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
				const other = await one(tx, history.waiting(this.namespace, run.id, intent.event!, intent.eventKey!));
				if (other) throw new ExecutionError('event_wait_conflict');
				const delivered = await one(
					tx,
					history.received(
						this.namespace,
						run.id,
						intent.event!,
						intent.eventKey!,
						intent.due === undefined ? undefined : temporal.Instant.from(intent.due),
					),
				);
				if (delivered) {
					outcome = {
						type: 'success',
						value: encode(
							{ type: 'received', value: decode(delivered.value as ReturnType<typeof encode>) },
							run.policy.limits.resultBytes,
						),
					};
				} else if (
					intent.due !== undefined && (await one(tx, shared.due(temporal.Instant.from(intent.due))))!.due
				) outcome = { type: 'success', value: encode({ type: 'timeout' }, run.policy.limits.resultBytes) };
			} else if (intent.type !== 'control') {
				if ((await one(tx, shared.due(temporal.Instant.from(due!))))!.due) {
					outcome = { type: 'success', value: encode(due, run.policy.limits.resultBytes) };
				}
			}
			if (outcome !== null) bytes += new TextEncoder().encode(JSON.stringify(outcome)).byteLength;
			if (used + bytes > run.policy.limits.historyBytes) throw new ExecutionError('history_limit');
			await exec(
				tx,
				history.add({
					namespace: this.namespace,
					run: run.id,
					path: intent.path,
					fingerprint: intent.fingerprint,
					type: intent.type,
					job,
					child,
					due: due === undefined ? null : temporal.Instant.from(due),
					discard: intent.discard ?? false,
					outcome,
					bytes,
					event: intent.event ?? null,
					event_key: intent.eventKey ?? null,
					parent: intent.parent ?? null,
					branches: intent.branches === undefined ? null : [...intent.branches],
				}),
			);
			if (outcome !== null) return outcome;
			if (options.park) await exec(tx, runs.rest(this.namespace, run.id, 'waiting'));
		});
	}
	/** No completion can fall between the final check and the saved waiting state. */
	async park(activation: ActivationType, pending: readonly string[]): Promise<void> {
		await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			if (pending.length === 0) throw new ExecutionError('empty_wait');
			const scopes = pending.filter((path) => path.startsWith('@cleanup:')).map((path) => path.slice(9));
			const ordinary = pending.filter((path) => !path.startsWith('@cleanup:'));
			const completed = ordinary.length ? await rows(tx, history.outcomes(this.namespace, run.id, ordinary)) : [];
			if (completed.length !== new Set(ordinary).size) throw new ExecutionError('replay_conflict');
			let cleanupReady = false;
			for (const scope of scopes) {
				if (!await one(tx, cleanups.unfinished(this.namespace, run.id, scope))) cleanupReady = true;
			}
			const woken = cleanupReady || completed.some((step) => step.outcome !== null);
			await exec(tx, runs.rest(this.namespace, run.id, woken ? 'ready' : 'waiting'));
		});
	}
	/** A removed nested step must block replay just like a removed root step. */
	async verify(activation: ActivationType, parent: string, instructions: number): Promise<void> {
		await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			const nested = (await one(tx, history.count(this.namespace, run.id, parent)))!.count;
			if (nested !== instructions) throw new ExecutionError('replay_conflict');
		});
	}

	/** Winner selection and permission revocation share the parent run lock with activity writes. */
	async choose(activation: ActivationType, path: string, key: string): Promise<string> {
		return await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			const entry = await one(tx, history.race(this.namespace, run.id, path));
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
				await exec(tx, jobs.revokeAttempts(this.namespace, run.id, { prefix }));
				await exec(tx, jobs.revoke(this.namespace, run.id, { prefix }, outcome));
				const abandoned = await rows(tx, history.abandoned(this.namespace, run.id, prefix));
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
			await continuation.request(on(tx), { namespace: this.namespace, run, request, instructions });
			await this.#settle(tx, await this.#run(tx, run.id));
		});
	}
	/** Verify the complete root instruction count before freezing the workflow intended exit. */
	async finish(activation: ActivationType, outcome: OutcomeType, instructions: number): Promise<void> {
		await this.#transaction(async (tx) => {
			const { run } = await this.#guard(tx, activation.claim, true);
			const roots = (await one(tx, history.count(this.namespace, run.id, null)))!.count;
			if (roots !== instructions) throw new ExecutionError('replay_conflict');
			await this.#exit(tx, run, OutcomeSchema.parse(outcome));
		});
	}
	/**
	 * Freeze the intended outcome, revoke ordinary sibling attempts, then admit durable cleanup and
	 * finalization.
	 */
	async #exit(tx: Transaction, run: RunType, outcome: OutcomeType): Promise<void> {
		await exec(tx, runs.settle(this.namespace, run.id, outcome));
		// A terminal parent no longer permits ordinary siblings to write. Retain their attempts as cancellation evidence.
		const cancelled: OutcomeType = { type: 'cancelled', reason: 'The parent workflow finished.' };
		await exec(tx, jobs.revokeAttempts(this.namespace, run.id, { ordinary: true }));
		await exec(tx, jobs.revoke(this.namespace, run.id, { ordinary: true }, cancelled));

		await this.#settle(tx, { ...run, outcome });
	}
	/** Run saved cleanup first, then the configured exit activity. Keep the original outcome unchanged. */
	async #settle(tx: Transaction, run: RunType): Promise<void> {
		if (!await this.#cleanupNext(tx, run)) return;
		if (run.continuation !== null) {
			await continuation.rollover(on(tx), { namespace: this.namespace, run });
			return;
		}
		const outcome = run.outcome!;
		const finalizer = run.policy.finalizers.find((entry) =>
			entry.roots.some((root) => address(root) === address(this.#ref(run).definition))
		);
		if (finalizer) {
			if (await one(tx, jobs.at(this.namespace, run.id, 'finalizer'))) return;
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
		} else await exec(tx, runs.close(this.namespace, run.id, terminalState(outcome)));
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
		const rows_ = await rows(tx, cleanups.queue(this.namespace, run.id, scope));
		if (!rows_.length) return true;
		// An already-running cleanup keeps its position even if another branch registered later.
		if (rows_.some((row) => row.state === 'running')) return false;
		const next = rows_[0]!;
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
				`cleanup:${next.path}`,
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
					key: `cleanup:${run.id}:${next.path}`,
				},
				run,
				'child',
				'independent',
			);
			child = reference.id;
		}
		await exec(tx, cleanups.start(this.namespace, run.id, next.path, { job, child }));
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
		await exec(
			tx,
			cleanups.end(this.namespace, run.id, path, outcome.type === 'success' ? 'completed' : 'failed', outcome),
		);
		if (outcome.type !== 'success') {
			await exec(tx, runs.block(this.namespace, run.id, 'cleanup_exhausted'));
			return;
		}
		if (run.outcome !== null || run.continuation !== null) await this.#settle(tx, run);
		else {
			await this.#cleanupNext(tx, run, scope ?? undefined);
			await exec(tx, runs.wake(this.namespace, run.id, false));
		}
	}
	/** Persist a blocking reason only while this activation still holds the live claim. */
	async block(activation: ActivationType, reason: string): Promise<void> {
		await this.#transaction(async (tx) => {
			await this.#guard(tx, activation.claim, true);
			await exec(tx, runs.block(this.namespace, activation.ref.id, reason, true));
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
			await this.#outcome(tx, run, current!, OutcomeSchema.parse(outcome), disposition);
		});
	}
	/**
	 * The run lock serializes history accounting. Accepted job evidence survives even when replay history
	 * has no room.
	 */
	async #record(tx: Transaction, run: RunType, path: string, outcome: OutcomeType): Promise<boolean> {
		const bytes = new TextEncoder().encode(JSON.stringify(outcome)).byteLength;
		const used = (await one(tx, shared.history(this.namespace, run.id)))!.bytes;
		if (used + bytes > run.policy.limits.historyBytes) {
			await exec(tx, runs.block(this.namespace, run.id, 'history_limit', true));
			return false;
		}
		await exec(tx, history.record(this.namespace, run.id, path, outcome, bytes));
		return true;
	}
	/**
	 * Completion and wake use the same run lock as admission. No waiting transition can overwrite an
	 * accepted wake.
	 */
	async #outcome(
		tx: Transaction,
		run: RunType,
		job: JobRow,
		outcome: OutcomeType,
		disposition: 'transient' | 'permanent' | 'unknown',
	): Promise<void> {
		const rules = job.rules as AttemptType;
		await exec(tx, jobs.settle(this.namespace, job.id, job.generation, outcome.type, outcome));
		if (outcome.type !== 'success' && disposition === 'unknown') {
			await exec(tx, jobs.block(this.namespace, job.id, outcome));
			await exec(tx, runs.block(this.namespace, run.id, 'reconciliation'));
			return;
		}
		if (
			outcome.type !== 'success' && disposition === 'transient' && rules.retry === 'transient' &&
			job.sequence < job.budget
		) {
			const delay = Math.min(rules.delay.maximumMs, rules.delay.initialMs * 2 ** Math.min(30, job.sequence - 1));
			await exec(tx, jobs.retry(this.namespace, job.id, outcome, delay));
			return;
		}
		await exec(tx, jobs.finish(this.namespace, job.id, outcome.type === 'success' ? 'completed' : 'failed', outcome));
		const cleanup = await one(tx, cleanups.of(this.namespace, run.id, job.id));
		if (cleanup) {
			await this.#cleanupDone(tx, run, cleanup.path, cleanup.scope, outcome);
			return;
		}
		if (job.finalizer) {
			if (outcome.type !== 'success') {
				await exec(tx, runs.block(this.namespace, run.id, 'finalizer_exhausted'));
				return;
			}
			await exec(tx, runs.close(this.namespace, run.id, terminalState(run.outcome!)));
			return;
		}
		if (run.kind === 'activity') {
			await this.#exit(tx, run, outcome);
			return;
		}
		if (!await this.#record(tx, run, job.path, outcome)) return;
		await exec(tx, runs.wake(this.namespace, run.id));
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
		const expired = await rows(this.#database, jobs.lostClaims(this.namespace, limit));
		for (const candidate of expired) {
			await this.#transaction(async (tx) => {
				const run = await this.#run(tx, candidate.run, true);
				const job = await one(tx, jobs.lostClaim(this.namespace, candidate.id));
				if (!job || !['ready', 'waiting', 'advancing', 'settling'].includes(run.state)) return;
				const rules = job.rules as AttemptType;
				await this.#outcome(tx, run, job, {
					type: 'fault',
					code: 'abandoned',
					message: 'Attempt lost its execution authority.',
				}, rules.recovery === 'retry' ? 'transient' : 'unknown');
				await exec(tx, jobs.abandon(this.namespace, job.id, job.generation));
			});
		}
		await this.#transaction(async (tx) => {
			for (const run of await rows(tx, maintenance.expired(this.namespace, limit))) {
				await exec(tx, runs.rest(this.namespace, run.id, 'ready'));
			}
		});
		const waits = await rows(this.#database, history.wakeable(this.namespace, limit));
		for (const wait of waits) {
			await this.#transaction(async (tx) => {
				const run = await this.#run(tx, wait.run, true);
				if (!['waiting', 'ready', 'advancing'].includes(run.state)) return;
				const entry = await one(tx, history.pending(this.namespace, run.id, wait.path));
				if (!entry) return;
				let outcome: OutcomeType;
				if (entry.child) {
					const child = await this.#run(tx, entry.child);
					if (!terminal.includes(child.state) || !child.outcome) return;
					outcome = child.outcome;
				} else {outcome = {
						type: 'success',
						value: encode(
							entry.type === 'wait-event' ? { type: 'timeout' } : iso(entry.due!),
							run.policy.limits.resultBytes,
						),
					};}
				if (!await this.#record(tx, run, entry.path, outcome)) return;
				await exec(tx, runs.wake(this.namespace, run.id));
			});
		}
		// Child cleanup has its own run. Observe it without holding child and parent locks together.
		const finished = await rows(this.#database, cleanups.finished(this.namespace, limit));
		for (const cleanup of finished) {
			await this.#transaction(async (tx) => {
				const run = await this.#run(tx, cleanup.run, true);
				if (!['ready', 'waiting', 'advancing', 'settling'].includes(run.state)) return;
				if ((await one(tx, cleanups.state(this.namespace, run.id, cleanup.path)))?.state !== 'running') return;
				const child = await this.#run(tx, cleanup.child!);
				if (child.state === 'blocked') {
					// The child owns its repair budget. Leave the parent waiting, with a diagnostic reason.
					if (run.reason !== 'cleanup_child_blocked') {
						await exec(tx, runs.note(this.namespace, run.id, 'cleanup_child_blocked'));
					}
					return;
				}
				// A child can be repaired between discovery and this read; wait for its new terminal result.
				if (!terminal.includes(child.state) || child.outcome === null) return;
				await this.#cleanupDone(tx, run, cleanup.path, cleanup.scope, child.outcome!);
			});
		}
		const children = await rows(this.#database, maintenance.orphans(this.namespace, limit));
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
			await exec(tx, runs.control(this.namespace, run.id, paused, revision));
			await exec(
				tx,
				cleanups.decide({
					namespace: this.namespace,
					id: crypto.randomUUID(),
					run: run.id,
					epoch: run.epoch,
					actor: options.actor,
					reason: options.reason,
					action: paused ? 'pause' : 'resume',
				}),
			);
			return { paused, revision };
		});
	}
	/** Preserve every member until the whole terminal family has outlived all promised retention windows. */
	async prune(options: { readonly limit: number }): Promise<PruneResult> {
		if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
			throw new RangeError('Pruning limit must be 1..1000 total rows.');
		}
		return await this.#transaction(async (tx) => {
			let deleted = 0, removedRuns = 0, families = 0;
			// Bound discovery as well as deletions; a family can resume across many small maintenance calls.
			for (let examined = 0; examined < 32 && deleted < options.limit; examined++) {
				const root = await one(tx, maintenance.family(this.namespace));
				if (!root) break;
				// Delete referencing rows before their jobs and runs.
				for (const table of maintenance.order) {
					if (deleted === options.limit) break;
					deleted +=
						(await rows(tx, maintenance.purge(table, this.namespace, root.id, options.limit - deleted))).length;
				}
				if (deleted === options.limit) break;
				// The root remains discoverable until every other family run has been removed.
				const removed = await rows(tx, maintenance.prune(this.namespace, root.id, options.limit - deleted));
				deleted += removed.length;
				removedRuns += removed.length;
				if (removed.some((row) => row.id === root.id)) families++;
			}
			const remaining = (await one(tx, maintenance.more(this.namespace)))!;
			return { deleted, runs: removedRuns, families, more: remaining.more };
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
			await exec(tx, jobs.cancelAttempts(this.namespace, run.id, outcome));
			await exec(tx, jobs.cancel(this.namespace, run.id, outcome));
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
			if (await one(tx, cleanups.failedChild(this.namespace, run.id))) {
				throw new ExecutionError(
					'repair_policy',
					'A terminal failed child cleanup needs explicit reconciliation; granting local attempts cannot replace it.',
				);
			}
			const job = (await rows(tx, jobs.repairable(this.namespace, run.id)))[0];
			await exec(
				tx,
				cleanups.decide({
					namespace: this.namespace,
					id: crypto.randomUUID(),
					run: run.id,
					epoch: run.epoch + 1,
					actor: options.actor,
					reason: options.reason,
					action: 'repair',
				}),
			);
			if (job) await exec(tx, jobs.restart(this.namespace, job.id, options.attempts));
			const state = job?.finalizer && (run.outcome !== null || run.continuation !== null)
				? 'settling'
				: job
				? 'waiting'
				: 'ready';
			await exec(tx, runs.repair(this.namespace, run.id, state));
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
		const saved = await one(tx, cleanups.receipt(this.namespace, claim.jobId, options.key));
		if (!saved) return;
		if (saved.fingerprint !== digest || saved.contract !== (options.contract ?? options.key)) {
			throw new ExecutionError('receipt_conflict');
		}
		const wire = decode(saved.value as ReturnType<typeof encode>);
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
						await exec(
							tx,
							cleanups.save({
								namespace: this.namespace,
								job: claim!.jobId,
								key: write.key,
								contract: write.contract ?? write.key,
								fingerprint: await fingerprint(write.input),
								value: encoded,
							}),
						);
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

/** The terminal run state an intended outcome ends in. */
function terminalState(outcome: OutcomeType): 'completed' | 'cancelled' | 'failed' {
	return outcome.type === 'success' ? 'completed' : outcome.type === 'cancelled' ? 'cancelled' : 'failed';
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
