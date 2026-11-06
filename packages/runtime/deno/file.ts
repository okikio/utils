import * as json from '@okikio/streams/json';
/** Deno filesystem mechanics shared by executable composition roots. */
import { basename, dirname, join } from '@std/path';

/** Replacement and synchronization are separate policies, not a portable crash-safety guarantee. */
export interface WriteOptionsType {
	/** Abort is checked before publication. Once publication starts, its result must be reconciled. */
	readonly signal?: AbortSignal;
	/** Replace the destination directory entry, or atomically require an absent entry via hard link. Defaults to replace. */
	readonly overwrite?: 'replace' | 'create';
	/** Request no sync, file sync before publication, or file plus parent-directory sync. Defaults to none. */
	readonly durability?: 'none' | 'file' | 'directory';
}

/** Publication succeeded, but a later directory sync or temporary-entry cleanup failed. Do not blindly resend. */
export class FilePublicationError extends Error {
	/** The destination directory entry was published before this failure. */
	readonly published = true;
	/** Preserve the underlying host failure for reconciliation. */
	constructor(cause: unknown) {
		super('File was published, but final synchronization or cleanup failed.', { cause });
		this.name = 'FilePublicationError';
	}
}

/**
 * Publish a complete same-directory file. Replace uses rename; create uses an
 * exclusive hard link and never an existence-check/rename race. Both operate on
 * the destination entry rather than following a destination symlink. Parent
 * directories must be trusted: this is not a symlink-containment boundary.
 *
 * File and directory synchronization requests are host/filesystem capabilities.
 * Failure after publication is explicit. A successful sync is not a simulated
 * power-loss guarantee. The new file uses mode 0600 subject to umask; existing
 * permissions are not inherited. Keep borrowed input bytes stable until settled.
 */
export async function write(
	path: string,
	contents: string | Uint8Array,
	options: WriteOptionsType = {},
): Promise<void> {
	const { signal, overwrite = 'replace', durability = 'none' } = options;
	if (!['replace', 'create'].includes(overwrite) || !['none', 'file', 'directory'].includes(durability)) {
		throw new TypeError('Unknown file publication policy.');
	}
	signal?.throwIfAborted();
	const directory = dirname(path);
	await Deno.mkdir(directory, { recursive: true });
	const temp = join(directory, `.${basename(path)}.${crypto.randomUUID()}.tmp`);
	const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
	let owned = false;
	let published = false;
	/** Retain an earlier failure if unlink cleanup also fails. */
	let operationFailed = false;
	let operationFailure: unknown;
	try {
		{
			using file = await Deno.open(temp, { write: true, createNew: true, mode: 0o600 });
			owned = true;
			let offset = 0;
			while (offset < bytes.byteLength) {
				signal?.throwIfAborted();
				const count = await file.write(bytes.subarray(offset));
				if (count === 0) throw new Error('File write made no progress.');
				offset += count;
			}
			if (durability !== 'none') await file.sync();
		}
		signal?.throwIfAborted();
		if (overwrite === 'create') await Deno.link(temp, path);
		else await Deno.rename(temp, path);
		// Beyond this point a retry could duplicate external work; expose later failure as already published.
		published = true;
		if (overwrite === 'create') await Deno.remove(temp);
		owned = false;
		if (durability === 'directory') {
			using parent = await Deno.open(directory, { read: true });
			await parent.sync();
		}
	} catch (error) {
		operationFailed = true;
		operationFailure = error;
		if (published) throw new FilePublicationError(error);
		throw error;
	} finally {
		// Never unlink a name whose exclusive creation failed: it may belong to another writer.
		if (owned) {
			await Deno.remove(temp).catch((error) => {
				if (!(error instanceof Deno.errors.NotFound)) {
					const combined = operationFailed
						? new AggregateError([operationFailure, error], 'File publication and temporary cleanup failed.')
						: error;
					if (published) throw new FilePublicationError(combined);
					throw combined;
				}
			});
		}
	}
}

/**
 * Read one regular strict UTF-8 JSON file within an explicit byte budget.
 * The opened descriptor is checked again so a path replacement cannot bypass the
 * file-kind check. Shape validation remains with the caller. Cancellation closes
 * the reader; no deployment identity or maintenance policy is inferred.
 */
export async function readJson(path: string, maximumBytes: number, signal?: AbortSignal): Promise<unknown> {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
		throw new RangeError('JSON file byte budget must be a positive safe integer.');
	}
	signal?.throwIfAborted();
	if (!(await Deno.stat(path)).isFile) throw new TypeError('JSON input must be a regular file.');
	using file = await Deno.open(path, { read: true });
	if (!(await file.stat()).isFile) throw new TypeError('JSON input must be a regular file.');
	// The descriptor owns its readable stream; prevent auto-close because using owns it.
	return await json.read(
		new ReadableStream<Uint8Array>({
			async pull(controller) {
				const chunk = new Uint8Array(Math.min(65536, maximumBytes + 1));
				const count = await file.read(chunk);
				if (count === null) controller.close();
				else controller.enqueue(chunk.subarray(0, count));
			},
		}),
		maximumBytes,
		signal,
	);
}

/** Exclusively created audit file. The caller owns record meaning and redaction. */
export interface Audit extends AsyncDisposable {
	/** Append one bounded JSON Line and synchronize it before returning. Concurrent appends are refused. */
	append(value: unknown): Promise<void>;
	/** Wait for an admitted append, then close once. */
	close(): Promise<void>;
}

/**
 * Create a new mode-0600 audit file without truncating an existing file.
 * Each append is synchronized. There is no inter-process writer coordination or
 * automatic secret filtering; only the creator owns the descriptor. A failed
 * append can leave an incomplete last record, which must not count as a receipt.
 */
export async function audit(path: string, maximumBytes = 65536): Promise<Audit> {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
		throw new RangeError('Audit record budget must be a positive safe integer.');
	}
	const file = await Deno.open(path, { createNew: true, write: true, mode: 0o600 });
	let pending: Promise<void> | undefined;
	let closing: Promise<void> | undefined;
	/** Join the admitted append before closing; its failure remains observable by that append caller. */
	const close = (): Promise<void> => {
		closing ??= (async () => {
			await pending?.catch(() => {});
			file.close();
		})();
		return closing;
	};
	return Object.freeze({
		/**
		 * Serialize one record within its byte budget, finish partial OS writes,
		 * then request file synchronization before accepting another append.
		 * A rejected append may already have written bytes; it is not a rollback.
		 */
		async append(value: unknown): Promise<void> {
			if (closing !== undefined) throw new TypeError('Audit file is closed.');
			if (pending !== undefined) throw new TypeError('Audit file already has an active append.');
			const bytes = json.encode(value, maximumBytes);
			pending = (async () => {
				let offset = 0;
				while (offset < bytes.length) {
					const count = await file.write(bytes.subarray(offset));
					if (!Number.isSafeInteger(count) || count < 1 || count > bytes.length - offset) {
						throw new Error('Audit output made invalid progress.');
					}
					offset += count;
				}
				await file.sync();
			})();
			try {
				await pending;
			} finally {
				pending = undefined;
			}
		},
		close,
		[Symbol.asyncDispose]: close,
	});
}
