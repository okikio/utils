/** Explicit clipboard access and synchronous user-paste snapshots. @module */
import type { BindingHandle, ErrorReporter, HostEvent, ListenerTarget, Native, NativeTarget } from './types.ts';
import type { FileValue, Options as FileOptions } from './files.ts';
import * as files from './files.ts';
import * as ownership from './ownership.ts';
import * as callback from './callback.ts';
import * as pending from './pending.ts';
import * as targets from './targets.ts';

/** Bounded MIME selection never reads a Blob or prompts for clipboard permission. */
export interface SelectOptionsType {
	/** Ordered preferred MIME types; the first offered preference wins per item. */
	readonly preferredTypes: readonly string[];
	/** Maximum clipboard items inspected. */
	readonly maximumItems: number;
	/** Maximum offered types inspected per item and maximum authored preferences. */
	readonly maximumTypes: number;
}

/** Select one representation per item, retaining exact borrowed item identities and input order. */
export function select<Value extends Item>(
	items: readonly Value[],
	options: SelectOptionsType,
): readonly Readonly<{ item: Value; type: string }>[] {
	const { maximumItems, maximumTypes } = options;
	if (
		!Number.isSafeInteger(maximumItems) || maximumItems < 0 || !Number.isSafeInteger(maximumTypes) || maximumTypes < 1
	) throw new RangeError('Invalid clipboard selection bounds.');
	if (items.length > maximumItems || options.preferredTypes.length > maximumTypes) {
		throw new RangeError('Clipboard selection exceeds its bounds.');
	}
	const preferences = [...options.preferredTypes];
	if (preferences.some((type) => !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(type))) {
		throw new TypeError('Clipboard preferences require literal lowercase MIME types.');
	}
	const selected: Readonly<{ item: Value; type: string }>[] = [];
	for (const item of items) {
		if (item.types.length > maximumTypes) throw new RangeError('Clipboard item exceeds maximumTypes.');
		const offered = new Set(item.types);
		const type = preferences.find((preference) => offered.has(preference));
		if (type !== undefined) selected.push(Object.freeze({ item, type }));
	}
	return Object.freeze(selected);
}

/** Capability outcomes describe one explicit read attempt; faults retain the original error. */
export type ReadOutcomeType<Value extends Item> =
	| Readonly<{ status: 'read'; items: readonly Value[] }>
	| Readonly<{ status: 'unsupported' }>
	| Readonly<{ status: 'denied' | 'failed'; error: unknown }>;

/** Bound detached results before copying. The host still owns its initial allocation. */
export interface AttemptOptionsType extends Options {
	/** Maximum returned items accepted by this read attempt. */
	readonly maximumItems: number;
}

/**
 * Attempt rich clipboard access once during caller-owned activation. No permission
 * probe, fallback or retry is performed. Abort propagates rather than becoming an
 * access result, and cannot cancel the host's underlying read operation.
 */
export async function attempt<Value extends Item>(
	host: Host<Value>,
	options: AttemptOptionsType,
): Promise<ReadOutcomeType<Value>> {
	if (!Number.isSafeInteger(options.maximumItems) || options.maximumItems < 0) {
		throw new RangeError('Clipboard maximumItems must be a non-negative safe integer.');
	}
	options.signal?.throwIfAborted();
	if (typeof host.read !== 'function') return Object.freeze({ status: 'unsupported' });
	try {
		const items = await pending.wait(host.read(), options.signal);
		if (items.length > options.maximumItems) throw new RangeError('Clipboard read exceeds maximumItems.');
		return Object.freeze({ status: 'read', items: Object.freeze([...items]) });
	} catch (error) {
		options.signal?.throwIfAborted();
		return Object.freeze({
			status: error instanceof Error && error.name === 'NotAllowedError' ? 'denied' : 'failed',
			error,
		});
	}
}

/** Clipboard item retains the host's native Blob and MIME-type operations. */
export interface Item {
	/** MIME types offered by this native clipboard item. */
	readonly types: readonly string[];
	/** Read one offered MIME representation; unavailable formats retain the host rejection. */
	getType(type: string): Promise<Blob>;
}

/** Supply navigator.clipboard or a focused mock. No operation probes permissions or prompts on import. */
export interface Host<Value extends Item = Item> {
	/** Read plain text under the host permission and activation rules. */
	readText?(): PromiseLike<string>;
	/** Replace clipboard text; the caller decides when user intent authorizes the operation. */
	writeText?(value: string): PromiseLike<void>;
	/** Read rich items without eagerly decoding or selecting their formats. */
	read?(): PromiseLike<readonly Value[]>;
	/** Write caller-created rich items; accepted formats remain a host capability. */
	write?(values: Value[]): PromiseLike<void>;
}

