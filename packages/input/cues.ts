/** Reusable finite cue policy. Public access belongs to input/feedback. @module */
import { asyncDispose } from '@okikio/dispose';
import { elapsed } from '@okikio/duration';
import * as schema from '@okikio/schema';
import * as feedback from './feedback.ts';

/** A reusable description. It retains no device, DOM node, signal or running effect. */
export interface Cue {
	/** Plain status text; an existing, application-owned announcer presents it. */
	readonly message?: string;
	/** Alternating vibration and pause times, bounded to 128 segments and one minute total. */
	readonly vibration?: readonly feedback.Time[];
	/** Dual-motor settings; duration defaults to 100 milliseconds. */
	readonly rumble?: Omit<feedback.RumbleOptions, 'signal'>;
	/** Oscillator settings; gain is multiplied by the playback policy's volume. */
	readonly tone?: Omit<feedback.ToneOptions, 'signal'>;
	/** A finite brightness pulse. The borrowed target's motion preference applies by default. */
	readonly brightness?: Omit<feedback.VisualOptions, 'signal' | 'reducedMotion'> & { readonly amount?: number };
}

/** One elapsed duration in milliseconds. Calendar durations must be converted before persistence. */
const MillisecondsSchema: schema.JsonReader<number, number> = schema.number({ minimum: 0, maximum: 60_000 });
/** Amplitude and motor intensity use an inclusive zero-to-one ratio. */
const IntensitySchema: schema.JsonReader<number, number> = schema.number({ minimum: 0, maximum: 1 });

/** Keep optional object-field inference exact while exposing an explicit, inexpensive JSR declaration. */
type OptionalObject<Fields extends schema.Shape> = schema.JsonReader<
	schema.ObjectOutput<Fields> | undefined,
	schema.ObjectInput<Fields> | undefined
>;

/**
 * Persisted cue settings contain milliseconds and plain values only.
 *
 * This schema rejects unknown keys. define() adds the total vibration-time rule
 * and copies the parsed containers into an immutable playback definition. Hosts,
 * signals and current user preferences belong to the player, never this record.
 */
export const CueSchema: schema.ObjectReader<{
	readonly message: schema.JsonReader<string | undefined, string | undefined>;
	readonly vibration: schema.JsonReader<number[] | undefined, number[] | undefined>;
	readonly rumble: OptionalObject<{
		readonly duration: typeof MillisecondsSchema;
		readonly strong: typeof IntensitySchema;
		readonly weak: typeof IntensitySchema;
	}>;
	readonly tone: OptionalObject<{
		readonly duration: typeof MillisecondsSchema;
		readonly frequency: schema.JsonReader<number, number>;
		readonly gain: typeof IntensitySchema;
		readonly wave: schema.JsonReader<
			'sine' | 'square' | 'sawtooth' | 'triangle',
			'sine' | 'square' | 'sawtooth' | 'triangle'
		>;
	}>;
	readonly brightness: OptionalObject<{
		readonly duration: typeof MillisecondsSchema;
		readonly amount: schema.JsonReader<number, number>;
		readonly easing: schema.JsonReader<string, string>;
	}>;
}, 'reject'> = schema.object({
	/** Plain live-region status; no markup interpretation. */
	message: schema.optional(schema.string()),
	/** Alternating vibration and pause milliseconds; total time is also checked by define(). */
	vibration: schema.optional(schema.array(MillisecondsSchema, { maxLength: 128 })),
	/** Finite dual-motor effect with normalized defaults supplied by define(). */
	rumble: schema.optional(schema.object({
		/** Elapsed milliseconds, at most one minute. */
		duration: MillisecondsSchema,
		/** Low-frequency amplitude from zero to one. */
		strong: IntensitySchema,
		/** High-frequency amplitude from zero to one. */
		weak: IntensitySchema,
	})),
	/** Finite oscillator effect; playback multiplies gain by the current policy volume. */
	tone: schema.optional(schema.object({
		/** Elapsed milliseconds, at most one minute. */
		duration: MillisecondsSchema,
		/** Positive oscillator frequency in hertz. */
		frequency: schema.number({ exclusiveMinimum: 0 }),
		/** Amplitude ratio before the playback policy's volume multiplier. */
		gain: IntensitySchema,
		/** Native oscillator waveform. */
		wave: schema.oneOf(['sine', 'square', 'sawtooth', 'triangle']),
	})),
	/** A temporary brightness pulse; no inline style is committed. */
	brightness: schema.optional(schema.object({
		/** Elapsed milliseconds, at most one minute. */
		duration: MillisecondsSchema,
		/** Non-negative CSS brightness multiplier. */
		amount: schema.number({ minimum: 0 }),
		/** CSS easing parsed by the borrowed animation host. */
		easing: schema.string(),
	})),
});

