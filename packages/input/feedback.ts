/** Cancellable haptic, audio and visual cues using explicitly supplied host capabilities. @module */
import { delay } from '@okikio/context';
import type { Clock } from '@okikio/context';
import { elapsed } from '@okikio/duration';
import type { DurationInput } from '@okikio/duration';
import { AsyncDisposableStack, DisposableStack, dispose } from '@okikio/dispose';
import type { ListenerTarget, Native } from './types.ts';
import * as ownership from './ownership.ts';

/** Milliseconds, or a Duration value such as ms(120). Calendar months and years need prior conversion. */
export type Time = number | DurationInput;

/** Observable host outcome. No outcome proves that a person perceived the cue. */
export type Outcome =
	| { readonly status: 'completed' | 'elapsed' | 'preempted' }
	| {
		readonly status: 'unavailable';
		readonly reason: 'unsupported' | 'denied' | 'inactive' | 'reduced-motion' | 'disabled' | 'muted';
	};

export { create, CueSchema, define } from './cues.ts';
export type { Cue, CueHosts, CuePlayer, CuePolicy, CueResult, CueType } from './cues.ts';

/** Cancellation belongs to the caller; an aborted operation rejects with the exact signal reason. */
export interface Options {
	/** Cancels only resources acquired by this cue; the supplied host remains borrowed. */
	readonly signal?: AbortSignal;
}

/** A borrowed vibration capability; Navigator satisfies this without a realm check. */
export interface VibrationHost {
	/** Request alternating vibration/pause milliseconds, or zero to stop the current vibration. */
	vibrate(pattern: number | number[]): boolean;
}

/** Clock injection keeps vibration schedules deterministic without replacing browser globals. */
export interface VibrationOptions extends Options {
	/** Schedule elapsed time on this clock; defaults to Context's real-time delay. */
	readonly clock?: Pick<Clock, 'sleep'>;
}

/** A borrowed gamepad actuator. Missing methods are reported as unsupported before acquiring ownership. */
export interface HapticHost {
	/** Advertised effect names; when present this must include dual-rumble. */
	readonly effects?: readonly string[];
	/** Start an effect and settle when it completes or another effect preempts it. */
	playEffect(type: 'dual-rumble', parameters: {
		duration: number;
		startDelay: number;
		strongMagnitude: number;
		weakMagnitude: number;
	}): PromiseLike<'complete' | 'preempted'>;
	/** Stop all effects on this actuator; settlement must mean the reset has finished. */
	reset(): PromiseLike<unknown>;
}

/** Two-motor feedback values. A zero magnitude deliberately leaves that motor silent. */
export interface RumbleOptions extends Options {
	/** Elapsed cue length; defaults to 100 milliseconds. Maximum is one minute. */
	readonly duration?: Time;
	/** Low-frequency motor strength from 0 to 1; defaults to 0.5. */
	readonly strong?: number;
	/** High-frequency motor strength from 0 to 1; defaults to 0.5. */
	readonly weak?: number;
}

/** One host-wide cue retains cancellation and any cleanup that a following cue must join. */
interface CueOwner {
	readonly controller: AbortController;
	/** An inherited reset must settle before this request can touch the host. */
	waiting?: Promise<void>;
	/** Published before reset() is invoked, including hosts that reenter during reset. */
	stopping?: Promise<void>;
}

/** Private cue owners prevent an older cancellation or delayed reset from stopping a newer request. */
const vibrations = new WeakMap<object, CueOwner>();
const rumbles = new WeakMap<object, CueOwner>();
/** This private reason is distinguishable from every application-provided cancellation reason. */
const superseded = Symbol('superseded feedback');

/**
 * Play a vibration pattern and wait for its requested elapsed time.
 *
 * Supply alternating vibration and pause lengths. The host may truncate or ignore
 * the request, so `elapsed` means only that the accepted schedule's time passed.
 * A new call using the same host supersedes the old call. Abort stops only the
 * current call's vibration. At most 128 segments and one minute are accepted.
 *
 * @example
 * ```ts
 * import { vibrate } from '@okikio/input/feedback';
 * import { ms } from '@okikio/duration';
 * const outcome = await vibrate(undefined, [ms(20), ms(30), ms(20)]);
 * console.log(outcome.status); // unavailable, because no host was supplied
 * ```
 */
