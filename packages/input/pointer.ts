/** One owned pointer gesture, with explicit capture and native-scroll policy. @module */
import type { BindingHandle, HostEvent, PointerInput, PointerTarget } from './types.ts';
import * as ownership from './ownership.ts';
import * as targets from './targets.ts';

/** Native wheel data retains the host's unit until explicit conversion is requested. */
export interface WheelType {
	/** Horizontal displacement in deltaMode units. */
	readonly deltaX: number;
	/** Vertical displacement in deltaMode units. */
	readonly deltaY: number;
	/** Depth displacement in deltaMode units. */
	readonly deltaZ: number;
	/** Native DOM unit: zero pixels, one lines, two pages. */
	readonly deltaMode: number;
}

/** Pixel conversion requires authored line and page geometry in CSS pixels. */
export type WheelPolicyType =
	| Readonly<{ unit: 'native' }>
	| Readonly<{
		/** Select explicit pixel conversion. */
		unit: 'pixels';
		/** Height of one line in CSS pixels. */
		lineHeight: number;
		/** Width of one page in CSS pixels. */
		pageWidth: number;
		/** Height of one page in CSS pixels; also used for depth deltas. */
		pageHeight: number;
	}>;

/** Normalize wheel data without listeners, preventDefault or ambient layout reads. */
export function wheel(
	event: WheelType,
	policy: WheelPolicyType,
): Readonly<{ x: number; y: number; z: number; unit: 'pixels' | 'lines' | 'pages' }> {
	if (![event.deltaX, event.deltaY, event.deltaZ].every(Number.isFinite) || ![0, 1, 2].includes(event.deltaMode)) {
		throw new RangeError('Invalid wheel sample.');
	}
	if (policy.unit === 'native') {
		return Object.freeze({
			x: event.deltaX,
			y: event.deltaY,
			z: event.deltaZ,
			unit: event.deltaMode === 0 ? 'pixels' : event.deltaMode === 1 ? 'lines' : 'pages',
		});
	}
	if (![policy.lineHeight, policy.pageWidth, policy.pageHeight].every((value) => Number.isFinite(value) && value > 0)) {
		throw new RangeError('Wheel geometry must be positive finite CSS pixels.');
	}
	const x = event.deltaMode === 0 ? 1 : event.deltaMode === 1 ? policy.lineHeight : policy.pageWidth;
	const y = event.deltaMode === 0 ? 1 : event.deltaMode === 1 ? policy.lineHeight : policy.pageHeight;
	const result = { x: event.deltaX * x, y: event.deltaY * y, z: event.deltaZ * y, unit: 'pixels' as const };
	if (![result.x, result.y, result.z].every(Number.isFinite)) throw new RangeError('Wheel conversion overflow.');
	return Object.freeze(result);
}

/** Position samples use one shared monotonic millisecond clock and CSS pixels. */
export interface PositionType {
	/** Horizontal position in CSS pixels. */
	readonly x: number;
	/** Vertical position in CSS pixels. */
	readonly y: number;
	/** Monotonic timestamp in milliseconds. */
	readonly at: number;
}

/** Native coalesced event capability; no pointer capture or gesture ownership is acquired. */
export interface CoalescedType {
	/** Viewport coordinates in CSS pixels. */
	readonly clientX: number;
	/** Vertical viewport coordinate in CSS pixels. */
	readonly clientY: number;
	/** Host monotonic event timestamp in milliseconds. */
	readonly timeStamp: number;
	/** Native host may return an empty list, in which case the original event is used. */
	getCoalescedEvents?(): readonly CoalescedType[];
}

/** Detach bounded coalesced positions in host order; equal timestamps remain valid. */
export function samples(event: CoalescedType, options: Readonly<{ maximumSamples: number }>): readonly PositionType[] {
	if (!Number.isSafeInteger(options.maximumSamples) || options.maximumSamples < 1) {
		throw new RangeError('maximumSamples must be positive.');
	}
	const native = event.getCoalescedEvents?.();
	const input = native === undefined || native.length === 0 ? [event] : native;
	if (input.length > options.maximumSamples) throw new RangeError('Coalesced events exceed maximumSamples.');
	const output = input.map((value) => Object.freeze({ x: value.clientX, y: value.clientY, at: value.timeStamp }));
	velocity(output, options);
	return Object.freeze(output);
}

