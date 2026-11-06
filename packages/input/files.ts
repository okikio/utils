/** Collect borrowed files from controls, explicit pickers, and drop targets. @module */
import type { BindingHandle, ErrorReporter, HostEvent, ListenerTarget, Native, NativeTarget } from './types.ts';
import * as ownership from './ownership.ts';
import * as callback from './callback.ts';
import * as targets from './targets.ts';

/** A borrowed directory-entry capability; no browser globals or body readers are required. */
export interface EntryType {
	/** One literal path component; separators, dot components and NUL are forbidden. */
	readonly name: string;
	/** Directories enumerate children; files resolve metadata and a borrowed File value. */
	readonly kind: 'file' | 'directory';
}

/** Explicit host boundary for File System Access or another directory provider. */
export interface EntryAdapterType<Entry extends EntryType, Value extends FileValue> {
	/** Enumerate children lazily; the walker owns the returned iterator. */
	children(entry: Entry): Iterable<Entry> | AsyncIterable<Entry>;
	/** Resolve one file's metadata without reading its body. Permission failures propagate. */
	file(entry: Entry): PromiseLike<Value>;
}

/** Per-walk limits count directories too, preventing unbounded empty-directory scans. */
export interface WalkOptionsType {
	/** Maximum number of nested directories; root entries have depth zero. */
	readonly maximumDepth: number;
	/** Maximum visited entries, including directories and duplicate paths. */
	readonly maximumEntries: number;
	/** Maximum emitted files. */
	readonly maximumFiles: number;
	/** Maximum declared file bytes across emitted files; bodies remain unread. */
	readonly maximumBytes: number;
	/** Cancel pending metadata/enumeration delivery; underlying host operations may continue. */
	readonly signal?: AbortSignal;
	/** Observe actual iterator release, including an uncooperative pending host operation. */
	readonly onCleanup?: (completion: Promise<void>) => void;
}

/**
 * Walk depth first in authored order, yielding canonical relative paths and
 * borrowed file values. Already yielded files are partial output on later
 * failure. Reject path collisions and ancestor identity cycles. This owns only
 * iterators, never file bodies, handles, permissions or an operating-system picker.
 */
export async function* walk<Entry extends EntryType, Value extends FileValue>(
	roots: Iterable<Entry> | AsyncIterable<Entry>,
	adapter: EntryAdapterType<Entry, Value>,
	options: WalkOptionsType,
): AsyncIterableIterator<Readonly<{ path: string; file: Value }>> {
	const { maximumDepth, maximumEntries, maximumFiles, maximumBytes, signal } = options;
	for (const value of [maximumDepth, maximumEntries, maximumFiles, maximumBytes]) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('Directory walk bounds must be non-negative safe integers.');
		}
	}
	signal?.throwIfAborted();
	/** One iterator per ancestor; no eager sibling queue is retained. */
	const stack: { iterator: AsyncIterator<Entry>; prefix: string; depth: number; owner?: Entry }[] = [];
	const ancestors = new Set<Entry>();
	const paths = new Set<string>();
	let count = 0;
	let files = 0;
	let bytes = 0;
	let resolveCleanup!: () => void;
	let rejectCleanup!: (error: unknown) => void;
	const cleanup = new Promise<void>((resolve, reject) => {
		resolveCleanup = resolve;
		rejectCleanup = reject;
	});
	void cleanup.catch(() => {});
	/** Adapt synchronous entries while preserving their return ownership. */
	async function* iterate(source: Iterable<Entry> | AsyncIterable<Entry>): AsyncIterableIterator<Entry> {
		yield* source;
	}
	try {
		options.onCleanup?.(cleanup);
		stack.push({ iterator: iterate(roots), prefix: '', depth: 0 });
		while (stack.length > 0) {
			signal?.throwIfAborted();
			const frame = stack[stack.length - 1]!;
			const next = await pending.wait(frame.iterator.next(), signal);
			signal?.throwIfAborted();
			if (next.done) {
				stack.pop();
				if (frame.owner !== undefined) ancestors.delete(frame.owner);
				continue;
			}
			if (++count > maximumEntries) throw new RangeError('Directory walk exceeds maximumEntries.');
			const entry = next.value;
			const name = entry.name;
			if (!name || name === '.' || name === '..' || /[\\/]/u.test(name) || name.includes('\0')) {
				throw new TypeError('Directory entry is not a literal relative path component.');
			}
			const path = frame.prefix + name;
			if (paths.has(path)) throw new TypeError('Directory walk contains a duplicate relative path.');
			paths.add(path);
			if (entry.kind === 'directory') {
				if (frame.depth >= maximumDepth) throw new RangeError('Directory walk exceeds maximumDepth.');
				if (ancestors.has(entry)) throw new TypeError('Directory walk contains an ancestor cycle.');
				ancestors.add(entry);
				stack.push({
					iterator: iterate(adapter.children(entry)),
					prefix: path + '/',
					depth: frame.depth + 1,
					owner: entry,
				});
			} else if (entry.kind === 'file') {
				if (++files > maximumFiles) throw new RangeError('Directory walk exceeds maximumFiles.');
				const file = await pending.wait(adapter.file(entry), signal);
				signal?.throwIfAborted();
				if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maximumBytes - bytes) {
					throw new RangeError('Directory walk exceeds declared byte bounds.');
				}
				bytes += file.size;
				yield Object.freeze({ path, file });
			} else throw new TypeError('Unknown directory entry kind.');
		}
	} finally {
		// Request every ancestor release before joining; one stalled return must not prevent the others starting.
		const releases = stack.reverse().map((frame) => {
			try {
				return Promise.resolve(frame.iterator.return?.());
			} catch (error) {
				return Promise.reject(error);
			}
		});
		void Promise.allSettled(releases).then((outcomes) => {
			const errors = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
			if (errors.length > 0) rejectCleanup(new AggregateError(errors, 'Directory iterator cleanup failed.'));
			else resolveCleanup();
		});
	}
}
import * as pending from './pending.ts';