export async function vibrate(
	host: VibrationHost | undefined,
	pattern: Time | readonly Time[],
	options: VibrationOptions = {},
): Promise<Outcome> {
	options.signal?.throwIfAborted();
	const parts = Array.isArray(pattern) ? pattern : [pattern];
	if (parts.length > 128) throw new RangeError('A vibration pattern can contain at most 128 segments.');
	const values = parts.map((part: Time) => Math.ceil(time(part)));
	const total = values.reduce((sum, part) => sum + part, 0);
	if (total > 60_000) throw new RangeError('A vibration pattern cannot exceed one minute.');
	if (typeof host?.vibrate !== 'function') return unavailable('unsupported');
	return exclusive(vibrations, host, options.signal, async (signal) => {
		if (!host.vibrate(values)) return unavailable('denied');
		await abortable(options.clock === undefined ? delay(total, signal) : options.clock.sleep(total, signal), signal);
		return { status: 'elapsed' };
	}, () => {
		host.vibrate(0);
	});
}

/**
 * Play dual-motor gamepad feedback, preserving the actuator's complete/preempted outcome.
 *
 * The caller supplies the selected gamepad's actuator. Permission, visibility
 * and disconnection errors remain native errors. Cancellation joins reset(); an
 * older request never resets an actuator after a newer call acquired it.
 */
export async function rumble(host: HapticHost | undefined, options: RumbleOptions = {}): Promise<Outcome> {
	options.signal?.throwIfAborted();
	const duration = time(options.duration ?? 100);
	const strongMagnitude = magnitude(options.strong ?? 0.5);
	const weakMagnitude = magnitude(options.weak ?? 0.5);
	if (
		typeof host?.playEffect !== 'function' || typeof host.reset !== 'function' ||
		(host.effects !== undefined && !host.effects.includes('dual-rumble'))
	) return unavailable('unsupported');
	return exclusive(rumbles, host, options.signal, async (signal) => {
		const result = await abortable(
			host.playEffect('dual-rumble', {
				duration,
				startDelay: 0,
				strongMagnitude,
				weakMagnitude,
			}),
			signal,
		);
		if (result !== 'complete' && result !== 'preempted') throw new TypeError('Invalid gamepad haptic outcome.');
		return { status: result === 'complete' ? 'completed' : 'preempted' };
	}, () => host.reset());
}

/** Minimal scheduled parameter methods needed for an amplitude envelope without clicks. */
export interface AudioParameter {
	/** Set an audio value at absolute AudioContext time, measured in seconds. */
	setValueAtTime(value: number, time: number): unknown;
	/** Reach an audio value linearly at absolute AudioContext time in seconds. */
	linearRampToValueAtTime(value: number, time: number): unknown;
}

/** Structural oscillator for test or embedded audio hosts. */
export interface Oscillator extends ListenerTarget {
	/** Wave shape selected before the source starts. */
	type: 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom';
	/** Frequency automation in hertz. */
	readonly frequency: Pick<AudioParameter, 'setValueAtTime'>;
	/** Connect this owned source to the cue's gain node. */
	connect(destination: unknown): unknown;
	/** Release this source's outgoing graph connections. */
	disconnect(): void;
	/** Start once at absolute audio time in seconds; omitted time starts immediately. */
	start(time?: number): void;
	/** Schedule completion at absolute audio time, or stop immediately when omitted. */
	stop(time?: number): void;
}

/** Structural gain node; Feedback owns this node and disconnects it on every terminal path. */
export interface Gain {
	/** Amplitude automation; one is unity gain and zero is silence. */
	readonly gain: AudioParameter;
	/** Connect this owned node to the application's borrowed output. */
	connect(destination: unknown): unknown;
	/** Release this node's outgoing graph connections. */
	disconnect(): void;
}

