/** Read text values and observe committed edits, including IME composition. @module */
import type { Observable } from '@okikio/observables/observable';
import type { BindingHandle, ErrorReporter, HostEvent, ListenerTarget } from './types.ts';
import * as ownership from './ownership.ts';
import * as callback from './callback.ts';
import * as sources from './observe.ts';
import * as targets from './targets.ts';

/** A small editable surface can supply value or textContent without implementing a DOM element. */
export interface TextTarget extends ListenerTarget {
	/** Current control string; preferred over textContent when both are supplied. */
	readonly value?: string;
	/** Plain content fallback for editable elements; null reads as the empty string. */
	readonly textContent?: string | null;
}

/** Editing metadata consumed from native input events or structural mocks. */
export interface TextEvent {
	/** Original event name, such as input, change or compositionend. */
	readonly type?: string;
	/** Optional native editing intention, such as insertText or insertFromPaste. */
	readonly inputType?: string;
	/** Optional inserted text; null can represent an edit that inserts no text. */
	readonly data?: string | null;
	/** True during an unfinished IME composition; committed mode withholds this value. */
	readonly isComposing?: boolean;
}

/** One changed value; the original event remains borrowed and no event history is retained. */
export interface Change<Event = TextEvent> {
	/** Current string read after this edit; this is not a key or an incremental text patch. */
	readonly value: string;
	/** Last value announced to this listener, or the initial value before its first change. */
	readonly previous: string;
	/** True only for explicitly requested intermediate composition notifications. */
	readonly composing: boolean;
	/** Native editing intention when the host supplied one; undefined for a basic change event. */
	readonly inputType: string | undefined;
	/** Native insertion metadata, distinct from the full current value. */
	readonly data: string | null | undefined;
	/** Original input, change or composition-completion event; retained without copying host fields. */
	readonly event: Event;
}

/** Text collection policy. Reading an unfamiliar editor's model is an explicit capability. */
export interface Options<Target = TextTarget> {
	/** Abort removes this text listener lifetime; it does not mutate or close the editor. */
	readonly signal?: AbortSignal;
	/** Receive committed text by default, or each intermediate IME value with 'include'. */
	readonly composition?: 'committed' | 'include';
	/** Use input for live changes or change for the native control's commit event. Defaults to input. */
	readonly event?: 'input' | 'change';
	/** Read a custom editor model. Defaults to value, then textContent; missing capabilities throw. */
	readonly read?: (target: Target) => string;
	/** Receive reader and callback failures; a failed reader closes the binding before reporting. */
	readonly onError?: ErrorReporter;
}

/** Read a current text value without attaching listeners or synthesizing input events. */
export function read(target: { readonly value?: string; readonly textContent?: string | null }): string {
	if (typeof target.value === 'string') return target.value;
	if (typeof target.textContent === 'string') return target.textContent;
	if (target.textContent === null) return '';
	throw new TypeError('Text collection needs value, textContent, or an explicit read callback.');
}

/** Native plain-text editing capability. Contenteditable models require their own adapter. */
export interface EditTargetType {
	/** Current UTF-16 text, borrowed until the synchronous edit begins. */
	readonly value: string;
	/** A read-only target blocks editing. */
	readonly readOnly?: boolean;
	/** Disabled controls are not edited. */
	readonly disabled?: boolean;
	/** Native range mutation and selection policy; this operation owns no undo stack. */
	setRangeText?(
		replacement: string,
		start: number,
		end: number,
		selectionMode: 'select' | 'start' | 'end' | 'preserve',
	): void;
}

/** Explicit composition authority and copy budget for one synchronous edit. */
export interface EditOptionsType {
	/** Current host/editor composition state; the caller owns keeping it current. */
	readonly composing: boolean;
	/** Reject active composition by default; allow only with deliberate editor policy. */
	readonly composition?: 'reject' | 'allow';
	/** Native selection behavior after replacement. */
	readonly selection: 'select' | 'start' | 'end' | 'preserve';
	/** Maximum resulting UTF-16 code units, checked before mutation. */
	readonly maximumLength: number;
}

/**
 * Edit a native text range in UTF-16 code units, rejecting split surrogate pairs.
 * Grapheme boundaries remain caller policy. This does not synthesize beforeinput,
 * input or change events, focus a control, or guarantee browser undo behavior.
 */