/** Metadata required for selection. Native File objects retain all their own methods through generic inference. */
export interface FileValue {
	/** Host-provided file name used for extension admission; it is not a trusted filesystem path. */
	readonly name: string;
	/** Non-negative safe integer byte size used for total selection limits. */
	readonly size: number;
	/** Declared MIME type, possibly empty; it does not prove the file body format. */
	readonly type: string;
	/** Optional host modification time in epoch milliseconds; selection does not rewrite it. */
	readonly lastModified?: number;
}

/** File admission policy; metadata checks do not establish that file contents are trustworthy. */
export interface Options {
	/** Maximum selected files; defaults to 128. */
	readonly maxCount?: number;
	/** Maximum total bytes represented by selection metadata; defaults to 256 MiB. Bodies are not read. */
	readonly maxBytes?: number;
	/** MIME types, type wildcards or extensions, e.g. ['image/*', '.csv']; defaults to any. */
	readonly accept?: readonly string[];
}

/** A selection exceeded a policy. The entire selection is rejected instead of silently dropping files. */
export class SelectionError extends RangeError {
	/** Which admission policy rejected the complete selection. */
	readonly reason: 'count' | 'bytes' | 'type';
	/** Rejected file metadata for size/type failure; absent when the count itself exceeded policy. */
	readonly file: FileValue | undefined;
	/** Keep machine-readable reason and optional rejected file. */
	constructor(reason: 'count' | 'bytes' | 'type', message: string, file?: FileValue) {
		super(message);
		this.name = 'SelectionError';
		this.reason = reason;
		this.file = file;
	}
}

/**
 * Snapshot a FileList, array-like mock, or iterable without reading file bodies.
 * File identities and their native types are preserved. Count and metadata bytes
 * are bounded before delivery; an input iterator is closed on rejection.
 */
export function from<Value extends FileValue>(
	source: Iterable<Value> | ArrayLike<Value> | null,
	options: Options = {},
): readonly Value[] {
	const maxCount = options.maxCount ?? 128, maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
	if (!Number.isSafeInteger(maxCount) || maxCount < 1 || !Number.isFinite(maxBytes) || maxBytes < 0) {
		throw new RangeError('File limits require a positive integer count and non-negative finite bytes.');
	}
	const accepted = options.accept?.map((value) => value.trim().toLowerCase());
	if (accepted?.some((value) => !value || !(value.startsWith('.') || /^[^/\s]+\/(?:[^/\s]+|\*)$/u.test(value)))) {
		throw new TypeError('File accept values must be extensions or MIME types.');
	}
	const values = source === null ? [] : Symbol.iterator in Object(source) ? source as Iterable<Value> : {
		*[Symbol.iterator]() {
			const list = source as ArrayLike<Value>;
			for (let index = 0; index < list.length; index++) yield list[index]!;
		},
	};
	const files: Value[] = [];
	let bytes = 0;
	for (const file of values) {
		if (files.length === maxCount) throw new SelectionError('count', 'File selection exceeds maxCount.');
		if (
			!targets.object(file) || typeof file.name !== 'string' || typeof file.type !== 'string' ||
			typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0
		) throw new TypeError('A selected file needs a name, type and non-negative safe integer byte size.');
		if (file.size > maxBytes - bytes) throw new SelectionError('bytes', 'File selection exceeds maxBytes.', file);
		if (
			accepted?.length &&
			!accepted.some((value) =>
				value.startsWith('.')
					? file.name.toLowerCase().endsWith(value)
					: value.endsWith('/*')
					? file.type.toLowerCase().startsWith(value.slice(0, -1))
					: file.type.toLowerCase() === value
			)
		) throw new SelectionError('type', `File ${file.name} does not match accept.`, file);
		bytes += file.size;
		files.push(file);
	}
	return files;
}