/** Borrowed audio graph. Feedback never resumes, suspends or closes the application-owned context. */
export interface AudioHost extends ListenerTarget {
	/** The cue runs only while this value is running; statechange reports later suspension or closure. */
	readonly state: string;
	/** Monotonic audio graph time in seconds. */
	readonly currentTime: number;
	/** Borrowed output node; the cue never disconnects or closes this destination. */
	readonly destination: unknown;
	/** Allocate a new single-use oscillator owned by the cue. */
	createOscillator(): Oscillator;
	/** Allocate a gain node owned by the cue. */
	createGain(): Gain;
}

/** A short oscillator cue; gain is an amplitude ratio, not an operating-system volume setting. */
export interface ToneOptions extends Options {
	/** Frequency in hertz; defaults to 440. */
	readonly frequency?: number;
	/** Elapsed cue length, at most one minute; defaults to 100 milliseconds. */
	readonly duration?: Time;
	/** Amplitude from 0 to 1; defaults to 0.1. */
	readonly gain?: number;
	/** Wave shape; defaults to sine. */
	readonly wave?: Exclude<Oscillator['type'], 'custom'>;
}

/** Play a cue on a native AudioContext after the application resumes it in an allowed interaction. */
export function tone(host: Native<'AudioContext'>, options?: ToneOptions): Promise<Outcome>;
/** Play the same cue on a structural host, including small deterministic test graphs. */
export function tone(host: AudioHost | undefined, options?: ToneOptions): Promise<Outcome>;
/**
 * Own one oscillator and gain node until playback ends, aborts, or the borrowed context stops running.
 *
 * A suspended context returns `unavailable/inactive` immediately. Resume it from
 * the application's user-activation handler before calling this function. No
 * global AudioContext is created and no autoplay policy is silently bypassed.
 */
export async function tone(
	host: Native<'AudioContext'> | AudioHost | undefined,
	options: ToneOptions = {},
): Promise<Outcome> {
	options.signal?.throwIfAborted();
	const duration = time(options.duration ?? 100) / 1000;
	const frequency = options.frequency ?? 440;
	if (!Number.isFinite(frequency) || frequency <= 0) throw new RangeError('Tone frequency must be positive hertz.');
	const level = magnitude(options.gain ?? 0.1);
	const wave = options.wave ?? 'sine';
	if (!['sine', 'square', 'sawtooth', 'triangle'].includes(wave)) throw new TypeError('Unsupported oscillator wave.');
	if (host === undefined) return unavailable('unsupported');
	const audio = host as AudioHost;
	if (audio.state !== 'running') return unavailable('inactive');
	const owner = ownership.create();
	let oscillator: Oscillator | undefined;
	let started = false;
	return cleaned(async () => {
		oscillator = audio.createOscillator();
		owner.defer(() => oscillator!.disconnect());
		options.signal?.throwIfAborted();
		const gain = audio.createGain();
		owner.defer(() => gain.disconnect());
		options.signal?.throwIfAborted();
		const ended = Promise.withResolvers<void>();
		// Observe rejection before host callbacks can fire during registration or start().
		const completed = abortable(ended.promise, options.signal);
		void completed.catch(() => {});
		owner.listen(oscillator, 'ended', () => ended.resolve());
		owner.listen(audio, 'statechange', () => {
			if (audio.state !== 'running') {
				ended.reject(new DOMException('Audio context stopped running.', 'InvalidStateError'));
			}
		});
		owner.defer(() => ended.resolve());
		oscillator.type = wave;
		const start = audio.currentTime;
		const edge = Math.min(0.005, duration / 2);
		oscillator.frequency.setValueAtTime(frequency, start);
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(level, start + edge);
		gain.gain.setValueAtTime(level, start + duration - edge);
		gain.gain.linearRampToValueAtTime(0, start + duration);
		oscillator.connect(gain);
		gain.connect(audio.destination);
		options.signal?.throwIfAborted();
		if (audio.state !== 'running') throw new DOMException('Audio context stopped running.', 'InvalidStateError');
		// A structural host can start playback and then throw; cleanup must still attempt to stop that source.
		started = true;
		oscillator.start(start);
		oscillator.stop(start + duration);
		await completed;
		options.signal?.throwIfAborted();
		return { status: 'completed' };
	}, () => {
		// Stop first, then release every node and listener even if stopping fails.
		// LIFO disposal retains the complete failure chain without owning the host.
		using resources = new DisposableStack();
		resources.defer(owner.handle);
		resources.defer(() => {
			if (started) oscillator!.stop();
		});
	});
}

