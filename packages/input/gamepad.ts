/** Detached gamepad snapshots and explicitly owned animation-frame polling. @module */
import type { Observable } from '@okikio/observables/observable';
import type { BindingHandle, ErrorReporter } from './types.ts';
import * as ownership from './ownership.ts';
import * as callback from './callback.ts';
import * as sources from './observe.ts';

/** Explicit per-axis calibration; no device profile is guessed or persisted. */
export interface CalibrationType {
	/** Smallest observed raw position. */
	readonly minimum: number;
	/** Raw neutral position, strictly between the extrema. */
	readonly center: number;
	/** Largest observed raw position. */
	readonly maximum: number;
	/** Normalized noise threshold from zero inclusive to one exclusive. */
	readonly deadzone: number;
	/** Reverse the calibrated sign. */
	readonly invert?: boolean;
}

/** Clamp and rescale noise without reading hardware or scheduling work. */
export function deadzone(value: number, threshold: number): number {
	if (!Number.isFinite(value) || !Number.isFinite(threshold) || threshold < 0 || threshold >= 1) {
		throw new RangeError('Invalid gamepad deadzone value or threshold.');
	}
	const clamped = Math.max(-1, Math.min(1, value));
	return Math.abs(clamped) <= threshold ? 0 : Math.sign(clamped) * (Math.abs(clamped) - threshold) / (1 - threshold);
}

/** Calibrate axes from a raw read (`deadzone: 0`), retaining detached bounded button values. */
export function calibrate(
	snapshot: Snapshot,
	profiles: readonly CalibrationType[],
	options: Readonly<{ maximumControls: number }>,
): Snapshot {
	const maximum = options.maximumControls;
	if (
		!Number.isSafeInteger(maximum) || maximum < 1 || snapshot.axes.length > maximum ||
		snapshot.buttons.length > maximum || profiles.length !== snapshot.axes.length
	) throw new RangeError('Invalid calibration control bound or profile count.');
	const axes = snapshot.axes.map((value, index) => {
		const profile = profiles[index]!;
		if (
			![value, profile.minimum, profile.center, profile.maximum].every(Number.isFinite) ||
			profile.minimum >= profile.center || profile.center >= profile.maximum
		) throw new RangeError('Calibration requires finite ordered extrema and center.');
		const normalized = (value - profile.center) /
			(value < profile.center ? profile.center - profile.minimum : profile.maximum - profile.center);
		return deadzone(normalized, profile.deadzone) * (profile.invert ? -1 : 1);
	});
	return Object.freeze({
		...snapshot,
		axes: Object.freeze(axes),
		buttons: Object.freeze(snapshot.buttons.map((button) => Object.freeze({ ...button }))),
	});
}

/** One named analog action derived from a physical axis or button value. */
export interface MappingType {
	/** Application action name; duplicate names are rejected. */
	readonly name: string;
	/** Select an axis or analog button. */
	readonly kind: 'axis' | 'button';
	/** Zero-based source control index. */
	readonly index: number;
	/** Optional finite multiplier, default one. */
	readonly scale?: number;
}

/** Bounds and explicit policy for a disconnected or incomplete control layout. */
export interface MappingOptionsType {
	/** Maximum authored action mappings. */
	readonly maximumBindings: number;
	/** Missing physical controls either fail or explicitly become zero. */
	readonly missing: 'zero' | 'reject';
}

/** Map a detached snapshot to inert named values without acquiring listeners or hardware. */
export function map(
	snapshot: Snapshot,
	bindings: readonly MappingType[],
	options: MappingOptionsType,
): Readonly<Record<string, number>> {
	if (
		!Number.isSafeInteger(options.maximumBindings) || options.maximumBindings < 1 ||
		bindings.length > options.maximumBindings || !['zero', 'reject'].includes(options.missing)
	) throw new RangeError('Invalid gamepad mapping policy.');
	const output: Record<string, number> = Object.create(null);
	for (const binding of bindings) {
		if (
			!binding.name || Object.hasOwn(output, binding.name) || !Number.isSafeInteger(binding.index) ||
			binding.index < 0 || !Number.isFinite(binding.scale ?? 1)
		) throw new TypeError('Invalid or duplicate gamepad mapping.');
		if (binding.kind !== 'axis' && binding.kind !== 'button') throw new TypeError('Unknown gamepad mapping kind.');
		const raw = binding.kind === 'axis' ? snapshot.axes[binding.index] : snapshot.buttons[binding.index]?.value;
		if (raw === undefined && options.missing === 'reject') {
			throw new RangeError('Gamepad mapping references a missing control.');
		}
		const value = (raw ?? 0) * (binding.scale ?? 1);
		if (!Number.isFinite(value)) throw new RangeError('Gamepad mapping produced a non-finite value.');
		output[binding.name] = value;
	}
	return Object.freeze(output);
}