/** Abort stops delivery, while the host may still finish its non-cancellable clipboard operation. */
export interface Options {
	/** Stop waiting for delivery on abort; this cannot undo an accepted write. */
	readonly signal?: AbortSignal;
}

/** Read plain text through the supplied clipboard capability and preserve original permission failures. */
export async function read(host: Host, options: Options = {}): Promise<string> {
	options.signal?.throwIfAborted();
	if (typeof host.readText !== 'function') throw new TypeError('This host cannot read clipboard text.');
	return await pending.wait(host.readText(), options.signal);
}

/** Read native rich clipboard items without selecting or decoding a MIME type. */
export async function readItems<Value extends Item>(
	host: Host<Value>,
	options: Options = {},
): Promise<readonly Value[]> {
	options.signal?.throwIfAborted();
	if (typeof host.read !== 'function') throw new TypeError('This host cannot read rich clipboard items.');
	return await pending.wait(host.read(), options.signal).then((values) => [...values]);
}

/**
 * Write text or caller-created rich items. The application calls this during any
 * required user activation. An abort stops waiting; it cannot undo a host write.
 * Native denial/error objects are preserved rather than converted to false.
 */
export async function write<Value extends Item>(
	host: Host<Value>,
	value: string | readonly Value[],
	options: Options = {},
): Promise<void> {
	options.signal?.throwIfAborted();
	if (typeof value === 'string') {
		if (typeof host.writeText !== 'function') throw new TypeError('This host cannot write clipboard text.');
		return await pending.wait(host.writeText(value), options.signal);
	}
	if (typeof host.write !== 'function') throw new TypeError('This host cannot write rich clipboard items.');
	return await pending.wait(host.write([...value]), options.signal);
}

/** Paste values copied while their event data store is readable. HTML is untrusted, unparsed source. */
export interface Paste<Event = unknown, Value extends FileValue = FileValue> {
	/** Plain-text representation copied during event dispatch, or an empty string when absent. */
	readonly text: string;
	/** Untrusted HTML source copied during dispatch; Input does not parse or insert it. */
	readonly html: string;
	/** Original file references snapshotted while the paste store is readable. */
	readonly files: readonly Value[];
	/** Original paste event; native targets keep ClipboardEvent metadata. */
	readonly event: Event;
}

/** Event-based paste policy, distinct from permission-controlled asynchronous clipboard reads. */
export interface ListenOptions extends Options, FileOptions {
	/** Claim the native paste only when the application owns insertion; defaults to false. */
	readonly preventDefault?: boolean;
	/** Report snapshot or callback failures, including returned Promise rejections. */
	readonly onError?: ErrorReporter;
}

/** Snapshot text/HTML/files synchronously; returned Promise callbacks never read a stale native data store. */
export function listen<Target extends ListenerTarget>(
	target: Target,
	pasted: (
		paste: Paste<
			HostEvent<Target, 'ClipboardEvent', unknown>,
			Target extends NativeTarget ? Native<'File', FileValue> : FileValue
		>,
	) => unknown,
	options: ListenOptions = {},
): BindingHandle {
	type Event = HostEvent<Target, 'ClipboardEvent', unknown>;
	type Value = Target extends NativeTarget ? Native<'File', FileValue> : FileValue;
	const owner = ownership.create(options.signal);
	try {
		owner.listen(target, 'paste', (event) => {
			if (!targets.object(event) || !targets.object(event.clipboardData)) return;
			const transfer = event.clipboardData;
			callback.call(
				() => {
					const get = (type: string) =>
						typeof transfer.getData === 'function' ? String(Reflect.apply(transfer.getData, transfer, [type])) : '';
					const sample: Paste<Event, Value> = {
						text: get('text/plain'),
						html: get('text/html'),
						files: files.from((transfer.files ?? null) as ArrayLike<Value> | null, options),
						event: event as Event,
					};
					if (options.preventDefault && typeof event.preventDefault === 'function') {
						Reflect.apply(event.preventDefault, event, []);
					}
					return pasted(sample);
				},
				undefined,
				options.onError,
			);
		});
	} catch (error) {
		ownership.fail(owner, error);
	}
	return owner.handle;
}