/** A small keyframe record that stays usable in projects without DOM ambient types. */
export interface Frame {
	/** CSS property, offset or easing entry passed to the host's keyframe parser. */
	readonly [property: string]: string | number | null | undefined;
}

/** The animation belongs to the cue; its target element remains borrowed. */
export interface AnimationHandle {
	/** Settles when playback finishes; native cancellation may reject this promise. */
	readonly finished: PromiseLike<unknown>;
	/** Remove only this animation's effect and release its target. */
	cancel(): void;
}

/** Native Element and small test surfaces can supply animation without global document access. */
export interface VisualHost {
	/** Allocate one finite animation, leaving final styles uncommitted. */
	animate(
		frames: Frame[],
		options: { duration: number; easing: string; iterations: number; fill: 'none' },
	): AnimationHandle;
	/** The target's own realm supplies motion preferences; no global window is required. */
	readonly ownerDocument?: {
		readonly defaultView?: { matchMedia(query: string): { readonly matches: boolean } } | null;
	};
}

/** Finite visual-cue policy. Reduced motion is read from the element's own window unless overridden. */
export interface VisualOptions extends Options {
	/** Elapsed cue length, at most one minute; defaults to 160 milliseconds. */
	readonly duration?: Time;
	/** A CSS easing value parsed by the host; defaults to ease-out. */
	readonly easing?: string;
	/** Explicit motion preference; omitted reads the target realm's media query. */
	readonly reducedMotion?: boolean;
}

/**
 * Play one finite animation and release its effect after completion or cancellation.
 *
 * The function never writes inline styles or commits the final keyframe. It
 * cancels only the Animation it created. The application's pre-existing styles
 * are visible again after the cue. Reduced motion returns an explicit outcome
 * without allocating an animation; supply a text or other non-motion response.
 */
export async function animate(
	host: VisualHost | undefined,
	frames: readonly Frame[],
	options: VisualOptions = {},
): Promise<Outcome> {
	options.signal?.throwIfAborted();
	const duration = time(options.duration ?? 160);
	if (frames.length < 1 || frames.length > 128) throw new RangeError('A cue requires between 1 and 128 keyframes.');
	if (typeof host?.animate !== 'function') return unavailable('unsupported');
	const reduced = options.reducedMotion ??
		host.ownerDocument?.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
	if (reduced) return unavailable('reduced-motion');
	const animation = host.animate(frames.map((frame) => ({ ...frame })), {
		duration,
		easing: options.easing ?? 'ease-out',
		iterations: 1,
		fill: 'none',
	});
	return cleaned(async () => {
		await abortable(animation.finished, options.signal);
		options.signal?.throwIfAborted();
		return { status: 'completed' };
	}, () => animation.cancel());
}

/** Apply a single element glow. This does not control a physical lamp or a display backlight. */
export function light(
	host: VisualHost | undefined,
	options: VisualOptions & { readonly color?: string } = {},
): Promise<Outcome> {
	return animate(host, [
		{ boxShadow: '0 0 0 0 transparent' },
		{ boxShadow: `0 0 12px 2px ${options.color ?? '#d4a71c'}` },
		{ boxShadow: '0 0 0 0 transparent' },
	], options);
}

