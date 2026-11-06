/** Scoped, typed keyboard commands with bounded sequences and explicit listener ownership. @module */
import type { BindingHandle, ErrorReporter, HostEvent, KeyEvent, ListenerTarget } from './types.ts';
import * as ownership from './ownership.ts';
import * as targets from './targets.ts';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as callback from './callback.ts';

/** Exact modifier policy for one key in a sequence. Omitted modifiers must be released. */
export interface Modifiers {
	/** Match either Ctrl or Meta as the platform command modifier. */
	readonly mod?: boolean;
	/** Require this exact Ctrl state; cannot be combined with the mod shorthand. */
	readonly control?: boolean;
	/** Require this exact Meta state; cannot be combined with the mod shorthand. */
	readonly meta?: boolean;
	/** Require Alt when true; omitted means Alt must be released. */
	readonly alt?: boolean;
	/** Require Shift when true; omitted means Shift must be released. */
	readonly shift?: boolean;
}

/** Choose a logical key or a physical code, with an exact modifier combination. */
export type Stroke =
	& Modifiers
	& (
		| Readonly<{ key: string; code?: never }>
		| Readonly<{ code: string; key?: never }>
	);

/** Shared options for a command's shortcut. */
export interface BindingOptions<Event extends KeyEvent = KeyEvent> {
	/** Application action. A command/catalog is optional; returned Promise failures reach onError. */
	readonly run: (event: Event) => unknown;
	/** Dynamic eligibility checked before the event is claimed; defaults to true. */
	readonly enabled?: (event: Event) => boolean;
	/** Optional description used in collision messages and shortcut help. */
	readonly label?: string;
	/** Active scope name; defaults to global. Scope order outranks numeric priority. */
	readonly scope?: string;
	/** Larger numbers win within one scope; defaults to zero. */
	readonly priority?: number;
	/** Permit held-key repeats; defaults to false. */
	readonly repeat?: boolean;
	/** Explicitly allow this binding in editable controls; defaults to false. */
	readonly editable?: boolean;
}

/** One shortcut or a sequence of up to eight strokes. A key string can also contain space-separated keys. */
export type Binding<Event extends KeyEvent = KeyEvent> =
	& BindingOptions<Event>
	& (
		| Stroke
		| Readonly<{ sequence: readonly Stroke[]; key?: never; code?: never }>
	);

/** Keyboard owner configuration. */
export interface Options {
	/** Abort removes every listener and sequence timer owned by this call. */
	readonly signal?: AbortSignal;
	/** Active scopes, highest priority first; defaults to ['global']. */
	readonly scopes?: () => readonly string[];
	/** Time allowed between strokes, from 1 to 60000 ms; defaults to 900. */
	readonly sequenceMs?: number;
	/** Capture phase is opt-in. */
	readonly capture?: boolean;
	/** Optional explicit modal policy for hosts without a queryable document. */
	readonly modal?: () => boolean;
	/** Maximum authored bindings admitted by this owner; defaults to 1024. */
	readonly capacity?: number;
	/** Receive synchronous or asynchronous action failures; omitted reporters use normal host error reporting. */
	readonly onError?: ErrorReporter;
}

/** Internal normalized shortcut; authored definitions and stroke arrays are snapshotted once. */
interface Prepared<Event extends KeyEvent> {
	readonly run: (event: Event) => unknown;
	readonly enabled?: (event: Event) => boolean;
	readonly label: string;
	readonly strokes: readonly Stroke[];
	readonly scope: string;
	readonly priority: number;
	readonly repeat: boolean;
	readonly editable: boolean;
}

export { editing } from './targets.ts';

