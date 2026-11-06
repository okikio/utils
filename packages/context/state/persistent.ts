/** Serialized, save-before-publication state ownership over a borrowed store. @module */
import { AsyncDisposableStack, asyncDispose, DisposableStack } from '@okikio/dispose';
import * as codec from '@okikio/schema/codec';
import type { Contract, ContractOutput } from '@okikio/schema/codec';
import * as json from '@okikio/collection/record/json';
import { create } from './cell.ts';
import type { Cell, Options, Reader } from './cell.ts';
import { CommitError, ConflictError, ContractSchema, ReloadRequiredError, SnapshotSchema } from './store.ts';
import type { OperationOptions, SnapshotType, Store } from './store.ts';

/** One explicit old-to-current application conversion. Construct with migration() to validate the old payload first. */
export interface Migration<Value> {
	/** Exact old application representation identity; no wildcard or implicit migration chain. */
	readonly contract: string;
	/** Validate old encoded JSON and produce a candidate current application value. Must not perform external effects. */
	read(value: unknown): Promise<Value>;
}

/**
 * Bind an old codec/schema to one direct conversion. The old decoder runs once before change;
 * the current cell's codec separately validates the result before conditional save.
 * Conversion may run again after an explicit reopen/reload following conflict. Keep it free of external effects.
 */
export function migration<Definition extends Contract, Value>(
	contract: string,
	definition: Definition,
	change: (value: ContractOutput<Definition>) => Value | PromiseLike<Value>,
): Migration<Value> {
	ContractSchema.parse(contract);
	codec.input(definition);
	codec.output(definition);
	return Object.freeze({
		contract,
		read: async (value: unknown): Promise<Value> => await change(await codec.read(definition, value)),
	});
}

/** Policy and dependencies for loading one named state snapshot. */
export interface OpenOptions<Definition extends Contract> extends Options<ContractOutput<Definition>> {
	/** Borrowed slot and client. The cell never closes the store or deletes its value. */
	readonly store: Store;
	/** Application representation identity saved with the value; mismatches reject and never overwrite. */
	readonly contract: string;
	/** Direct old-to-current conversions. Missing matches reject; duplicate/current contracts are invalid. */
	readonly migrations?: readonly Migration<ContractOutput<Definition>>[];
	/** Validation or explicit two-way conversion between application state and stored JSON. */
	readonly value: Definition;
	/** Called only when no snapshot exists. Its result is saved before open resolves. Omit to require existing state. */
	readonly initial?: () => ContractOutput<Definition> | PromiseLike<ContractOutput<Definition>>;
	/** Borrowed lifetime signal. Abort stops new work; await disposal separately to join cleanup. */
	readonly signal?: AbortSignal;
	/** Maximum admitted operations including the active operation. Excess calls reject before retaining their input. @default 64 */
	readonly maximumPending?: number;
	/** Maximum UTF-8 bytes in one encoded value, from 1 through 16 MiB. @default 1048576 */
	readonly maximumBytes?: number;
}

/**
 * Own asynchronous state changes while lending the ordinary synchronous reader.
 *
 * get() continues to return the last published value while a write is pending.
 * Each write Promise resolves after persistence and local publication. Updaters
 * run once, in admission order, using the preceding committed value; conflicts
 * never rerun application code. reload() explicitly observes another writer.
 * There is no asynchronous batch: synchronous Cell.batch only groups local
 * notifications and must not be confused with a storage transaction.
 *
 * Treat returned application objects as immutable. Encoding detaches stored
 * JSON, but arbitrary decoded objects are neither proxied nor recursively
 * frozen. Mutating a returned Date or object does not save it.
 */