/** A parsed plain-value cue can be saved, loaded and passed through define() before playback. */
export type CueType = schema.Output<typeof CueSchema>;

/** Application-selected capabilities. Creating a player does not acquire or activate them. */
export interface CueHosts {
	/** Borrowed dedicated live region owner; disposing the player never disposes it. */
	readonly status?: Pick<feedback.Announcer, 'announce'>;
	/** Borrowed Navigator-like vibration capability. */
	readonly vibration?: feedback.VibrationHost;
	/** Borrowed selected gamepad actuator. */
	readonly rumble?: feedback.HapticHost;
	/** Borrowed, already-running audio graph. Playback never resumes or closes it. */
	readonly audio?: feedback.AudioHost;
	/** Borrowed animation target, normally an Element. */
	readonly visual?: feedback.VisualHost;
}

/** Sample application policy at the time of each interaction, rather than retaining stale preferences. */
export interface CuePolicy extends feedback.Options {
	/** False skips optional effects while still announcing text. Defaults to true. */
	readonly enabled?: boolean;
	/** True skips audio only. It does not remove text, haptics or visual feedback. */
	readonly muted?: boolean;
	/** Audio amplitude multiplier from zero to one. Zero skips audio. Defaults to one. */
	readonly volume?: number;
	/** Override visual motion policy. Omission reads the supplied element's own realm. */
	readonly reducedMotion?: boolean;
}

/** Results preserve each configured modality; none confirms human perception or business success. */
export interface CueResult {
	/** True means announce() returned, not that assistive technology spoke the message. */
	readonly announced: boolean;
	/** Present only when the cue requested a vibration pattern. */
	readonly vibration?: feedback.Outcome;
	/** Present only when the cue requested gamepad haptics. */
	readonly rumble?: feedback.Outcome;
	/** Present only when the cue requested sound. */
	readonly tone?: feedback.Outcome;
	/** Present only when the cue requested a brightness animation. */
	readonly brightness?: feedback.Outcome;
}

/** One interaction scope with at most one active playback and its joined cleanup. */
export interface CuePlayer extends AsyncDisposable {
	/** Start all configured modalities together after the preceding playback releases its effects. */
	play(cue: Cue, policy?: CuePolicy): Promise<CueResult>;
	/** Cancel active playback and join cleanup. Borrowed hosts and announcer remain open. */
	disposeAsync(): Promise<void>;
	/** True as soon as disposal starts; further playback rejects. */
	readonly closed: boolean;
}

/** Only deeply copied definitions enter this set, allowing repeated playback without revalidating data. */
const definitions = new WeakSet<object>();

/** Reject misspelled settings before normalization can discard them, including nested signal/host injection. */
function fields(value: object, allowed: readonly string[]): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Cue settings must be an object.');
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError(`Unknown cue setting: ${String(key)}.`);
	}
}

/** Normalize time once, so a retained cue does not borrow mutable duration objects. */
function duration(value: feedback.Time): number {
	const result = typeof value === 'number' ? value : elapsed(value);
	if (!Number.isFinite(result) || result < 0 || result > 60_000) {
		throw new RangeError('Cue duration must be between 0 and 60000 milliseconds.');
	}
	return result;
}

/** Invalid amplitude is a configuration error; silently clamping would hide caller mistakes. */
function intensity(value: number): number {
	if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Cue intensity must be between 0 and 1.');
	return value;
}

/**
 * Copy and validate reusable feedback before an interaction acquires any resource.
 *
 * A cue describes up to four finite effects and one text message. Define it once,
 * then pass current preferences to a player's play() method. The frozen result
 * owns its nested configuration and never retains a supplied host or signal.
 */