/** Borrowed selected files and their original event. */
export interface Selection<Value extends FileValue = FileValue, Event = unknown> {
	/** Detached list of original file objects; native methods and object identity remain available. */
	readonly files: readonly Value[];
	/** Original control-change or drop event, with native fields retained for a native target. */
	readonly event: Event;
}

/** A minimal native file-input replacement for embedded or test hosts. */
export interface Control<Value extends FileValue = FileValue> extends ListenerTarget {
	/** Current borrowed selection; null means no files were supplied. */
	readonly files: ArrayLike<Value> | null;
}

/** Listener lifetime and failure policy shared by control and drop collection. */
export interface ListenOptions extends Options {
	/** Abort stops this acquisition or listener lifetime; native picker dialogs may remain open. */
	readonly signal?: AbortSignal;
	/** Report selection-policy and callback failures without silently discarding files. */
	readonly onError?: ErrorReporter;
}

/** Observe the files chosen in a native HTML file control, preserving File and Event types. */
export function listen(
	control: Native<'HTMLInputElement'>,
	selected: (selection: Selection<Native<'File', FileValue>, Native<'Event'>>) => unknown,
	options?: ListenOptions,
): BindingHandle;
/** Observe a small file control with its exact file value type. */
export function listen<Value extends FileValue>(
	control: Control<Value>,
	selected: (selection: Selection<Value>) => unknown,
	options?: ListenOptions,
): BindingHandle;
/** Attach only a change listener. The control, files and their contents remain caller-owned. */
export function listen<Value extends FileValue, Event>(
	control: Control<Value>,
	selected: (selection: Selection<Value, Event>) => unknown,
	options: ListenOptions = {},
): BindingHandle {
	from([], options);
	const owner = ownership.create(options.signal);
	try {
		owner.listen(
			control,
			'change',
			(event) =>
				callback.call(
					() => selected({ files: from(control.files, options), event: event as Event }),
					undefined,
					options.onError,
				),
		);
	} catch (error) {
		ownership.fail(owner, error);
	}
	return owner.handle;
}

/** Picker file handles supply their current File snapshot without transferring a live file stream. */
export interface FileHandle<Value extends FileValue = FileValue> {
	/** Resolve current file metadata/content access without opening a body reader here. */
	getFile(): PromiseLike<Value>;
}

/** Native File System Access picker request; browsers without it can use a standard file control with listen(). */
export interface PickerOptions {
	/** Ask the native picker to allow several selections; defaults to false. */
	readonly multiple?: boolean;
	/** Ask the native picker to hide its unrestricted file-type choice when supported. */
	readonly excludeAcceptAllOption?: boolean;
	/** Optional host picker identity for retaining its own recent-location policy. */
	readonly id?: string;
	/** Native picker MIME/extension filters; these are separate from post-selection accept validation. */
	readonly types?: readonly {
		readonly description?: string;
		readonly accept: Readonly<Record<string, readonly string[]>>;
	}[];
}

/** Explicit picker capability. Merely importing Input never opens a browser dialog. */
export interface Picker<Value extends FileValue = FileValue> {
	/** Open the host picker during caller-owned user activation; native denial/cancellation rejects. */
	showOpenFilePicker?(options?: PickerOptions): PromiseLike<readonly FileHandle<Value>[]>;
}

/** Picker options plus selection policies and cancellation of result delivery. */
export interface PickOptions extends Options, PickerOptions {
	/** Abort stops this acquisition or listener lifetime; native picker dialogs may remain open. */
	readonly signal?: AbortSignal;
}