/** Endpoint velocity in CSS pixels per millisecond; zero elapsed time produces zero velocity. */
export function velocity(
	samples: Iterable<PositionType>,
	options: Readonly<{ maximumSamples: number }>,
): Readonly<{ x: number; y: number; elapsed: number }> {
	if (!Number.isSafeInteger(options.maximumSamples) || options.maximumSamples < 1) {
		throw new RangeError('maximumSamples must be a positive safe integer.');
	}
	let first: PositionType | undefined;
	let last: PositionType | undefined;
	let count = 0;
	for (const sample of samples) {
		if (++count > options.maximumSamples) throw new RangeError('Velocity exceeds maximumSamples.');
		if (![sample.x, sample.y, sample.at].every(Number.isFinite) || last !== undefined && sample.at < last.at) {
			throw new RangeError('Velocity samples must be finite and time ordered.');
		}
		const copy = { x: sample.x, y: sample.y, at: sample.at };
		first ??= copy;
		last = copy;
	}
	const elapsed = first === undefined || last === undefined ? 0 : last.at - first.at;
	const x = elapsed === 0 ? 0 : (last!.x - first!.x) / elapsed;
	const y = elapsed === 0 ? 0 : (last!.y - first!.y) / elapsed;
	if (![elapsed, x, y].every(Number.isFinite)) throw new RangeError('Velocity calculation overflow.');
	return Object.freeze({ x, y, elapsed });
}

/** Pointer position and displacement relative to one accepted gesture start. */
export interface Sample<Event extends PointerInput = PointerInput> {
	/** Host contact identity retained for the accepted session. */
	readonly pointerId: number;
	/** Current viewport position in CSS pixels; x/y below remain displacement from the start. */
	readonly clientX: number;
	/** Current vertical viewport position in CSS pixels. */
	readonly clientY: number;
	/** Horizontal and vertical movement from the start in CSS pixels. */
	readonly x: number;
	/** Vertical displacement from the accepted start, in CSS pixels. */
	readonly y: number;
	/** Elapsed monotonic milliseconds according to the selected clock. */
	readonly elapsed: number;
	/** Original event retains native PointerEvent types for browser consumers. */
	readonly event: Event;
}

/** Terminal reason for a gesture that did not end normally. */
export type CancelReason = 'pointercancel' | 'lostcapture' | 'multiple-pointers' | 'disposed';

/** Application callbacks and host capabilities for one pointer owner. */
export interface Options<Event extends PointerInput = PointerInput> {
	/** Abort cancels the active gesture and removes all owned listeners. */
	readonly signal?: AbortSignal;
	/** Return false to leave this pointer with its native or nested owner. */
	readonly start?: (sample: Sample<Event>) => boolean | void;
	/** Receive movement only for the accepted contact; a callback failure cancels its active session. */
	readonly move?: (sample: Sample<Event>) => void;
	/** Receive normal release after capture has been released and local ownership cleared. */
	readonly end?: (sample: Sample<Event>) => void;
	/** Receive the last sample and interruption reason after capture release; called at most once per session. */
	readonly cancel?: (sample: Sample<Event>, reason: CancelReason) => void;
	/** Capture is opt-in and requires set/releasePointerCapture on the target. */
	readonly capture?: boolean;
	/** Cancel native defaults only after acceptance; defaults to false. Set touch-action in the UI deliberately. */
	readonly preventDefault?: boolean;
	/** Permit gestures starting on interactive controls; defaults to false. */
	readonly interactive?: boolean;
	/** Monotonic clock for elapsed time; defaults to performance.now(). */
	readonly now?: () => number;
}

/** Private session records capture ownership separately from the latest observed sample. */
interface Session<Event extends PointerInput> {
	readonly id: number;
	readonly x: number;
	/** Initial vertical viewport coordinate; samples subtract it to obtain displacement. */
	readonly y: number;
	readonly at: number;
	captured: boolean;
	latest: Sample<Event>;
}