export interface StoredCell<Value> extends AsyncDisposable {
	/** Read and observe accepted values without mutation, store, or disposal authority. */
	readonly reader: Reader<Value>;
	/** Opaque stored version of the last publication. reader.revision is a separate local notification counter. */
	readonly version: string;
	/** True as soon as disposal stops admission, even while an existing store call is still settling. */
	readonly closed: boolean;
	/** A conflict or uncertain/unpublished write requires reload before another mutation. */
	readonly needsReload: boolean;
	/** Latest subscriber/reporting failure. Such failures never reject an already committed write. */
	readonly observerError: unknown;
	/** Replace state after encoding, validation, and conditional storage acknowledgement. Equal values skip the write. */
	set(value: Value, options?: OperationOptions): Promise<void>;
	/** Invoke one synchronous updater when its FIFO slot becomes active. No implicit retries or callback replay occur. */
	update(change: (value: Value) => Value, options?: OperationOptions): Promise<void>;
	/** Load and validate the current stored value. Missing or incompatible data rejects without replacing the reader. */
	reload(options?: OperationOptions): Promise<void>;
	/** Stop admission and observations immediately; every caller receives the same Promise joining active I/O. */
	[asyncDispose](): Promise<void>;
}

/** Validated, fixed policy copied at construction so caller mutation cannot change a live owner's limits. */
interface Configuration<Definition extends Contract> {
	/** Capture construction choices once; a caller may reuse and later modify its original options object. */
	readonly options: Readonly<OpenOptions<Definition>>;
	/** Include active work in admission accounting, so a blocked store cannot retain unbounded closures. */
	readonly maximumPending: number;
	/** Bound encoded value size both before save and after load; envelope metadata has independent schema limits. */
	readonly maximumBytes: number;
	/** Run the caller's comparison once before encoding; a saved version still controls reload publication. */
	readonly equal: (left: ContractOutput<Definition>, right: ContractOutput<Definition>) => boolean;
}

/** Keep validated metadata together with its decoded value, rather than rereading a provider-owned object after awaits. */
interface DecodedSnapshot<Value> {
	/** Detached, validated envelope whose version stays associated with the decoded value across awaits. */
	readonly snapshot: SnapshotType;
	/** This load performed a conditional migration save; cancellation must retain its acknowledged commit identity. */
	readonly committed?: true;
	/** Canonical application result obtained through the declared decoder, including before an initial save. */
	readonly value: Value;
}

/** One bounded waiting operation and the listener it owns while waiting for its FIFO turn. */
interface Pending {
	/** Work executes once after every earlier admitted operation has settled. */
	readonly action: (signal: AbortSignal) => Promise<void>;
	/** Linked cell/call cancellation; the original signals stay borrowed. */
	readonly signal: AbortSignal;
	/** Removing this callback releases the pending closure from the supplied signal. */
	readonly resources: DisposableStack;
	/** Resolve only after this queue entry has completed its operation and synchronous listener release. */
	readonly resolve: () => void;
	/** Preserve the entry's own failure or exact cancellation reason independently of later queued work. */
	readonly reject: (reason: unknown) => void;
	/** Active operations settle from their real result, rather than racing cancellation and forgetting I/O. */
	started: boolean;
}

/**
 * Load or create a stored cell with explicit asynchronous write semantics.
 *
 * The initial factory is lazy. When atomic initial creation loses a race, open
 * loads the winning snapshot instead of overwriting it or invoking the factory
 * again. Invalid values, contract mismatches, and failed loads never trigger
 * a replacement. A store retains one snapshot, while the cell retains one value
 * and a bounded FIFO queue with no event history.
 *
 * @example
 * ```ts
 * import * as state from '@okikio/context/state';
 * import * as stores from '@okikio/storage/state';
 * import * as schema from '@okikio/schema';
 * const store = stores.memory();
 * await using draft = await state.open({
 *   store, contract: 'draft.v1', value: schema.object({ title: schema.string() }),
 *   initial: () => ({ title: '' }),
 * });
 * await draft.update((value) => ({ ...value, title: 'Saved draft' }));
 * console.log(draft.reader.get().title);
 * ```
 */
