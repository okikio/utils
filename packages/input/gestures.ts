/** Interpret pointer contacts as drag, swipe, long press, scale and rotation. @module */
import { elapsed } from '@okikio/duration';
import type { DurationInput } from '@okikio/duration';
import type { BindingHandle, ErrorReporter, HostEvent, PointerInput, PointerTarget } from './types.ts';
import * as pointer from './pointer.ts';
import * as ownership from './ownership.ts';
import * as callback from './callback.ts';
import * as targets from './targets.ts';

/** A point or vector in CSS pixels, unless the containing field documents another unit. */
export interface Vector {
	/** Horizontal component; position, displacement and velocity give this component its unit. */
	readonly x: number;
	/** Vertical component; position, displacement and velocity give this component its unit. */
	readonly y: number;
}

/** Geometry shared by drag and swipe. Native events and targets remain borrowed. */
export interface Geometry<Event extends PointerInput = PointerInput> {
	/** Original event borrowed from the host; native targets retain complete PointerEvent fields. */
	readonly event: Event;
	/** Current viewport coordinates in CSS pixels. */
	readonly position: Vector;
	/** Displacement from the accepted pointer start, in CSS pixels. */
	readonly delta: Vector;
	/** Total displacement length in CSS pixels. */
	readonly distance: number;
	/** Time since accepted pointer start, in milliseconds. */
	readonly elapsed: number;
	/** Average displacement per millisecond since pointer start; zero at zero elapsed time. */
	readonly velocity: Vector;
}

/** Recognizers share the pointer owner's explicit capture and native-scroll policies. */
export interface Options extends Omit<pointer.Options, 'start' | 'move' | 'end' | 'cancel'> {
	/** Report application callback failures, including returned Promise rejections. */
	readonly onError?: ErrorReporter;
}

/** One drag transition. Cancel reasons distinguish native interruption from disposal. */
export interface Drag<Event extends PointerInput = PointerInput> extends Geometry<Event> {
	/** Start establishes the gesture; end or cancel is the single terminal notification. */
	readonly phase: 'start' | 'move' | 'end' | 'cancel';
	/** Present on cancellation; identifies native interruption, lost capture, extra contacts or disposal. */
	readonly reason?: pointer.CancelReason;
}

/** Minimum movement separates an intentional drag from a native click. */
export interface DragOptions extends Options {
	/** Euclidean CSS-pixel distance required before start; defaults to 4. Zero starts immediately. */
	readonly threshold?: number;
}

/** Turn a pointer sample into named geometry without retaining a growing sample history. */
function geometry<Event extends PointerInput>(sample: pointer.Sample<Event>): Geometry<Event> {
	return {
		event: sample.event,
		position: { x: sample.clientX, y: sample.clientY },
		delta: { x: sample.x, y: sample.y },
		distance: Math.hypot(sample.x, sample.y),
		elapsed: sample.elapsed,
		velocity: {
			x: sample.elapsed === 0 ? 0 : sample.x / sample.elapsed,
			y: sample.elapsed === 0 ? 0 : sample.y / sample.elapsed,
		},
	};
}