/** A cold mapped source reuses the existing Observable lifetime and polling owner; no event queue is added. */
export function observeMapped(
	host: Host,
	frames: Frames,
	bindings: readonly MappingType[],
	options: Omit<WatchOptions, 'onError'> & MappingOptionsType,
): Observable<readonly Readonly<Record<string, number>>[]> {
	if (
		!Number.isSafeInteger(options.maximumBindings) || options.maximumBindings < 1 ||
		bindings.length > options.maximumBindings
	) throw new RangeError('Mapped observation exceeds maximumBindings.');
	const copied = bindings.map((binding) => Object.freeze({ ...binding }));
	return sources.from(
		(next, error) =>
			watch(host, frames, (devices) => next(Object.freeze(devices.map((device) => map(device, copied, options)))), {
				...options,
				onError: error,
			}),
		options.signal,
	);
}

/** Control fields read from a native Gamepad or a focused fake. */
export interface Device {
	/** Host-provided device identifier copied unchanged; index identifies its current slot. */
	readonly id: string;
	/** Slot used by the host gamepad list; retained for mapping application controls. */
	readonly index: number;
	/** Only connected devices are included in read snapshots. */
	readonly connected: boolean;
	/** Host mapping identifier, commonly standard; omitted mock values become an empty string. */
	readonly mapping?: string;
	/** Original host update timestamp; ignored when deciding whether controls changed. */
	readonly timestamp?: number;
	/** Host axis values; read applies a deadzone and clamps them to the interval -1 through 1. */
	readonly axes: ArrayLike<number>;
	/** Host analog and digital button states; omitted touched state becomes false. */
	readonly buttons: ArrayLike<{ readonly value: number; readonly pressed: boolean; readonly touched?: boolean }>;
}

/** Reading is separate from scheduling, so servers and tests can supply a deterministic snapshot source. */
export interface Host {
	/** Return current slots, including null/disconnected slots; permission failures are preserved. */
	getGamepads?(): ArrayLike<Device | null>;
}

/** Borrow the browser's frame scheduling or a deterministic test scheduler. */
export interface Frames {
	/** Schedule a later frame, never a synchronous callback; return the id used for cancellation. */
	requestAnimationFrame(callback: (time: number) => void): number;
	/** Cancel the exact queued frame without affecting other consumers of this scheduler. */
	cancelAnimationFrame(id: number): void;
}

/** A detached snapshot. Mutating a browser Gamepad later cannot rewrite this record. */
export interface Snapshot {
	/** Host-provided device identifier copied unchanged; index identifies its current slot. */
	readonly id: string;
	/** Slot used by the host gamepad list; retained for mapping application controls. */
	readonly index: number;
	/** Copied host mapping name; an empty string means the host did not name a standard mapping. */
	readonly mapping: string;
	/** Detached normalized axes after deadzone removal and full-range rescaling. */
	readonly axes: readonly number[];
	/** Detached button states; analog values are clamped from zero through one. */
	readonly buttons: readonly { readonly value: number; readonly pressed: boolean; readonly touched: boolean }[];
}

/** Explicit noise and snapshot bounds, shared by reads and watchers. */
export interface Options {
	/** Axes within this absolute value become zero. Remaining values are rescaled; defaults to 0.1. */
	readonly deadzone?: number;
	/** Maximum device slots inspected; defaults to 16. */
	readonly maxDevices?: number;
	/** Maximum axes and buttons copied per device; defaults to 64 each. */
	readonly maxControls?: number;
}