export async function open<const Definition extends Contract>(
	options: OpenOptions<Definition>,
): Promise<StoredCell<ContractOutput<Definition>>> {
	const configuration = configure(options);
	const selected = configuration.options;
	const signal = selected.signal ?? new AbortController().signal;
	signal.throwIfAborted();
	const stored = await selected.store.load({ signal });
	signal.throwIfAborted();
	let accepted: DecodedSnapshot<ContractOutput<Definition>>;
	let createdVersion: string | undefined;
	if (stored === undefined) {
		if (selected.initial === undefined) {
			throw new ReferenceError('Stored state is missing and no initial factory was supplied.');
		}
		const initial = await selected.initial();
		signal.throwIfAborted();
		accepted = await prepare(configuration, initial, signal);
		if (await save(selected.store, accepted.snapshot, undefined, signal)) {
			createdVersion = accepted.snapshot.version;
		} else {
			signal.throwIfAborted();
			const winner = await selected.store.load({ signal });
			signal.throwIfAborted();
			if (winner === undefined) {
				throw new ReferenceError('The winning initial state disappeared before it could be loaded.');
			}
			accepted = await decode(configuration, winner, signal);
		}
	} else {
		accepted = await decode(configuration, stored, signal);
	}
	if ((createdVersion !== undefined || accepted.committed) && signal.aborted) {
		throw new CommitError(createdVersion ?? accepted.snapshot.version, 'committed', signal.reason);
	}
	signal.throwIfAborted();
	return new PersistentCell(configuration, accepted.snapshot.version, accepted.value);
}

/**
 * One local publisher and its queue. Store authority remains outside this owner.
 *
 * The active Promise is assigned before any caller callback can run. That makes
 * reentrant disposal join the real operation. Disposal then aborts admission,
 * completes observations, removes queued listeners, and waits for active work.
 */
class PersistentCell<Definition extends Contract> implements StoredCell<ContractOutput<Definition>> {
	/** The borrowed store, fixed codec and admission policy are shared by all operations of this owner. */
	readonly #configuration: Configuration<Definition>;
	/** The existing synchronous cell owns all subscription and bounded notification behavior. */
	readonly #cell: Cell<ContractOutput<Definition>>;
	/** Cancels this owner without canceling a borrowed parent or client. */
	readonly #controller = new AbortController();
	/** Join local disposal cancellation with an optional application lifetime without modifying either borrowed source. */
	readonly #signal: AbortSignal;
	/** Registration order makes cancellation happen before observation closure and the final I/O join. */
	readonly #resources = new AsyncDisposableStack();
	/** Only admitted waiting calls are retained; active work is held separately in #active. */
	readonly #queue: Pending[] = [];
	/** Last locally published persisted token; a failed or canceled write never advances it. */
	#version: string;
	/** Close admission synchronously before abort observers or disposal callbacks can reenter. */
	#closed = false;
	/** Prevent further derivations after a conflict or uncertain commit until a successful reload reconciles state. */
	#needsReload = false;
	/** Always settles after the active operation reports its result and releases its listener. */
	#active: Promise<void> | undefined;
	/** Every disposal caller joins the same work; a stack's disposed flag alone does not provide that promise. */
	#disposal: Promise<void> | undefined;