export function define(options: Cue): Cue {
	if (options === null || typeof options !== 'object') throw new TypeError('Cue settings must be an object.');
	if (definitions.has(options)) return options;
	fields(options, ['message', 'vibration', 'rumble', 'tone', 'brightness']);
	if (options.rumble !== undefined) fields(options.rumble, ['duration', 'strong', 'weak']);
	if (options.tone !== undefined) fields(options.tone, ['duration', 'frequency', 'gain', 'wave']);
	if (options.brightness !== undefined) fields(options.brightness, ['duration', 'amount', 'easing']);
	if (options.message !== undefined && typeof options.message !== 'string') {
		throw new TypeError('Cue message must be text.');
	}
	const vibration = options.vibration?.map((part) => Math.ceil(duration(part)));
	if (vibration !== undefined && (vibration.length > 128 || vibration.reduce((sum, part) => sum + part, 0) > 60_000)) {
		throw new RangeError('A vibration cue accepts at most 128 segments and one minute total.');
	}
	const rumble = options.rumble === undefined ? undefined : {
		duration: duration(options.rumble.duration ?? 100),
		strong: options.rumble.strong ?? 0.5,
		weak: options.rumble.weak ?? 0.5,
	};
	const tone = options.tone === undefined ? undefined : {
		duration: duration(options.tone.duration ?? 100),
		frequency: options.tone.frequency ?? 440,
		gain: options.tone.gain ?? 0.1,
		wave: options.tone.wave ?? 'sine',
	};
	const brightness = options.brightness === undefined ? undefined : {
		duration: duration(options.brightness.duration ?? 160),
		amount: options.brightness.amount ?? 1.15,
		easing: options.brightness.easing ?? 'ease-out',
	};
	const parsed = CueSchema.parse({
		...(options.message === undefined ? {} : { message: options.message }),
		...(vibration === undefined ? {} : { vibration }),
		...(rumble === undefined ? {} : { rumble }),
		...(tone === undefined ? {} : { tone }),
		...(brightness === undefined ? {} : { brightness }),
	});
	const cue = Object.freeze({
		...parsed,
		...(parsed.vibration === undefined ? {} : { vibration: Object.freeze(parsed.vibration) }),
		...(parsed.rumble === undefined ? {} : { rumble: Object.freeze(parsed.rumble) }),
		...(parsed.tone === undefined ? {} : { tone: Object.freeze(parsed.tone) }),
		...(parsed.brightness === undefined ? {} : { brightness: Object.freeze(parsed.brightness) }),
	});
	definitions.add(cue);
	return cue;
}

/** A pending owner is published before aborting its predecessor, including reentrant host callbacks. */
interface Playback {
	/** Private cancellation for this playback; borrowed caller signals are never aborted. */
	readonly controller: AbortController;
	/** Settlement includes every modality's resource cleanup, even after a sibling fails. */
	readonly pending: Promise<CueResult>;
}

/**
 * Create one playback owner for an application interaction scope.
 *
 * Every play supersedes the previous play with an AbortError and waits for its
 * cleanup. Distinct players are independent; vibration and rumble still obey the
 * existing per-host supersession rules. An effect error cancels its siblings and
 * joins every cleanup before rejecting. Native EventTarget listeners remain the
 * application's concern: call play() from a click, command or other native event.
 *
 * @example
 * ```ts
 * import { create, define } from '@okikio/input/feedback';
 * const saved = define({ message: 'Changes saved', brightness: { duration: 160 } });
 * await using player = create({ status: { announce: console.log } });
 * const result = await player.play(saved, { enabled: false });
 * console.log(result.announced); // true; optional brightness is disabled
 * ```
 */