/** Own scoped key matching without assuming a global Element, Window or document. */
export function listen<Target extends ListenerTarget>(
	target: Target,
	bindings: readonly Binding<HostEvent<Target, 'KeyboardEvent', KeyEvent>>[],
	options: Options = {},
): BindingHandle {
	type Event = HostEvent<Target, 'KeyboardEvent', KeyEvent>;
	const timeout = options.sequenceMs ?? 900;
	if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000) {
		throw new RangeError('Key sequence timeout must be between 1 and 60000 ms.');
	}
	const capacity = options.capacity ?? 1024;
	if (!Number.isSafeInteger(capacity) || capacity < 1 || bindings.length > capacity) {
		throw new RangeError('Keyboard bindings exceed the configured capacity.');
	}
	const prepared = bindings.map(prepare);
	assertCollisions(prepared);
	const owner = ownership.create(options.signal);
	let pending: readonly Prepared<Event>[] = [];
	let position = 0;
	let activeScopes = '';
	let timer: ReturnType<typeof setTimeout> | undefined;

	/** End one partial sequence without disturbing the listener lifetime. */
	const clear = (): void => {
		pending = [];
		position = 0;
		clearTimeout(timer);
		timer = undefined;
	};
	owner.defer(clear);

	/** Admit a keystroke only after checking native ownership, scope and dynamic command eligibility. */
	const keydown = (value: unknown): void => {
		if (!isKeyEvent(value) || owner.handle.closed) return;
		const event = value as Event;
		if (event.defaultPrevented || event.isComposing) {
			clear();
			return;
		}
		const scopes = options.scopes?.() ?? ['global'];
		const scopeKey = JSON.stringify(scopes);
		if (scopeKey !== activeScopes) {
			clear();
			activeScopes = scopeKey;
		}
		const editing = targets.path(event).some(targets.editing);
		const modal = options.modal?.() ?? targets.modal(target);
		const available = (binding: Prepared<Event>): boolean =>
			scopes.includes(binding.scope) &&
			(!modal || binding.scope !== 'global') && (!editing || binding.editable) &&
			(!event.repeat || binding.repeat) && binding.enabled?.(event) !== false;
		const ordered = (left: Prepared<Event>, right: Prepared<Event>): number =>
			scopes.indexOf(left.scope) - scopes.indexOf(right.scope) || right.priority - left.priority;
		// A suffix mismatch may begin another shortcut. Only admitted matches claim the native event below.
		let matches = pending.filter((binding) => available(binding) && match(binding.strokes[position]!, event)).sort(
			ordered,
		);
		let next = position + 1;
		if (matches.length === 0) {
			clear();
			matches = prepared.filter((binding) => available(binding) && match(binding.strokes[0]!, event)).sort(ordered);
			next = 1;
		}
		clear();
		const chosen = matches[0];
		if (chosen === undefined) return;
		event.preventDefault();
		if (chosen.strokes.length === next) {
			callback.call(chosen.run, event, options.onError);
			return;
		}
		// Higher scope/priority ownership is fixed for this prefix; lower scopes cannot steal its suffix.
		pending = matches.filter((binding) => binding.scope === chosen.scope && binding.priority === chosen.priority);
		position = next;
		timer = setTimeout(clear, timeout);
	};

	try {
		owner.listen(target, 'keydown', keydown, { capture: options.capture ?? false });
		owner.listen(target, 'compositionstart', clear);
		owner.listen(target, 'blur', clear);
		owner.listen(target, 'focusout', clear);
	} catch (error) {
		try {
			owner.handle();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], 'Keyboard setup and cleanup failed.');
		}
		throw error;
	}
	return owner.handle;
}

/** Normalize only the logical key spelling; physical KeyboardEvent.code remains case sensitive. */
function logical(value: string): string {
	return value === ' ' ? 'space' : value.toLowerCase();
}

/** Snapshot and validate a shortcut before installing any listeners. */
function prepare<Event extends KeyEvent>(binding: Binding<Event>): Prepared<Event> {
	if (typeof binding.run !== 'function') throw new TypeError('A keyboard binding needs a run callback.');
	const source = 'sequence' in binding ? binding.sequence : [binding];
	if (source === undefined || source.length === 0 || source.length > 8) {
		throw new RangeError('A shortcut needs between one and eight strokes.');
	}
	const strokes = source.flatMap((stroke) => {
		if (stroke.mod !== undefined && (stroke.control !== undefined || stroke.meta !== undefined)) {
			throw new TypeError('Choose mod or explicit control/meta modifiers.');
		}
		const hasKey = typeof stroke.key === 'string';
		if (hasKey === (typeof stroke.code === 'string')) throw new TypeError('A stroke needs exactly one key or code.');
		const text = hasKey ? stroke.key! : stroke.code!;
		const tokens = text === ' ' ? [' '] : text.trim().split(/\s+/u);
		if (tokens.some((token) => token.length === 0)) throw new TypeError('A key or code cannot be empty.');
		return tokens.map((token): Stroke =>
			Object.freeze({
				...(hasKey ? { key: logical(token) } : { code: token }),
				...(stroke.mod === undefined ? {} : { mod: stroke.mod }),
				...(stroke.control === undefined ? {} : { control: stroke.control }),
				...(stroke.meta === undefined ? {} : { meta: stroke.meta }),
				alt: stroke.alt ?? false,
				shift: stroke.shift ?? false,
			})
		);
	});
	if (strokes.length > 8) throw new RangeError('A shortcut cannot exceed eight strokes.');
	const priority = binding.priority ?? 0;
	if (!Number.isFinite(priority)) throw new RangeError('Shortcut priority must be finite.');
	const scope = binding.scope ?? 'global';
	if (typeof scope !== 'string' || scope.trim().length === 0) throw new TypeError('A shortcut scope cannot be empty.');
	return {
		run: binding.run,
		enabled: binding.enabled,
		label: binding.label ?? strokes.map((stroke) => stroke.key ?? stroke.code).join(' '),
		strokes,
		scope,
		priority,
		repeat: binding.repeat ?? false,
		editable: binding.editable ?? false,
	};
}