/** Read connected devices now; an unavailable API throws, while no connected devices returns an empty array. */
export function read(host: Host, options: Options = {}): readonly Snapshot[] {
	if (typeof host.getGamepads !== 'function') throw new TypeError('This host does not provide gamepad input.');
	const deadzone = options.deadzone ?? 0.1,
		maxDevices = options.maxDevices ?? 16,
		maxControls = options.maxControls ?? 64;
	if (!Number.isFinite(deadzone) || deadzone < 0 || deadzone >= 1) {
		throw new RangeError('Gamepad deadzone must be between zero and one, excluding one.');
	}
	if (!Number.isSafeInteger(maxDevices) || maxDevices < 1 || !Number.isSafeInteger(maxControls) || maxControls < 1) {
		throw new RangeError('Gamepad snapshot limits must be positive integers.');
	}
	const devices = host.getGamepads();
	if (!Number.isSafeInteger(devices.length) || devices.length < 0 || devices.length > maxDevices) {
		throw new RangeError('Gamepad slots exceed maxDevices.');
	}
	const result: Snapshot[] = [];
	for (let index = 0; index < devices.length; index++) {
		const device = devices[index];
		if (!device?.connected) continue;
		for (const controls of [device.axes, device.buttons]) {
			if (!Number.isSafeInteger(controls.length) || controls.length < 0 || controls.length > maxControls) {
				throw new RangeError('Gamepad controls exceed maxControls or have an invalid length.');
			}
		}
		const axes = Array.from(device.axes, (axis) => {
			if (!Number.isFinite(axis)) throw new TypeError('A gamepad axis must be finite.');
			const value = Math.max(-1, Math.min(1, axis));
			return Math.abs(value) <= deadzone ? 0 : Math.sign(value) * (Math.abs(value) - deadzone) / (1 - deadzone);
		});
		const buttons = Array.from(device.buttons, (button) => {
			if (!Number.isFinite(button.value)) throw new TypeError('A gamepad button value must be finite.');
			return {
				value: Math.max(0, Math.min(1, button.value)),
				pressed: Boolean(button.pressed),
				touched: Boolean(button.touched),
			};
		});
		result.push({ id: device.id, index: device.index, mapping: device.mapping ?? '', axes, buttons });
	}
	return result;
}

/** Polling lifetime and delivery policy. Input never starts a hidden global loop. */
export interface WatchOptions extends Options {
	/** Abort cancels the next scheduled frame and stops further delivery. */
	readonly signal?: AbortSignal;
	/** Emit the current snapshot once immediately; defaults to true. */
	readonly immediate?: boolean;
	/** Emit unchanged control values on every frame when true; defaults to false. */
	readonly everyFrame?: boolean;
	/** Report callback/source failures; an unavailable or failed source stops polling. */
	readonly onError?: ErrorReporter;
}

/** Compare controls directly, excluding browser timestamps so an idle device does not create false changes. */
function equal(left: readonly Snapshot[], right: readonly Snapshot[]): boolean {
	return left.length === right.length && left.every((device, index) => {
		const other = right[index]!;
		return device.id === other.id && device.index === other.index && device.mapping === other.mapping &&
			device.axes.length === other.axes.length && device.axes.every((axis, index) => axis === other.axes[index]) &&
			device.buttons.length === other.buttons.length && device.buttons.every((button, index) => {
				const otherButton = other.buttons[index]!;
				return button.value === otherButton.value && button.pressed === otherButton.pressed &&
					button.touched === otherButton.touched;
			});
	});
}

/**
 * Watch meaningful changes with exactly one next frame scheduled. The host and
 * frame scheduler remain borrowed. Disconnect emits a smaller/empty snapshot.
 * A read failure stops polling and reaches onError; callback failure alone does
 * not mutate the device or acquire a replacement source.
 */
export function watch(
	host: Host,
	frames: Frames,
	changed: (devices: readonly Snapshot[]) => unknown,
	options: WatchOptions = {},
): BindingHandle {
	const owner = ownership.create(options.signal);
	if (owner.handle.closed) return owner.handle;
	let scheduled: number | undefined;
	let previous: readonly Snapshot[];
	owner.defer(() => {
		if (scheduled !== undefined) frames.cancelAnimationFrame(scheduled);
		scheduled = undefined;
	});
	/** A mock may abort while requesting a frame. Release the returned id after registration unwinds. */
	const schedule = () => {
		const id = frames.requestAnimationFrame(tick);
		if (owner.handle.closed) frames.cancelAnimationFrame(id);
		else scheduled = id;
	};
	/** Read once per frame; source failure ends polling instead of creating an implicit retry loop. */
	const tick = () => {
		scheduled = undefined;
		if (owner.handle.closed) return;
		try {
			const value = read(host, options);
			if (options.everyFrame || !equal(previous, value)) {
				previous = value;
				callback.call(changed, value, options.onError);
			}
			if (!owner.handle.closed) schedule();
		} catch (error) {
			owner.handle();
			callback.report(error, options.onError);
		}
	};
	try {
		previous = read(host, options);
		if (owner.handle.closed) return owner.handle;
		if (options.immediate !== false) callback.call(changed, previous, options.onError);
		if (!owner.handle.closed) schedule();
	} catch (error) {
		ownership.fail(owner, error);
	}
	return owner.handle;
}

/** A cold gamepad source owns one polling loop per subscription and completes on source abort. */
export function observe(
	host: Host,
	frames: Frames,
	options: Omit<WatchOptions, 'onError'> = {},
): Observable<readonly Snapshot[]> {
	return sources.from((next, error) => watch(host, frames, next, { ...options, onError: error }), options.signal);
}