/** Briefly rotate an element by CSS degrees and return to its original styling. No device orientation is changed. */
export function rotate(host: VisualHost | undefined, degrees = 6, options: VisualOptions = {}): Promise<Outcome> {
	if (!Number.isFinite(degrees)) throw new RangeError('Rotation must be finite degrees.');
	return animate(host, [{ rotate: '0deg' }, { rotate: `${degrees}deg` }, { rotate: '0deg' }], options);
}

/** Pulse an element's CSS brightness multiplier. Existing filter styling returns after the animation. */
export function brightness(host: VisualHost | undefined, amount = 1.15, options: VisualOptions = {}): Promise<Outcome> {
	if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Brightness must be a non-negative multiplier.');
	return animate(
		host,
		[{ filter: 'brightness(1)' }, { filter: `brightness(${amount})` }, { filter: 'brightness(1)' }],
		options,
	);
}

/** Plain-text live region capability, satisfied by native Elements and small rendering adapters. */
export interface LiveRegion {
	/** Plain text owned conditionally by the announcer; never interpreted as HTML. */
	textContent: string | null;
	/** Read the current attribute so cleanup can preserve another writer's changes. */
	getAttribute(name: string): string | null;
	/** Set an ARIA attribute on the already mounted region. */
	setAttribute(name: string, value: string): void;
	/** Restore absence when an owned ARIA attribute did not exist before setup. */
	removeAttribute(name: string): void;
}

/** A borrowed live region with owned ARIA settings and text updates. */
export interface Announcer extends Disposable {
	/** Update text without interpreting markup. Assistive-technology delivery cannot be acknowledged by the Web API. */
	announce(message: string): void;
	/** Clear this announcer's text if no other writer has replaced it. */
	clear(): void;
	/** Restore still-owned text and attributes. Repeated disposal is harmless. */
	dispose(): void;
	/** True after explicit disposal or the supplied signal aborts. */
	readonly closed: boolean;
}

/**
 * Prepare a persistent live region before its first message, then borrow it until disposal.
 *
 * Put the region in the document before creating the announcer. Keep one owner
 * per region. Cleanup restores only values that still equal this owner's last
 * write, so external text or attribute changes survive. Announce a meaningful
 * status alongside optional sound or motion; this function does not move focus.
 */
export function announcer(
	region: LiveRegion,
	options: Options & { readonly priority?: 'polite' | 'assertive' } = {},
): Announcer {
	const owner = ownership.create(options.signal);
	const originalText = region.textContent;
	let writtenText = originalText;
	let wrote = false;
	/** Restore only the last write still owned by this announcer, including a setter that completed after abort. */
	const restoreText = () => {
		if (wrote && region.textContent === writtenText) region.textContent = originalText;
	};
	const settings = { 'aria-live': options.priority ?? 'polite', 'aria-atomic': 'true' };
	if (!owner.handle.closed) {
		try {
			for (const [name, value] of Object.entries(settings)) {
				const previous = region.getAttribute(name);
				const restore = () => {
					if (region.getAttribute(name) !== value) return;
					if (previous === null) region.removeAttribute(name);
					else region.setAttribute(name, previous);
				};
				owner.defer(restore);
				region.setAttribute(name, value);
				// A structural setter can abort before its write completes. Join that late write before restoration.
				if (owner.handle.closed) {
					restore();
					break;
				}
			}
			owner.defer(restoreText);
		} catch (error) {
			ownership.fail(owner, error);
		}
	}
	return {
		get closed() {
			return owner.handle.closed;
		},
		announce(message) {
			if (owner.handle.closed) throw new TypeError('This announcer is closed.');
			writtenText = message;
			wrote = true;
			region.textContent = message;
			if (owner.handle.closed) restoreText();
		},
		clear() {
			if (!owner.handle.closed && wrote && region.textContent === writtenText) {
				writtenText = '';
				region.textContent = '';
				if (owner.handle.closed) restoreText();
			}
		},
		dispose: owner.handle,
		[dispose]: owner.handle,
	};
}