/** Reject equal-priority collisions and unreachable prefix commands within one scope. */
function assertCollisions<Event extends KeyEvent>(bindings: readonly Prepared<Event>[]): void {
	for (let index = 0; index < bindings.length; index++) {
		const left = bindings[index]!;
		for (const right of bindings.slice(index + 1)) {
			if (left.scope !== right.scope || left.priority !== right.priority) continue;
			const count = Math.min(left.strokes.length, right.strokes.length);
			if (left.strokes.slice(0, count).every((stroke, i) => overlaps(stroke, right.strokes[i]!))) {
				throw new TypeError(`Shortcut collision between ${left.label} and ${right.label}.`);
			}
		}
	}
}

/** Compare modifier sets rather than authored spelling; mod:true overlaps explicit Ctrl and Meta bindings. */
function overlaps(left: Stroke, right: Stroke): boolean {
	if (left.key !== right.key || left.code !== right.code) return false;
	return modifiersOverlap(left, right);
}

/** Modifier overlap is independent of whether the host resolves a logical key or a physical code. */
function modifiersOverlap(left: Modifiers, right: Modifiers): boolean {
	if (!!left.alt !== !!right.alt || !!left.shift !== !!right.shift) return false;
	// Each bit represents one Ctrl/Meta state; mod:true accepts Ctrl, Meta, or both, excluding neither.
	const mask = (stroke: Modifiers): number =>
		stroke.mod === true ? 0b1110 : stroke.mod === false ? 1 : 1 << ((stroke.control ? 1 : 0) | (stroke.meta ? 2 : 0));
	return (mask(left) & mask(right)) !== 0;
}

/** Match exact modifier ownership so a shortcut never consumes an unadvertised Alt/Shift chord. */
function match(stroke: Stroke, event: KeyEvent): boolean {
	if ('key' in stroke && stroke.key !== undefined ? logical(event.key) !== stroke.key : event.code !== stroke.code) {
		return false;
	}
	if (!!event.altKey !== !!stroke.alt || !!event.shiftKey !== !!stroke.shift) return false;
	if (stroke.mod !== undefined) return (Boolean(event.ctrlKey) || Boolean(event.metaKey)) === stroke.mod;
	return !!event.ctrlKey === !!stroke.control && !!event.metaKey === !!stroke.meta;
}

/** Structural admission permits cross-realm KeyboardEvent objects and small host mocks. */
function isKeyEvent(value: unknown): value is KeyEvent {
	return targets.object(value) && typeof value.key === 'string' && typeof value.preventDefault === 'function';
}

/** Index-based evidence excludes live callbacks and target state. */
export interface ConflictType {
	readonly left: number;
	readonly right: number;
	/** Layout means a physical-code/logical-key pair can overlap on a host layout; it is not a proven collision. */
	readonly kind: 'equal' | 'prefix' | 'layout';
	readonly scope: string;
	readonly priority: number;
}
/**
 * Inspect normalized shortcut pairs without listeners or enabled callbacks. Exact scopes and equal
 * priorities share the listener's collision rules. Cross key/code pairs are possible layout conflicts,
 * not proof of a particular keyboard mapping. Different scopes/priorities retain ordinary precedence.
 * A capped report is incomplete and cannot establish collision freedom. Work is bounded by comparisons.
 */
export function conflicts<Event extends KeyEvent>(
	bindings: readonly Binding<Event>[],
	options: Readonly<
		{
			readonly maximumBindings: number;
			readonly maximumConflicts: number;
			readonly maximumComparisons: number;
			readonly includeLayout?: boolean;
		}
	>,
): Readonly<{ readonly conflicts: readonly ConflictType[]; readonly capped: boolean; readonly comparisons: number }> {
	for (const value of [options.maximumBindings, options.maximumConflicts, options.maximumComparisons]) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('Shortcut inspection requires nonnegative safe bounds.');
		}
	}
	if (bindings.length > options.maximumBindings) throw new RangeError('Shortcut inspection exceeds maximumBindings.');
	const prepared = bindings.map(prepare);
	const result: ConflictType[] = [];
	let comparisons = 0;
	for (let left = 0; left < prepared.length; left++) {
		for (let right = left + 1; right < prepared.length; right++) {
			if (comparisons === options.maximumComparisons || result.length === options.maximumConflicts) {
				return Object.freeze({ conflicts: Object.freeze(result), capped: true, comparisons });
			}
			comparisons++;
			const a = prepared[left]!, b = prepared[right]!;
			if (a.scope !== b.scope || a.priority !== b.priority) continue;
			let layout = false, matched = true;
			for (let index = 0; index < Math.min(a.strokes.length, b.strokes.length); index++) {
				const first = a.strokes[index]!, second = b.strokes[index]!;
				if (overlaps(first, second)) continue;
				if (
					options.includeLayout !== false && (('key' in first) !== ('key' in second)) &&
					modifiersOverlap(first, second)
				) {
					layout = true;
					continue;
				}
				matched = false;
				break;
			}
			if (matched) {
				result.push(
					Object.freeze({
						left,
						right,
						scope: a.scope,
						priority: a.priority,
						kind: layout ? 'layout' : a.strokes.length === b.strokes.length ? 'equal' : 'prefix',
					}),
				);
			}
		}
	}
	return Object.freeze({ conflicts: Object.freeze(result), capped: false, comparisons });
}