export function edit(
	target: EditTargetType,
	range: Readonly<{ start: number; end: number }>,
	replacement: string,
	options: EditOptionsType,
): Readonly<{ status: 'edited' | 'unsupported' | 'blocked' }> {
	if (typeof target.setRangeText !== 'function') return Object.freeze({ status: 'unsupported' });
	if (target.readOnly || target.disabled || options.composing && options.composition !== 'allow') {
		return Object.freeze({ status: 'blocked' });
	}
	const text = target.value;
	if (
		!Number.isSafeInteger(options.maximumLength) || options.maximumLength < 0 || !Number.isSafeInteger(range.start) ||
		!Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || range.end > text.length
	) throw new RangeError('Invalid text edit range or bound.');
	if (!['select', 'start', 'end', 'preserve'].includes(options.selection)) {
		throw new TypeError('Unknown text selection policy.');
	}
	/** A boundary between a leading and trailing surrogate would corrupt one code point. */
	const split = (index: number): boolean =>
		index > 0 && index < text.length && /[\uD800-\uDBFF]/u.test(text[index - 1]!) &&
		/[\uDC00-\uDFFF]/u.test(text[index]!);
	if (split(range.start) || split(range.end)) throw new RangeError('Text range splits a surrogate pair.');
	if (text.length - (range.end - range.start) + replacement.length > options.maximumLength) {
		throw new RangeError('Text edit exceeds maximumLength.');
	}
	try {
		target.setRangeText(replacement, range.start, range.end, options.selection);
	} catch (error) {
		if (error instanceof Error && (error.name === 'InvalidStateError' || error.name === 'NotSupportedError')) {
			return Object.freeze({ status: 'unsupported' });
		}
		throw error;
	}
	return Object.freeze({ status: 'edited' });
}

/**
 * Observe changed text and own only the required listeners. The initial value is
 * read but not emitted. Composition completion and a following final input with
 * the same value produce one notification. Assigning target.value does not emit.
 * A later reader failure closes the binding and reaches onError, or throws when
 * no reporter is supplied. Initial reader failures throw before acquiring listeners.
 */
export function listen<Target extends TextTarget>(
	target: Target,
	change: (value: Change<HostEvent<Target, 'Event', TextEvent>>) => unknown,
	options: Options<Target> = {},
): BindingHandle {
	type Event = HostEvent<Target, 'Event', TextEvent>;
	const owner = ownership.create(options.signal);
	if (owner.handle.closed) return owner.handle;
	/** Read through the selected host capability and reject malformed values before notifying the application. */
	const get = () => {
		const value = options.read ? options.read(target) : read(target);
		if (typeof value !== 'string') throw new TypeError('A text reader must return a string.');
		return value;
	};
	let previous: string;
	try {
		previous = get();
	} catch (error) {
		ownership.fail(owner, error);
	}
	// Input methods can edit a provisional value before the user commits it.
	// Track composition across events so consumers do not save each provisional edit.
	let composing = false;
	/** Read one committed change and publish it once; a failed read closes this binding before reporting. */
	const publish = (event: unknown) => {
		if (owner.handle.closed) return;
		const metadata = targets.object(event) ? event : {};
		const active = composing || metadata.isComposing === true;
		if (active && options.composition !== 'include') return;
		let value: string;
		try {
			value = get();
		} catch (error) {
			let failure = error;
			try {
				owner.handle();
			} catch (cleanup) {
				failure = new AggregateError([error, cleanup], 'Text reader and cleanup failed.');
			}
			if (options.onError) callback.report(failure, options.onError);
			else throw failure;
			return;
		}
		if (owner.handle.closed) return;
		if (value === previous) return;
		const sample: Change<Event> = {
			value,
			previous,
			composing: active,
			event: event as Event,
			inputType: typeof metadata.inputType === 'string' ? metadata.inputType : undefined,
			data: typeof metadata.data === 'string' || metadata.data === null ? metadata.data : undefined,
		};
		// Commit before delivery so reentrant input dispatch cannot publish this same value twice.
		previous = value;
		callback.call(change, sample, options.onError);
	};
	try {
		owner.listen(target, 'compositionstart', () => {
			composing = true;
		});
		owner.listen(target, 'compositionend', (event) => {
			composing = false;
			if ((options.event ?? 'input') === 'input') publish(event);
		});
		owner.listen(target, options.event ?? 'input', publish);
	} catch (error) {
		ownership.fail(owner, error);
	}
	return owner.handle;
}

/** Create a cold text source. Each subscription owns listeners and completes when the supplied signal aborts. */
export function observe<Target extends TextTarget>(
	target: Target,
	options: Omit<Options<Target>, 'onError'> = {},
): Observable<Change<HostEvent<Target, 'Event', TextEvent>>> {
	return sources.from((next, error) => listen(target, next, { ...options, onError: error }), options.signal);
}