export function create(hosts: CueHosts): CuePlayer {
	// Capture references once. Later mutation of the authoring object cannot replace borrowed hosts mid-play.
	const supplied = { ...hosts };
	/** Disposal closes admission before it asks any active host to stop. */
	let closed = false;
	/** The newest request retains the prior cleanup barrier even while waiting to start. */
	let current: Playback | undefined;
	/** Reentrant and repeated disposal share one join rather than starting independent teardown. */
	let closing: Promise<void> | undefined;
	/** Publish shutdown ownership before cancellation can invoke application or host callbacks. */
	const disposeAsync = (): Promise<void> => {
		if (closing !== undefined) return closing;
		closed = true;
		const active = current;
		const reason = new DOMException('Feedback player closed.', 'AbortError');
		const joined = Promise.withResolvers<void>();
		// Native cancellation can reenter disposal. Publish the shared join before abort invokes host callbacks.
		closing = joined.promise;
		active?.controller.abort(reason);
		const pending = active === undefined ? Promise.resolve() : active.pending.then(() => {}, (error: unknown) => {
			if (error !== reason) throw error;
		});
		void pending.then(joined.resolve, joined.reject);
		return closing;
	};
	return {
		get closed() {
			return closed;
		},
		async play(cue, policy = {}) {
			if (closed) return Promise.reject(new TypeError('This feedback player is closed.'));
			policy.signal?.throwIfAborted();
			const normalized = define(cue);
			const preferences = { ...policy, volume: intensity(policy.volume ?? 1) };
			for (const key of ['enabled', 'muted', 'reducedMotion'] as const) {
				if (preferences[key] !== undefined && typeof preferences[key] !== 'boolean') {
					throw new TypeError(`Cue ${key} policy must be boolean.`);
				}
			}
			const controller = new AbortController();
			const previous = current;
			const abort = () => controller.abort(preferences.signal?.reason);
			preferences.signal?.addEventListener('abort', abort, { once: true });
			if (preferences.signal?.aborted) abort();
			const pending = Promise.resolve().then(async () => {
				// The previous caller retains its failure. This barrier joins cleanup without reporting that old failure twice.
				await previous?.pending.catch(() => {});
				controller.signal.throwIfAborted();
				return await present(normalized, supplied, preferences, controller);
			}).finally(() => {
				preferences.signal?.removeEventListener('abort', abort);
				if (current?.controller === controller) current = undefined;
			});
			current = { controller, pending };
			previous?.controller.abort(new DOMException('Feedback playback superseded.', 'AbortError'));
			// Install a rejection observer before native callbacks can reenter. The returned promise preserves the failure.
			void pending.catch(() => {});
			return pending;
		},
		disposeAsync,
		[asyncDispose]: disposeAsync,
	};
}

/** Start finite effects only after text succeeds, and do not settle while a canceled sibling still owns resources. */
async function present(cue: Cue, hosts: CueHosts, policy: CuePolicy, controller: AbortController): Promise<CueResult> {
	const { signal } = controller;
	let announced = false;
	if (cue.message !== undefined && hosts.status !== undefined) {
		hosts.status.announce(cue.message);
		announced = true;
	}
	signal.throwIfAborted();
	const operations: { key: 'vibration' | 'rumble' | 'tone' | 'brightness'; run: () => Promise<feedback.Outcome> }[] =
		[];
	if (cue.vibration !== undefined) {
		operations.push({
			key: 'vibration',
			run: () => feedback.vibrate(hosts.vibration, cue.vibration!, { signal }),
		});
	}
	if (cue.rumble !== undefined) {
		operations.push({
			key: 'rumble',
			run: () => feedback.rumble(hosts.rumble, { ...cue.rumble, signal }),
		});
	}
	if (cue.tone !== undefined) {
		operations.push({
			key: 'tone',
			run: () =>
				feedback.tone(hosts.audio, { ...cue.tone, gain: (cue.tone!.gain ?? 0.1) * (policy.volume ?? 1), signal }),
		});
	}
	if (cue.brightness !== undefined) {
		operations.push({
			key: 'brightness',
			run: () =>
				feedback.brightness(hosts.visual, cue.brightness!.amount, {
					...cue.brightness,
					reducedMotion: policy.reducedMotion,
					signal,
				}),
		});
	}
	const settled = await Promise.allSettled(operations.map(async ({ key, run }) => {
		if (policy.enabled === false) return { status: 'unavailable', reason: 'disabled' } as const;
		if (key === 'tone' && (policy.muted === true || policy.volume === 0)) {
			return { status: 'unavailable', reason: 'muted' } as const;
		}
		try {
			return await run();
		} catch (error) {
			controller.abort(error);
			throw error;
		}
	}));
	// Cleanup failures can differ from the cancellation reason. Keep all distinct failures instead of hiding them behind abort.
	const errors = [
		...new Set(settled.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason as unknown)),
	];
	if (errors.length > 1) throw new AggregateError(errors, 'Feedback playback and cleanup failed.');
	if (errors.length === 1) throw errors[0];
	signal.throwIfAborted();
	const result: {
		announced: boolean;
		vibration?: feedback.Outcome;
		rumble?: feedback.Outcome;
		tone?: feedback.Outcome;
		brightness?: feedback.Outcome;
	} = { announced };
	for (const [index, entry] of settled.entries()) {
		if (entry.status === 'fulfilled') result[operations[index]!.key] = Object.freeze(entry.value);
	}
	return Object.freeze(result);
}