	/** Acquire only local observation and cancellation resources after initial storage has succeeded. */
	constructor(configuration: Configuration<Definition>, version: string, initial: ContractOutput<Definition>) {
		this.#configuration = configuration;
		this.#version = version;
		this.#signal = configuration.options.signal === undefined
			? this.#controller.signal
			: AbortSignal.any([this.#controller.signal, configuration.options.signal]);
		this.#cell = create(initial, {
			...configuration.options,
			// Stored versions may change while decoded values compare equal. The stored owner
			// selects publication; the local cell must not discard that accepted transition.
			equal: () => false,
		});
		this.#resources.defer(async () => {
			await this.#active;
		});
		// These two local releases are synchronous, so the public disposal call
		// closes observations before yielding to the active I/O join. A shared
		// synchronous stack attempts both even if a local release throws.
		const local = new DisposableStack();
		local.use(this.#cell);
		local.defer(() => this.#controller.abort(new ReferenceError('Stored state cell is closed.')));
		this.#resources.use(local);
	}

	/** Lend the existing capability-restricted facade, preserving ordinary local-state composition. */
	get reader(): Reader<ContractOutput<Definition>> {
		return this.#cell.reader;
	}
	/** Expose persistence identity independently from the reader's per-owner revision counter. */
	get version(): string {
		return this.#version;
	}
	/** A closed owner may still be awaiting I/O; its disposal Promise communicates completion. */
	get closed(): boolean {
		return this.#closed;
	}
	/** Tell callers when the last published value is no longer a valid starting point for writes. */
	get needsReload(): boolean {
		return this.#needsReload;
	}
	/** Observation failures stay diagnostic and cannot reverse an acknowledged store write. */
	get observerError(): unknown {
		return this.#cell.observerError;
	}

	/** Queue an explicit replacement; the caller's object remains borrowed until this Promise settles. */
	set(value: ContractOutput<Definition>, options: OperationOptions = {}): Promise<void> {
		return this.#enqueue((signal) => this.#replace(value, signal), options);
	}

	/** A canceled or stale queued call never invokes the caller's updater. */
	update(
		change: (value: ContractOutput<Definition>) => ContractOutput<Definition>,
		options: OperationOptions = {},
	): Promise<void> {
		return this.#enqueue(async (signal) => {
			this.#assertCurrent();
			const value = change(this.#cell.reader.get());
			if (thenable(value)) {
				// Observe misuse without accepting an unfinished asynchronous derivation as state.
				void Promise.resolve(value).catch(() => undefined);
				throw new TypeError('Stored state update callbacks must be synchronous.');
			}
			await this.#replace(value, signal);
		}, options);
	}

	/** Reload shares the write queue so an older load cannot replace a newer local commit. */
	reload(options: OperationOptions = {}): Promise<void> {
		return this.#enqueue(async (signal) => {
			const snapshot = await this.#configuration.options.store.load({ signal });
			signal.throwIfAborted();
			if (snapshot === undefined) throw new ReferenceError('Stored state is missing.');
			let accepted: DecodedSnapshot<ContractOutput<Definition>>;
			try {
				accepted = await decode(this.#configuration, snapshot, signal);
			} catch (error) {
				if (error instanceof ConflictError || error instanceof CommitError) this.#needsReload = true;
				throw error;
			}
			if (accepted.committed && signal.aborted) {
				this.#needsReload = true;
				throw new CommitError(accepted.snapshot.version, 'committed', signal.reason);
			}
			signal.throwIfAborted();
			const publish = accepted.snapshot.version !== this.#version ||
				!this.#configuration.equal(this.#cell.reader.get(), accepted.value);
			signal.throwIfAborted();
			this.#needsReload = false;
			this.#version = accepted.snapshot.version;
			if (publish) this.#cell.set(accepted.value);
		}, options);
	}

	/** Stop publication immediately, then join admitted I/O without disposing the borrowed store. */
	[asyncDispose](): Promise<void> {
		if (this.#disposal !== undefined) return this.#disposal;
		const completion = Promise.withResolvers<void>();
		this.#disposal = completion.promise;
		this.#closed = true;
		// Abort listeners can reenter disposal synchronously. Publish the join first
		// so every caller observes cleanup completion, rather than the stack's flag.
		void this.#resources.disposeAsync().then(completion.resolve, completion.reject);
		return this.#disposal;
	}

	/** Prepare every fallible representation before save, then publish only its acknowledged version. */
	async #replace(value: ContractOutput<Definition>, signal: AbortSignal): Promise<void> {
		this.#assertCurrent();
		signal.throwIfAborted();
		const equal = this.#configuration.equal(this.#cell.reader.get(), value);
		signal.throwIfAborted();
		if (equal) return;
		const prepared = await prepare(this.#configuration, value, signal);
		try {
			if (!await save(this.#configuration.options.store, prepared.snapshot, this.#version, signal)) {
				throw new ConflictError(this.#version);
			}
			// A disposer can run in the microtask between save's resolution and this
			// continuation. Acknowledge persistence without reviving a closed reader.
			if (this.#closed || signal.aborted) {
				throw new CommitError(prepared.snapshot.version, 'committed', signal.reason);
			}
		} catch (error) {
			if (error instanceof ConflictError || error instanceof CommitError) this.#needsReload = true;
			throw error;
		}
		this.#version = prepared.snapshot.version;
		this.#cell.set(prepared.value);
	}

	/** A known stale value must never be passed to another mutating callback. */
	#assertCurrent(): void {
		if (this.#needsReload) throw new ReloadRequiredError();
	}

	/** Bound retention before allocating an operation, and unlink canceled waiting calls promptly. */
	#enqueue(action: Pending['action'], options: OperationOptions): Promise<void> {
		if (this.#closed) return Promise.reject(new ReferenceError('Stored state cell is closed.'));
		const signal = options.signal === undefined ? this.#signal : AbortSignal.any([this.#signal, options.signal]);
		if (signal.aborted) return Promise.reject(signal.reason);
		if (this.#queue.length + (this.#active === undefined ? 0 : 1) >= this.#configuration.maximumPending) {
			return Promise.reject(new RangeError('Stored state exceeds maximumPending.'));
		}
		return new Promise<void>((resolve, reject) => {
			const resources = new DisposableStack();
			const pending: Pending = { action, signal, resources, resolve, reject, started: false };
			const abort = (): void => {
				if (pending.started) return;
				const index = this.#queue.indexOf(pending);
				if (index < 0) return;
				this.#queue.splice(index, 1);
				resources.dispose();
				reject(signal.reason);
			};
			this.#queue.push(pending);
			signal.addEventListener('abort', abort, { once: true });
			resources.defer(() => signal.removeEventListener('abort', abort));
			if (signal.aborted) abort();
			this.#pump();
		});
	}

	/** Assign the active join before executing user code, and keep each operation's failure on its own Promise. */
	#pump(): void {
		if (this.#active !== undefined || this.#queue.length === 0) return;
		const pending = this.#queue.shift()!;
		pending.started = true;
		const operation = Promise.resolve().then(async () => {
			using _resources = pending.resources;
			pending.signal.throwIfAborted();
			await pending.action(pending.signal);
		});
		// Release the completed slot before resolving its public Promise. A caller
		// awaiting one operation may immediately submit the next with a limit of
		// one; a later housekeeping microtask must not report the finished work as active.
		this.#active = operation.then(
			() => {
				this.#active = undefined;
				pending.resolve();
				this.#pump();
			},
			(reason: unknown) => {
				this.#active = undefined;
				pending.reject(reason);
				this.#pump();
			},
		);
	}
}

/** Validate every local option before a lazy initial factory or storage mutation can run. */
function configure<Definition extends Contract>(options: OpenOptions<Definition>): Configuration<Definition> {
	codec.input(options.value);
	codec.output(options.value);
	ContractSchema.parse(options.contract);
	if (!['atomic', 'single-writer'].includes(options.store.concurrency)) {
		throw new TypeError('State store coordination is missing.');
	}
	const migrations = (options.migrations ?? []).map((entry) => {
		ContractSchema.parse(entry.contract);
		if (entry.contract === options.contract || typeof entry.read !== 'function') {
			throw new TypeError('State migration requires an old contract and reader.');
		}
		return Object.freeze({ contract: entry.contract, read: entry.read.bind(entry) });
	});
	if (new Set(migrations.map((entry) => entry.contract)).size !== migrations.length) {
		throw new TypeError('State migration contracts must be unique.');
	}
	const maximumPending = count(options.maximumPending ?? 64, 'maximumPending', 65_536);
	const maximumBytes = count(options.maximumBytes ?? 1_048_576, 'maximumBytes', 16_777_216);
	count(options.notificationLimit ?? 32, 'notificationLimit', Number.MAX_SAFE_INTEGER);
	return Object.freeze({
		options: Object.freeze({ ...options, migrations: Object.freeze(migrations) }),
		maximumPending,
		maximumBytes,
		equal: options.equal ?? Object.is,
	});
}

/** A pending value is encoded and decoded before committing so restart yields the same application representation. */
async function prepare<Definition extends Contract>(
	configuration: Configuration<Definition>,
	value: ContractOutput<Definition>,
	signal: AbortSignal,
): Promise<DecodedSnapshot<ContractOutput<Definition>>> {
	signal.throwIfAborted();
	const encoded = bounded(await codec.write(configuration.options.value, value), configuration.maximumBytes);
	signal.throwIfAborted();
	const snapshot = SnapshotSchema.parse({
		format: 1,
		contract: configuration.options.contract,
		version: crypto.randomUUID(),
		value: encoded,
	});
	// A custom decoder may mutate its input. Lend it a separate finite JSON copy
	// so decoding cannot rewrite the candidate that storage will acknowledge.
	const decoded = await codec.read(configuration.options.value, bounded(snapshot.value, configuration.maximumBytes));
	signal.throwIfAborted();
	return { snapshot, value: decoded };
}

/** Validate saved envelopes and their application contract before lending a value to readers. */
async function decode<Definition extends Contract>(
	configuration: Configuration<Definition>,
	input: SnapshotType,
	signal: AbortSignal,
): Promise<DecodedSnapshot<ContractOutput<Definition>>> {
	const snapshot = SnapshotSchema.parse(input);
	if (snapshot.contract !== configuration.options.contract) {
		const selected = configuration.options.migrations?.find((entry) => entry.contract === snapshot.contract);
		if (selected === undefined) throw new TypeError('Stored state contract does not match.');
		const old = bounded(snapshot.value, configuration.maximumBytes);
		signal.throwIfAborted();
		const value = await selected.read(old);
		signal.throwIfAborted();
		const candidate = await prepare(configuration, value, signal);
		if (!await save(configuration.options.store, candidate.snapshot, snapshot.version, signal)) {
			throw new ConflictError(snapshot.version);
		}
		if (signal.aborted) throw new CommitError(candidate.snapshot.version, 'committed', signal.reason);
		return { ...candidate, committed: true };
	}
	const value = await codec.read(configuration.options.value, bounded(snapshot.value, configuration.maximumBytes));
	signal.throwIfAborted();
	return { snapshot, value };
}

/** Entering save makes failures potentially uncertain; a confirmed commit remains distinguishable after cancellation. */
async function save(
	store: Store,
	snapshot: SnapshotType,
	expectedVersion: string | undefined,
	signal: AbortSignal,
): Promise<boolean> {
	signal.throwIfAborted();
	const admitted = SnapshotSchema.parse(snapshot);
	const version = admitted.version;
	let accepted: boolean;
	try {
		accepted = await store.save(admitted, { expectedVersion, signal });
		if (typeof accepted !== 'boolean') {
			throw new TypeError('State store save must acknowledge true or report conflict with false.');
		}
	} catch (error) {
		throw new CommitError(version, 'unknown', error);
	}
	// A reported conflict remains authoritative even when cancellation happens
	// in the same turn. The existing owner must remember that its value is stale.
	if (!accepted) return false;
	if (signal.aborted) throw new CommitError(version, 'committed', signal.reason);
	return true;
}

/** Reuse the owned JSON model rather than letting JSON.stringify silently drop or coerce application values. */
function bounded(input: unknown, maximumBytes: number): json.Value {
	const value = json.copy(input, { maximumDepth: 64, maximumNodes: 65_536, maximumStringCodeUnits: maximumBytes });
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximumBytes) {
		throw new RangeError('Stored state exceeds maximumBytes.');
	}
	return value;
}

/** Bounds describe retained work or encoded bytes, so fractional and non-finite policies cannot be accepted. */
function count(value: number, name: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new RangeError(`${name} must be 1 through ${maximum}.`);
	}
	return value;
}

/** Detect untyped asynchronous updater misuse without relying on a realm's Promise constructor. */
function thenable(value: unknown): value is PromiseLike<unknown> {
	return (typeof value === 'object' && value !== null || typeof value === 'function') &&
		typeof (value as { readonly then?: unknown }).then === 'function';
}
