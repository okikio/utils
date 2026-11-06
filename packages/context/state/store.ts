/** The persisted snapshot and conditional-write contract consumed by stored cells. @module */
import * as schema from '@okikio/schema';

/** One shared representation-name rule for opening and validating saved envelopes; lengths count Unicode code points. */
export const ContractSchema: schema.JsonReader<string, string> = schema.string({
	minLength: 1,
	maxLength: 256,
	pattern: /\S/u,
});

/**
 * The portable envelope around one application's encoded state.
 *
 * The application names its representation through contract. Each accepted
 * replacement gets a fresh version so a stale owner cannot overwrite a newer
 * snapshot, including after a record is removed and recreated. The value is
 * finite JSON; a codec supplies explicit conversions for Dates and other
 * application values. Adapters retain only the latest envelope for one key.
 */
export const SnapshotSchema: schema.ObjectReader<
	{
		readonly format: schema.JsonReader<1, 1>;
		readonly contract: schema.JsonReader<string, string>;
		readonly version: schema.JsonReader<string, string>;
		readonly value: schema.JsonReader<schema.JsonValue, schema.JsonValue>;
	},
	'reject'
> = schema.object({
	/** Library envelope revision. Unknown revisions reject instead of being reinterpreted. */
	format: schema.literal(1),
	/** Application-controlled representation identity, such as crawl.cursor.v1. */
	contract: ContractSchema,
	/** Unique identity of this write. It is an equality token, not an ordered counter. */
	version: schema.string({ minLength: 1, maxLength: 128 }),
	/** Encoded state. Application validation and the configured byte budget apply before publication. */
	value: schema.json({ maximumDepth: 64, maximumNodes: 65_536, maximumStringCodeUnits: 16_777_216 }),
});

/** A validated envelope copied away from its input objects by SnapshotSchema. */
export type SnapshotType = schema.Output<typeof SnapshotSchema>;

/** Cancellation for one load, save, or local stored-cell operation. */
export interface OperationOptions {
	/** Borrowed signal. Cancellation cannot undo a write the store already committed. */
	readonly signal?: AbortSignal;
}

/** Conditional replacement of one snapshot; undefined requires that no record exists. */
export interface SaveOptions extends OperationOptions {
	/** Version the caller last loaded. A different version must leave the record unchanged. */
	readonly expectedVersion: string | undefined;
}

/**
 * A borrowed storage slot containing at most one current snapshot.
 *
 * Context owns this contract because it needs load and conditional save, while
 * Storage owns concrete adapters. This is not a general key/value database or
 * workflow history. The adapter selects its key when it is constructed.
 *
 * Atomic stores coordinate the version check and replacement for every writer
 * within their documented scope. Single-writer stores require the application
 * to exclude concurrent writers; a check followed by a Web Storage write alone
 * cannot coordinate browser tabs. All adapters must state that scope.
 *
 * A save resolves true only after the store acknowledges the exact envelope.
 * False means a version conflict and no replacement. A rejection may leave the
 * outcome unknown, such as a lost database connection after commit. Callers
 * must reload before trying another mutation. Cancellation is cooperative;
 * callers still await the operation to settle before releasing their lifetime.
 * An adapter captures the input envelope, expected version and signal when save
 * is called, before waiting for locks, connections or host acknowledgement.
 * Later mutation of the caller's envelope or option object cannot change that
 * admitted write. Loads return detached envelopes rather than internal records.
 *
 * Supplied stores and their clients remain borrowed. Disposing a cell neither
 * disposes this store nor removes its saved value.
 */
export interface Store {
	/** Coordination actually supplied by this adapter, rather than inferred from its method names. */
	readonly concurrency: 'atomic' | 'single-writer';
	/** Load the current envelope, or undefined when the selected key has never been saved or was removed. */
	load(options?: OperationOptions): Promise<SnapshotType | undefined>;
	/** Commit one fresh-version envelope when expectedVersion still matches; false never writes. */
	save(snapshot: SnapshotType, options: SaveOptions): Promise<boolean>;
}

/** A newer or missing stored version rejected a mutation before it could replace state. */
export class ConflictError extends Error {
	/** Last published version, or undefined when the losing operation attempted initial creation. */
	readonly expectedVersion: string | undefined;

	/** Preserve the stale expectation; reload supplies the current snapshot without rerunning the updater. */
	constructor(expectedVersion: string | undefined) {
		super('Stored state changed. Reload before applying another update.');
		this.name = 'ConflictError';
		this.expectedVersion = expectedVersion;
	}
}

/**
 * Storage did not produce a publishable write result.
 *
 * unknown means the adapter rejected after save was entered, so the write might
 * exist. committed means storage acknowledged the version but cancellation or
 * disposal prevented local publication. The original failure or cancellation
 * reason remains in cause, including an explicit undefined. Inspect or reopen
 * the store to reconcile the version instead of retrying the updater blindly.
 */
export class CommitError extends Error {
	/** Candidate version that can be compared with a subsequently loaded envelope. */
	readonly version: string;
	/** What the caller can safely infer about persistence from the settled operation. */
	readonly outcome: 'unknown' | 'committed';

	/** Keep persistence uncertainty distinct from subscriber diagnostics and ordinary validation errors. */
	constructor(version: string, outcome: 'unknown' | 'committed', cause: unknown) {
		super(
			outcome === 'committed'
				? 'Stored state committed after this operation stopped; reload or reopen to observe it.'
				: 'The stored state commit outcome is unknown; reload before another mutation.',
			{ cause },
		);
		this.name = 'CommitError';
		this.version = version;
		this.outcome = outcome;
	}
}

/** A prior conflict or uncertain write requires an explicit successful reload. */
export class ReloadRequiredError extends Error {
	/** Rejected before a caller-owned updater is invoked, so it cannot run against known stale state. */
	constructor() {
		super('Reload stored state before applying another mutation.');
		this.name = 'ReloadRequiredError';
	}
}