/**
 * Open a supplied picker during the application's user activation. Host denial
 * and cancellation errors are preserved. Abort stops waiting and late delivery;
 * it cannot promise to dismiss the operating-system picker. No fallback dialog
 * is opened implicitly when the host lacks this optional API.
 */
export function pick(
	host: Native<'Window'>,
	options?: PickOptions,
): Promise<readonly Native<'File', FileValue>[]>;
/** Preserve the exact file type returned by an explicit picker capability. */
export function pick<Value extends FileValue>(
	host: Picker<Value>,
	options?: PickOptions,
): Promise<readonly Value[]>;
export async function pick<Value extends FileValue>(
	host: Picker<Value> | Native<'Window'>,
	options: PickOptions = {},
): Promise<readonly Value[]> {
	options.signal?.throwIfAborted();
	from([], options);
	const open: unknown = Reflect.get(host, 'showOpenFilePicker');
	if (typeof open !== 'function') {
		throw new TypeError('This host has no file picker; use a file input with files.listen().');
	}
	const { multiple = false, excludeAcceptAllOption, id, types } = options;
	const handles = await pending.wait(
		Reflect.apply(open, host, [{ multiple, excludeAcceptAllOption, id, types }]) as PromiseLike<
			readonly FileHandle<Value>[]
		>,
		options.signal,
	);
	const maxCount = options.maxCount ?? 128;
	if (handles.length > maxCount) throw new SelectionError('count', 'File selection exceeds maxCount.');
	const files: Value[] = [];
	for (const handle of handles) {
		options.signal?.throwIfAborted();
		files.push(await pending.wait(handle.getFile(), options.signal));
	}
	return from(files, options);
}

/** Extra drop feedback. Native scrolling and other drag types remain untouched. */
export interface DropOptions extends ListenOptions {
	/** True while an external file drag is over this target; terminal cleanup reports false once. */
	readonly hover?: (active: boolean) => unknown;
}

/**
 * Claim only file drags. Snapshot files inside the drop handler before the native
 * data store becomes protected. Hover is reference-counted for nested targets;
 * abort and disposal remove all listeners and release active feedback.
 */
export function drop<Target extends ListenerTarget>(
	target: Target,
	selected: (
		selection: Selection<
			Target extends NativeTarget ? Native<'File', FileValue> : FileValue,
			HostEvent<Target, 'DragEvent', unknown>
		>,
	) => unknown,
	options: DropOptions = {},
): BindingHandle {
	type Value = Target extends NativeTarget ? Native<'File', FileValue> : FileValue;
	type Event = HostEvent<Target, 'DragEvent', unknown>;
	from([], options);
	const owner = ownership.create(options.signal);
	let depth = 0;
	const hover = (active: boolean) => {
		if (options.hover) callback.call(options.hover, active, options.onError);
	};
	const clear = () => {
		if (depth > 0) {
			depth = 0;
			hover(false);
		}
	};
	owner.defer(clear);
	const transfer = (event: unknown) =>
		targets.object(event) && targets.object(event.dataTransfer) ? event.dataTransfer : undefined;
	const isFiles = (event: unknown) => {
		const types = transfer(event)?.types;
		if (!targets.object(types) || typeof types.length !== 'number') return false;
		for (let index = 0; index < Math.min(types.length, 128); index++) if (types[index] === 'Files') return true;
		return false;
	};
	const claim = (event: unknown) => {
		if (targets.object(event) && typeof event.preventDefault === 'function') {
			Reflect.apply(event.preventDefault, event, []);
		}
	};
	try {
		owner.listen(target, 'dragenter', (event) => {
			if (isFiles(event) && depth++ === 0) hover(true);
		});
		owner.listen(target, 'dragover', (event) => {
			if (isFiles(event)) claim(event);
		});
		owner.listen(target, 'dragleave', () => {
			if (depth > 0 && --depth === 0) hover(false);
		});
		owner.listen(target, 'drop', (event) => {
			const input = transfer(event);
			clear();
			if (!input || !isFiles(event)) return;
			claim(event);
			callback.call(
				() =>
					selected({ files: from((input.files ?? null) as ArrayLike<Value> | null, options), event: event as Event }),
				undefined,
				options.onError,
			);
		});
	} catch (error) {
		ownership.fail(owner, error);
	}
	return owner.handle;
}