/** Attach one pointer session owner; imports and rejected starts never acquire capture. */
export function listen<Target extends PointerTarget>(
	target: Target,
	options: Options<HostEvent<Target, 'PointerEvent', PointerInput>> = {},
): BindingHandle {
	type Event = HostEvent<Target, 'PointerEvent', PointerInput>;
	if (
		options.capture &&
		(typeof target.setPointerCapture !== 'function' || typeof target.releasePointerCapture !== 'function')
	) {
		throw new TypeError('Pointer capture requires setPointerCapture and releasePointerCapture.');
	}
	const owner = ownership.create(options.signal);
	const now = options.now ?? (() => performance.now());
	let active: Session<Event> | undefined;
	let blocked: readonly number[] = [];

	/** Clear local ownership before calling host capture release or user callbacks. */
	const release = (session: Session<Event>): void => {
		if (!session.captured) return;
		session.captured = false;
		target.releasePointerCapture!(session.id);
	};
	/** Attempt host release and the terminal callback even when either one fails. */
	const finish = (session: Session<Event>, callback: () => void): void => {
		const failures: unknown[] = [];
		try {
			release(session);
		} catch (error) {
			failures.push(error);
		}
		try {
			callback();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Pointer release and callback failed.');
	};
	/** Clear the session before host release or callbacks can reenter this owner. */
	const cancel = (reason: CancelReason): void => {
		const session = active;
		active = undefined;
		if (session === undefined) return;
		finish(session, () => options.cancel?.(session.latest, reason));
	};
	owner.defer(() => {
		blocked = [];
		cancel('disposed');
	});

	/** Compute one original-event-preserving sample with a non-negative elapsed interval. */
	const sample = (session: Session<Event>, event: Event): Sample<Event> => ({
		pointerId: session.id,
		clientX: event.clientX,
		clientY: event.clientY,
		x: event.clientX - session.x,
		y: event.clientY - session.y,
		elapsed: Math.max(0, now() - session.at),
		event,
	});

	/** Admit one primary contact; a second contact blocks a new gesture until both contacts release. */
	const down = (value: unknown): void => {
		if (!isPointer(value) || owner.handle.closed || value.defaultPrevented) return;
		const event = value as Event;
		if (active !== undefined && active.id !== event.pointerId) {
			blocked = [active.id, event.pointerId];
			cancel('multiple-pointers');
			return;
		}
		if (active !== undefined || blocked.length > 0 || event.isPrimary === false || (event.button ?? 0) !== 0) return;
		if (!options.interactive && targets.path(event).some(targets.interactive)) return;
		const first: Sample<Event> = {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			x: 0,
			y: 0,
			elapsed: 0,
			event,
		};
		if (options.start?.(first) === false || owner.handle.closed) return;
		const session: Session<Event> = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			at: now(),
			captured: false,
			latest: first,
		};
		active = session;
		try {
			if (options.capture) {
				session.captured = true;
				target.setPointerCapture!(session.id);
			}
			if (options.preventDefault) event.preventDefault();
		} catch (error) {
			try {
				cancel('pointercancel');
			} catch (cleanup) {
				throw new AggregateError([error, cleanup], 'Pointer capture and cleanup failed.');
			}
			throw error;
		}
	};
	const move = (value: unknown): void => {
		if (!isPointer(value) || active === undefined || active.id !== value.pointerId) return;
		active.latest = sample(active, value as Event);
		if (options.preventDefault) value.preventDefault();
		try {
			options.move?.(active.latest);
		} catch (error) {
			try {
				cancel('pointercancel');
			} catch (cleanup) {
				throw new AggregateError([error, cleanup], 'Pointer callback and cleanup failed.');
			}
			throw error;
		}
	};
	const end = (value: unknown): void => {
		if (!isPointer(value)) return;
		blocked = blocked.filter((id) => id !== value.pointerId);
		const session = active;
		if (session === undefined || session.id !== value.pointerId) return;
		active = undefined;
		session.latest = sample(session, value as Event);
		finish(session, () => options.end?.(session.latest));
	};
	const cancelled = (value: unknown): void => {
		if (!isPointer(value)) return;
		blocked = blocked.filter((id) => id !== value.pointerId);
		if (active?.id === value.pointerId) cancel('pointercancel');
	};
	/** The host already released capture, so cancellation must not attempt a second release. */
	const lost = (value: unknown): void => {
		if (!isPointer(value) || active?.id !== value.pointerId) return;
		active.captured = false;
		cancel('lostcapture');
	};
	try {
		const passive = !options.preventDefault;
		owner.listen(target, 'pointerdown', down, { passive });
		owner.listen(target, 'pointermove', move, { passive });
		owner.listen(target, 'pointerup', end, { passive });
		owner.listen(target, 'pointercancel', cancelled, { passive: true });
		owner.listen(target, 'lostpointercapture', lost, { passive: true });
	} catch (error) {
		try {
			owner.handle();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], 'Pointer setup and cleanup failed.');
		}
		throw error;
	}
	return owner.handle;
}

/** Validate the coordinate identity needed by the state machine, independently of realm constructors. */
function isPointer(value: unknown): value is PointerInput {
	return targets.object(value) && Number.isSafeInteger(value.pointerId) &&
		typeof value.clientX === 'number' && Number.isFinite(value.clientX) &&
		typeof value.clientY === 'number' && Number.isFinite(value.clientY) && typeof value.preventDefault === 'function';
}