/** Validate bounded cue times before acquiring any hardware or visual resource. */
function time(value: Time): number {
	const milliseconds = typeof value === 'number' ? value : elapsed(value);
	if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 60_000) {
		throw new RangeError('Cue time must be between 0 and 60000 milliseconds.');
	}
	return milliseconds;
}

/** Preserve intensity rather than silently clamping a caller's malformed configuration. */
function magnitude(value: number): number {
	if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Intensity must be between 0 and 1.');
	return value;
}

/** Stable capability absence result, distinct from a failed host operation. */
function unavailable(reason: Extract<Outcome, { status: 'unavailable' }>['reason']): Outcome {
	return { status: 'unavailable', reason };
}

/** Observe late native settlement even after cancellation, without retaining the abort listener. */
function abortable<T>(pending: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal?.removeEventListener('abort', abort);
			reject(signal?.reason);
		};
		if (!signal?.aborted) signal?.addEventListener('abort', abort, { once: true });
		Promise.resolve(pending).then(
			(value) => {
				signal?.removeEventListener('abort', abort);
				if (signal?.aborted) reject(signal.reason);
				else resolve(value);
			},
			(error) => {
				signal?.removeEventListener('abort', abort);
				reject(signal?.aborted ? signal.reason : error);
			},
		);
		if (signal?.aborted) abort();
	});
}

/**
 * Join the cue's cleanup before settling its result. Owned async disposal keeps
 * an exact operation failure, including undefined, as the suppressed value when
 * teardown also fails. No timeout can release a host while its reset is pending.
 */
async function cleaned<T>(operation: () => Promise<T>, cleanup: () => unknown): Promise<T> {
	await using resources = new AsyncDisposableStack();
	resources.defer(async () => {
		await cleanup();
	});
	return await operation();
}

/** One host-wide effect owner; private controllers combine user cancellation with supersession. */
async function exclusive(
	owners: WeakMap<object, CueOwner>,
	host: object,
	signal: AbortSignal | undefined,
	operation: (signal: AbortSignal) => Promise<Outcome>,
	stop: () => unknown,
): Promise<Outcome> {
	signal?.throwIfAborted();
	const controller = new AbortController();
	let failed = false;
	let started = false;
	let outcome: Outcome | undefined;
	const previous = owners.get(host);
	const owner: CueOwner = { controller, waiting: previous?.stopping ?? previous?.waiting };
	// Publish the successor before aborting the predecessor: reentrant cleanup must see the current owner.
	owners.set(host, owner);
	previous?.controller.abort(superseded);
	const abort = () => controller.abort(signal?.reason);
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) abort();
	return cleaned(async () => {
		try {
			controller.signal.throwIfAborted();
			if (owner.waiting !== undefined) {
				// A canceled waiter passes this same barrier to the next caller. Settled barriers can be released.
				const waiting = owner.waiting.then(
					() => {
						owner.waiting = undefined;
					},
					(error) => {
						owner.waiting = undefined;
						throw error;
					},
				);
				owner.waiting = waiting;
				await abortable(waiting, controller.signal);
			}
			controller.signal.throwIfAborted();
			started = true;
			outcome = await operation(controller.signal);
			controller.signal.throwIfAborted();
			return outcome;
		} catch (error) {
			failed = true;
			if (controller.signal.reason === superseded && !signal?.aborted) return { status: 'preempted' };
			throw error;
		}
	}, async () => {
		signal?.removeEventListener('abort', abort);
		if (owners.get(host) !== owner) return;
		try {
			if (!started) {
				await owner.waiting;
				return;
			}
			if (controller.signal.aborted || failed || outcome?.status === 'unavailable') {
				const stopped = Promise.withResolvers<void>();
				// Publish before invoking reset, so a reentrant successor inherits this exact cleanup barrier.
				owner.stopping = stopped.promise;
				void stopped.promise.catch(() => {});
				try {
					await stop();
					stopped.resolve();
				} catch (error) {
					stopped.reject(error);
					throw error;
				}
			}
		} finally {
			if (owners.get(host) === owner) owners.delete(host);
		}
	});
}