/** Reject invalid thresholds before any listeners, capture, or timers are acquired. */
function nonnegative(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number.`);
	return value;
}

/** Read a timer interval without requiring Temporal when the caller supplies numeric milliseconds. */
function milliseconds(value: number | DurationInput, name: string): number {
	const result = nonnegative(typeof value === 'number' ? value : elapsed(value), name);
	if (result > 2_147_483_647) throw new RangeError(`${name} exceeds the portable timer range.`);
	return result;
}

/**
 * Report start only after the movement threshold, then move and one terminal
 * event. A click under the threshold produces no drag. The UI owns touch-action;
 * capture and preventDefault remain explicit options inherited from pointer.
 */
export function drag<Target extends PointerTarget>(
	target: Target,
	change: (drag: Drag<HostEvent<Target, 'PointerEvent', PointerInput>>) => unknown,
	options: DragOptions = {},
): BindingHandle {
	type Event = HostEvent<Target, 'PointerEvent', PointerInput>;
	const threshold = nonnegative(options.threshold ?? 4, 'Drag threshold');
	let started = false;
	const emit = (sample: pointer.Sample<Event>, phase: Drag['phase'], reason?: pointer.CancelReason) =>
		callback.call(change, { ...geometry(sample), phase, ...(reason === undefined ? {} : { reason }) }, options.onError);
	return pointer.listen(target, {
		...options,
		start(sample) {
			started = threshold === 0;
			if (started) emit(sample, 'start');
		},
		move(sample) {
			if (!started && Math.hypot(sample.x, sample.y) >= threshold) {
				started = true;
				emit(sample, 'start');
			} else if (started) emit(sample, 'move');
		},
		end(sample) {
			if (started) {
				started = false;
				emit(sample, 'end');
			}
		},
		cancel(sample, reason) {
			if (started) {
				started = false;
				emit(sample, 'cancel', reason);
			}
		},
	});
}

/** A completed swipe has physical direction; the application chooses its navigation meaning. */
export interface Swipe<Event extends PointerInput = PointerInput> extends Geometry<Event> {
	/** Physical dominant movement direction; the application chooses its navigation meaning. */
	readonly direction: 'left' | 'right' | 'up' | 'down';
}

/** A swipe is a completed contact satisfying distance, duration and direction policies. */
export interface SwipeOptions extends Options {
	/** Allowed directions; defaults to both axes. */
	readonly axis?: 'x' | 'y' | 'both';
	/** Dominant-axis distance in CSS pixels; defaults to 64. */
	readonly distance?: number;
	/** Maximum time; numeric values are milliseconds. Defaults to 600 ms. */
	readonly duration?: number | DurationInput;
	/** Dominant-to-other-axis ratio; defaults to 1.5. */
	readonly ratio?: number;
}

/** Native interruption never completes a swipe. No default scrolling policy is installed. */
export function swipe<Target extends PointerTarget>(
	target: Target,
	completed: (swipe: Swipe<HostEvent<Target, 'PointerEvent', PointerInput>>) => unknown,
	options: SwipeOptions = {},
): BindingHandle {
	type Event = HostEvent<Target, 'PointerEvent', PointerInput>;
	const distance = nonnegative(options.distance ?? 64, 'Swipe distance');
	const duration = milliseconds(options.duration ?? 600, 'Swipe duration');
	const ratio = nonnegative(options.ratio ?? 1.5, 'Swipe ratio');
	if (distance === 0 || ratio < 1) throw new RangeError('Swipe distance must be positive and ratio at least one.');
	return pointer.listen(target, {
		...options,
		end(sample) {
			const x = Math.abs(sample.x), y = Math.abs(sample.y);
			const horizontal = x >= y;
			if (sample.elapsed > duration || Math.max(x, y) < distance || Math.max(x, y) < Math.min(x, y) * ratio) return;
			if (options.axis === 'x' && !horizontal || options.axis === 'y' && horizontal) return;
			const direction = horizontal ? sample.x < 0 ? 'left' : 'right' : sample.y < 0 ? 'up' : 'down';
			callback.call(completed, { ...geometry(sample), direction }, options.onError);
		},
	});
}

/** Hold policy. Native clicks and context menus remain the application's deliberate policy. */
export interface PressOptions extends Options {
	/** Hold time before one notification; numeric values are milliseconds. Defaults to 500 ms. */
	readonly duration?: number | DurationInput;
	/** Maximum displacement before the hold is cancelled; defaults to 10 CSS pixels. */
	readonly distance?: number;
}

/** Own at most one timer. Moving too far, release, extra contacts, abort and disposal cancel it. */
export function press<Target extends PointerTarget>(
	target: Target,
	held: (press: Geometry<HostEvent<Target, 'PointerEvent', PointerInput>>) => unknown,
	options: PressOptions = {},
): BindingHandle {
	type Event = HostEvent<Target, 'PointerEvent', PointerInput>;
	const duration = milliseconds(options.duration ?? 500, 'Press duration');
	const distance = nonnegative(options.distance ?? 10, 'Press distance');
	const now = options.now ?? (() => performance.now());
	let timer: ReturnType<typeof setTimeout> | undefined;
	let latest: pointer.Sample<Event> | undefined;
	let at = 0;
	/** Release the only hold timer and its borrowed last sample on every terminal contact path. */
	const clear = () => {
		clearTimeout(timer);
		timer = undefined;
		latest = undefined;
	};
	return pointer.listen(target, {
		...options,
		start(sample) {
			clear();
			latest = sample;
			at = now();
			timer = setTimeout(() => {
				timer = undefined;
				const sample = latest;
				latest = undefined;
				if (sample) callback.call(held, geometry({ ...sample, elapsed: Math.max(0, now() - at) }), options.onError);
			}, duration);
		},
		move(sample) {
			if (Math.hypot(sample.x, sample.y) > distance) clear();
			else if (latest) latest = sample;
		},
		end: clear,
		cancel: clear,
	});
}

/** A two-pointer transform measured relative to the initial pair. */
export interface Transform<Event extends PointerInput = PointerInput> {
	/** Start establishes the gesture; end or cancel is the single terminal notification. */
	readonly phase: 'start' | 'move' | 'end' | 'cancel';
	/** Current midpoint of the two contact positions, in viewport CSS pixels. */
	readonly center: Vector;
	/** Movement of the midpoint from the initial pair, in CSS pixels. */
	readonly translation: Vector;
	/** Current contact distance divided by its initial distance. */
	readonly scale: number;
	/** Accumulated rotation in degrees, continuous across the -180/180 transition. */
	readonly rotation: number;
	/** Original event borrowed from the host; native targets retain complete PointerEvent fields. */
	readonly event: Event;
	/** Present on cancellation; identifies the operation that interrupted the pair. */
	readonly reason?: 'pointercancel' | 'lostcapture' | 'multiple-pointers' | 'disposed';
}

/** Private pair state retains only two contacts, one base vector, and the latest sample. */
interface Pair<Event extends PointerInput> {
	/** Current midpoint of the two contact positions, in viewport CSS pixels. */
	readonly center: Vector;
	readonly distance: number;
	angle: number;
	rotation: number;
	latest: Transform<Event>;
}

/**
 * Own a two-contact interaction. The first nonzero contact separation sets the
 * base scale. An extra contact cancels the pair and blocks admission until the
 * tracked contacts release. Capture is optional; the UI sets touch-action.
 */
export function transform<Target extends PointerTarget>(
	target: Target,
	change: (sample: Transform<HostEvent<Target, 'PointerEvent', PointerInput>>) => unknown,
	options: Options = {},
): BindingHandle {
	type Event = HostEvent<Target, 'PointerEvent', PointerInput>;
	if (
		options.capture &&
		(typeof target.setPointerCapture !== 'function' || typeof target.releasePointerCapture !== 'function')
	) throw new TypeError('Transform capture requires setPointerCapture and releasePointerCapture.');
	const owner = ownership.create(options.signal);
	const contacts = new Map<number, Event>();
	const captured = new Set<number>();
	let blocked: number[] = [];
	let pair: Pair<Event> | undefined;
	const emit = (sample: Transform<Event>) => callback.call(change, sample, options.onError);
	const release = () => {
		const failures: unknown[] = [];
		for (const id of captured) {
			captured.delete(id);
			try {
				target.releasePointerCapture!(id);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'Transform capture release failed.');
	};
	/** Forget the pair before releasing capture, whose host callbacks can synchronously reenter. */
	const finish = (phase: 'end' | 'cancel', reason?: Transform['reason']) => {
		const current = pair;
		pair = undefined;
		contacts.clear();
		const failures: unknown[] = [];
		try {
			release();
		} catch (error) {
			failures.push(error);
		}
		if (current) {
			try {
				emit({ ...current.latest, phase, ...(reason === undefined ? {} : { reason }) });
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'Transform completion failed.');
	};
	owner.defer(() => {
		blocked = [];
		finish('cancel', 'disposed');
	});
	/** Establish a nonzero scale baseline, then retain only the current pair and accumulated rotation. */
	const update = (event: Event) => {
		if (contacts.size !== 2) return;
		const [first, second] = [...contacts.values()] as [Event, Event];
		const x = second.clientX - first.clientX, y = second.clientY - first.clientY;
		const distance = Math.hypot(x, y), angle = Math.atan2(y, x);
		const center = { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 };
		if (!pair) {
			if (distance === 0) return;
			const sample: Transform<Event> = {
				phase: 'start',
				center,
				translation: { x: 0, y: 0 },
				scale: 1,
				rotation: 0,
				event,
			};
			pair = { center, distance, angle, rotation: 0, latest: sample };
			emit(sample);
			return;
		}
		// Unwrap each angle change so crossing -180/180 degrees does not reverse a continuous rotation.
		let difference = angle - pair.angle;
		if (difference > Math.PI) difference -= 2 * Math.PI;
		if (difference < -Math.PI) difference += 2 * Math.PI;
		pair.angle = angle;
		pair.rotation += difference * 180 / Math.PI;
		pair.latest = {
			phase: 'move',
			center,
			translation: { x: center.x - pair.center.x, y: center.y - pair.center.y },
			scale: distance / pair.distance,
			rotation: pair.rotation,
			event,
		};
		emit(pair.latest);
	};
	const isPointer = (event: unknown): event is Event =>
		targets.object(event) && Number.isSafeInteger(event.pointerId) && typeof event.clientX === 'number' &&
		Number.isFinite(event.clientX) && typeof event.clientY === 'number' && Number.isFinite(event.clientY) &&
		typeof event.preventDefault === 'function';
	try {
		owner.listen(target, 'pointerdown', (event) => {
			if (
				!isPointer(event) || owner.handle.closed || blocked.length || contacts.has(event.pointerId) ||
				event.defaultPrevented || (event.button ?? 0) !== 0
			) return;
			if (!options.interactive && targets.path(event).some(targets.interactive)) return;
			if (contacts.size === 2) {
				blocked = [...contacts.keys(), event.pointerId];
				finish('cancel', 'multiple-pointers');
				return;
			}
			contacts.set(event.pointerId, event);
			try {
				if (options.capture) {
					captured.add(event.pointerId);
					target.setPointerCapture!(event.pointerId);
				}
				if (options.preventDefault) event.preventDefault();
				update(event);
			} catch (error) {
				try {
					finish('cancel', 'pointercancel');
				} catch (cleanup) {
					throw new AggregateError([error, cleanup], 'Transform start and cleanup failed.');
				}
				throw error;
			}
		}, { passive: !options.preventDefault });
		owner.listen(target, 'pointermove', (event) => {
			if (!isPointer(event) || !contacts.has(event.pointerId)) return;
			contacts.set(event.pointerId, event);
			if (options.preventDefault) event.preventDefault();
			try {
				update(event);
			} catch (error) {
				try {
					finish('cancel', 'pointercancel');
				} catch (cleanup) {
					throw new AggregateError([error, cleanup], 'Transform callback and cleanup failed.');
				}
				throw error;
			}
		}, { passive: !options.preventDefault });
		owner.listen(target, 'pointerup', (event) => {
			if (!isPointer(event)) return;
			blocked = blocked.filter((id) => id !== event.pointerId);
			if (!contacts.has(event.pointerId)) return;
			contacts.set(event.pointerId, event);
			try {
				if (pair) update(event);
			} catch (error) {
				try {
					finish('cancel', 'pointercancel');
				} catch (cleanup) {
					throw new AggregateError([error, cleanup], 'Transform completion and cleanup failed.');
				}
				throw error;
			}
			finish('end');
		});
		for (const type of ['pointercancel', 'lostpointercapture']) {
			owner.listen(target, type, (event) => {
				if (!isPointer(event)) return;
				blocked = blocked.filter((id) => id !== event.pointerId);
				if (!contacts.has(event.pointerId)) return;
				if (type === 'lostpointercapture') captured.delete(event.pointerId);
				finish('cancel', type === 'pointercancel' ? 'pointercancel' : 'lostcapture');
			});
		}
	} catch (error) {
		ownership.fail(owner, error);
	}
	return owner.handle;
}
