import type { Admission, AdmissionCancellation, AdmissionLease, AdmissionLimits, AdmissionRequest, AdmissionSnapshot } from './types.ts';
import * as recordCore from '@okikio/record';

interface Waiter {
	readonly request: AdmissionRequest;
	readonly resolve: (lease: AdmissionLease) => void;
	readonly reject: (error: unknown) => void;
	readonly signal: AbortSignal | undefined;
	readonly queuedAt: number;
	removeAbortListener: (() => void) | undefined;
	settled: boolean;
}

interface State {
	readonly available: Map<string, number>;
	readonly waiters: Waiter[];
	readonly now: () => number;
}

const states = new WeakMap<Admission, State>();

/** Create one atomic FIFO admission pool from named non-negative integer limits. */
export function create(
	limits: AdmissionLimits,
	options: Readonly<{ readonly now?: () => number }> = {},
): Admission {
	const normalized = normalize(limits, 'capacity limit');
	const admission = Object.freeze({ limits: normalized });
	states.set(admission, {
		available: new Map(Object.entries(normalized)),
		waiters: [],
		now: options.now ?? (() => performance.now()),
	});
	return admission;
}

/** Return the currently unreserved units for every configured capacity name. */
export function available(admission: Admission): AdmissionLimits {
	const state = stateFor(admission);
	return Object.freeze(Object.fromEntries(state.available));
}

/** Return current limits, availability, and FIFO wait pressure. */
export function snapshot(admission: Admission): AdmissionSnapshot {
	const state = stateFor(admission);
	const oldest = state.waiters[0];
	return Object.freeze({
		capacity: admission.limits,
		available: available(admission),
		queuedRequests: state.waiters.length,
		...(oldest === undefined ? {} : { oldestWaitMs: Math.max(0, state.now() - oldest.queuedAt) }),
	});
}

/**
 * Reserve every requested unit atomically or wait at the FIFO head until the full request fits.
 *
 * The third argument accepts either an `AbortSignal` or any operation object with
 * a `signal`, including `@okikio/context` Context values.
 */
export async function acquire(
	admission: Admission,
	request: AdmissionRequest,
	cancellation?: AdmissionCancellation,
): Promise<AdmissionLease> {
	const state = stateFor(admission);
	const normalized = normalize(request, 'capacity request');
	assertPossible(admission, normalized);
	const signal = signalFor(cancellation);
	throwIfAborted(signal);
	if (state.waiters.length === 0 && canAcquire(state, normalized)) return createLease(admission, normalized);

	return await new Promise<AdmissionLease>((resolve, reject) => {
		const waiter: Waiter = {
			request: normalized,
			resolve,
			reject,
			signal,
			queuedAt: state.now(),
			removeAbortListener: undefined,
			settled: false,
		};
		if (signal !== undefined) {
			const abort = () => rejectWaiter(admission, waiter, abortReason(signal));
			signal.addEventListener('abort', abort, { once: true });
			waiter.removeAbortListener = () => signal.removeEventListener('abort', abort);
		}
		state.waiters.push(waiter);
		// Abort may race listener registration. Recheck after the waiter is visible.
		if (signal?.aborted) rejectWaiter(admission, waiter, abortReason(signal));
		else drain(admission);
	});
}

function normalize(value: Readonly<Record<string, number>>, name: string): AdmissionLimits {
	recordCore.assert(value, name);
	const entries: Array<readonly [string, number]> = [];
	for (const [key, amount] of Object.entries(value)) {
		if (key.length === 0) throw new TypeError(`${name} names must not be empty.`);
		if (!Number.isSafeInteger(amount) || amount < 0) {
			throw new TypeError(`${name} ${JSON.stringify(key)} must be a non-negative safe integer.`);
		}
		entries.push([key, amount]);
	}
	return Object.freeze(Object.fromEntries(entries));
}


function assertPossible(admission: Admission, request: AdmissionRequest): void {
	for (const [name, amount] of Object.entries(request)) {
		if (!Object.hasOwn(admission.limits, name)) throw new RangeError(`Unknown resource capacity: ${name}.`);
		const maximum = admission.limits[name]!;
		if (amount > maximum) {
			throw new RangeError(`Resource request for ${name} exceeds capacity: requested ${amount}, capacity ${maximum}.`);
		}
	}
}

function canAcquire(state: State, request: AdmissionRequest): boolean {
	return Object.entries(request).every(([name, amount]) => (state.available.get(name) ?? 0) >= amount);
}

/**
 * Reserve one request from the process-local availability snapshot.
 *
 * The returned lease restores every reserved unit exactly once and then drains
 * queued waiters, so release and async disposal are intentionally idempotent.
 */
function createLease(admission: Admission, request: AdmissionRequest): AdmissionLease {
	const state = stateFor(admission);
	for (const [name, amount] of Object.entries(request)) {
		state.available.set(name, (state.available.get(name) ?? 0) - amount);
	}
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		for (const [name, amount] of Object.entries(request)) {
			state.available.set(name, (state.available.get(name) ?? 0) + amount);
		}
		drain(admission);
	};
	return Object.freeze({
		request,
		release,
		[Symbol.asyncDispose]: async () => release(),
	});
}

/**
 * Grant queued requests in arrival order while the queue head fits.
 *
 * Head-of-line ordering prevents later small requests from starving a larger
 * earlier request. Aborted waiters are removed before capacity checks.
 */
function drain(admission: Admission): void {
	const state = stateFor(admission);
	while (state.waiters.length > 0) {
		const waiter = state.waiters[0]!;
		if (waiter.signal?.aborted) {
			rejectWaiter(admission, waiter, abortReason(waiter.signal));
			continue;
		}
		if (!canAcquire(state, waiter.request)) return;
		state.waiters.shift();
		settle(waiter, () => waiter.resolve(createLease(admission, waiter.request)));
	}
}

function rejectWaiter(admission: Admission, waiter: Waiter, reason: unknown): void {
	if (waiter.settled) return;
	const state = stateFor(admission);
	const index = state.waiters.indexOf(waiter);
	if (index >= 0) state.waiters.splice(index, 1);
	settle(waiter, () => waiter.reject(reason));
	drain(admission);
}

function settle(waiter: Waiter, action: () => void): void {
	if (waiter.settled) return;
	waiter.settled = true;
	waiter.removeAbortListener?.();
	action();
}

function signalFor(value: AdmissionCancellation | undefined): AbortSignal | undefined {
	if (value === undefined) return undefined;
	return 'signal' in value ? value.signal : value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException('The resource request was aborted.', 'AbortError');
}

function stateFor(admission: Admission): State {
	const state = states.get(admission);
	if (state === undefined) throw new TypeError('Admission value was not created by @okikio/capacity.');
	return state;
}