/** Callback-free binding data. Resolve command identity through the application's typed catalog. */
export interface MappingType {
	readonly command: string;
	readonly sequence: readonly Stroke[];
	readonly scope?: string;
	readonly priority?: number;
	readonly repeat?: boolean;
	readonly editable?: boolean;
}
/** Versioned user binding document, separate from live command callbacks and eligibility. */
export interface RemappingType {
	readonly version: 1;
	readonly bindings: readonly MappingType[];
}
/**
 * Build a bounded identity codec for persisted remappings. Unknown commands, unknown fields, invalid
 * modifiers and proven same-scope/priority sequence collisions reject in both directions. Layout-only
 * overlap is evidence rather than a proof of ambiguity and remains available through conflicts().
 * The comparison budget must establish a complete report; capped inspection cannot admit a document.
 * This codec stores no callbacks, installs no listeners and grants no execution authority.
 */
export function remapping(
	commandIds: readonly string[],
	options: Readonly<
		{
			readonly maximumCommands: number;
			readonly maximumBindings: number;
			readonly maximumTextCodeUnits: number;
			readonly maximumComparisons: number;
		}
	>,
): codec.Codec<RemappingType, RemappingType> {
	for (
		const value of [
			options.maximumCommands,
			options.maximumBindings,
			options.maximumTextCodeUnits,
			options.maximumComparisons,
		]
	) {
		if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Remapping requires nonnegative safe limits.');
	}
	if (commandIds.length > options.maximumCommands) {
		throw new RangeError('Remapping command inventory exceeds its limit.');
	}
	const allowed = new Set(commandIds);
	if (
		allowed.size !== commandIds.length ||
		commandIds.some((id) => typeof id !== 'string' || !id || id.length > options.maximumTextCodeUnits)
	) throw new TypeError('Remapping requires distinct bounded command IDs.');
	const TextSchema = schema.string({ minLength: 1, maxLength: options.maximumTextCodeUnits });
	const modifiers = {
		mod: schema.optional(schema.boolean()),
		control: schema.optional(schema.boolean()),
		meta: schema.optional(schema.boolean()),
		alt: schema.optional(schema.boolean()),
		shift: schema.optional(schema.boolean()),
	};
	const StrokeSchema = schema.union([
		schema.object({ key: TextSchema, ...modifiers }),
		schema.object({ code: TextSchema, ...modifiers }),
	]);
	const DocumentSchema = schema.object({
		version: schema.literal(1),
		bindings: schema.array(
			schema.object({
				command: schema.refine(TextSchema, (id) => allowed.has(id), 'Unknown command identity.'),
				sequence: schema.array(StrokeSchema, { minLength: 1, maxLength: 8 }),
				scope: schema.optional(TextSchema),
				priority: schema.optional(schema.number()),
				repeat: schema.optional(schema.boolean()),
				editable: schema.optional(schema.boolean()),
			}),
			{ maxLength: options.maximumBindings },
		),
	});
	const maximumBindings = options.maximumBindings, maximumComparisons = options.maximumComparisons;
	const RemappingSchema: schema.Reader<RemappingType, RemappingType> = schema.refine(DocumentSchema, (value) => {
		try {
			// Inert run callbacks reuse collision validation without resolving or executing application commands.
			const report = conflicts(value.bindings.map(({ command: _command, ...binding }) => ({ ...binding, run() {} })), {
				maximumBindings,
				maximumComparisons,
				maximumConflicts: 1,
				includeLayout: false,
			});
			return !report.capped && report.conflicts.length === 0;
		} catch (error) {
			if (error instanceof TypeError || error instanceof RangeError) return false;
			throw error;
		}
	}, 'Invalid or ambiguous shortcut remapping, or insufficient comparison budget.');
	return codec.identity(RemappingSchema);
}
