/**
 * Drive one instantiated family module.
 *
 * The module owns a 64 KiB window and 16 state slots (see `packages/hash/wasm/abi/src/lib.rs`). This file
 * copies input into the window, calls the exports and copies output out. It never keeps a view on the
 * window across calls that the caller could observe, so callers always receive their own bytes.
 *
 * ```text
 *   hash(id, key, data)
 *     key + data fit in one window ──► oneshot ──► copy digest out
 *     otherwise ──► init ─► update × ⌈data / window⌉ ─► finish ─► read × more ─► dispose
 * ```
 *
 * @module
 */
import { type AlgorithmType, HMAC } from './registry.ts';

/** The functions every family module exports. */
export interface ExportsType {
	readonly memory: WebAssembly.Memory;
	window(): number;
	init(id: number, param: number, key: number): number;
	update(slot: number, len: number): number;
	finish(slot: number): number;
	read(slot: number, len: number): number;
	fork(slot: number): number;
	dispose(slot: number): number;
	oneshot(id: number, param: number, key: number, len: number): number;
}

/** Size of the module window in bytes. It matches `abi::WINDOW`. */
export const WINDOW = 64 * 1024;

/** Number of state slots. It matches `abi::SLOTS`. */
export const SLOTS = 16;

const messages: Record<number, string> = {
	[-1]: 'the module has no algorithm with this id',
	[-2]: `all ${SLOTS} hash states are in use; finish or dispose one first`,
	[-3]: 'the key or output length is not valid for this algorithm',
	[-4]: 'the hash state is finished or disposed',
};

/** Throw for a negative return code, and return the value otherwise. */
function check(code: number): number {
	if (code < 0) throw new RangeError(messages[code] ?? `hash module error ${code}`);
	return code;
}

/** Options for one digest. */
export interface OptionsType {
	/** HMAC key, the algorithm's own key, or customization bytes, by the algorithm's key type. */
	readonly key?: Uint8Array;
	/** Output length in bytes for an extendable output. */
	readonly length?: number;
}

/** Resolve the id and length parameter that the module expects. */
function select(algorithm: AlgorithmType, options: OptionsType): { id: number; param: number; length: number } {
	const key = options.key;
	if (options.length !== undefined && !algorithm.xof) {
		throw new TypeError('this algorithm has a fixed output length');
	}
	const length = options.length ?? algorithm.size;
	if (!Number.isSafeInteger(length) || length < 1 || length > 0xffff_ffff) {
		throw new RangeError('output length must be a positive 32-bit integer');
	}
	if (key && algorithm.key === 'none') throw new TypeError('this algorithm takes no key');
	if (!key && algorithm.key === 'required') throw new TypeError('this algorithm needs a key');
	const id = key && algorithm.key === 'hmac' ? algorithm.id | HMAC : algorithm.id;
	return { id, param: algorithm.xof ? length : 0, length };
}

/** An incremental hash state that lives in one module slot. */
export class State implements Disposable {
	#slot: number;
	readonly #engine: Engine;
	readonly #length: number;

	/** @internal Created by {@link Engine.create}. */
	constructor(engine: Engine, slot: number, length: number) {
		this.#engine = engine;
		this.#slot = slot;
		this.#length = length;
		engine.track(this, slot);
	}

	#live(): number {
		if (this.#slot < 0) throw new RangeError(messages[-4]);
		return this.#slot;
	}

	/** Absorb `data`. The bytes are copied before this returns. */
	update(data: Uint8Array): this {
		this.#engine.absorb(this.#live(), data);
		return this;
	}

	/** Copy this state, so that two inputs can share a prefix. */
	fork(): State {
		const slot = check(this.#engine.exports.fork(this.#live()));
		return new State(this.#engine, slot, this.#length);
	}

	/** Finish and return the output. The state cannot be used after this. */
	digest(): Uint8Array {
		const slot = this.#live();
		this.#slot = -1;
		this.#engine.untrack(this);
		return this.#engine.drain(slot, this.#length);
	}

	/** Free the slot without producing output. Calling it twice does nothing. */
	[Symbol.dispose](): void {
		if (this.#slot < 0) return;
		this.#engine.exports.dispose(this.#slot);
		this.#engine.untrack(this);
		this.#slot = -1;
	}
}

/** One instantiated family module. */
export class Engine {
	readonly exports: ExportsType;
	readonly #base: number;
	#view: Uint8Array;
	readonly #encoder = new TextEncoder();
	// A state that is dropped without digest() or dispose would hold a slot forever.
	readonly #leaks = new FinalizationRegistry<number>((slot) => this.exports.dispose(slot));

	constructor(exports: ExportsType) {
		this.exports = exports;
		this.#base = exports.window();
		this.#view = new Uint8Array(exports.memory.buffer, this.#base, WINDOW);
	}

	/** The window, recreated if a memory growth detached the old buffer. */
	#window(): Uint8Array {
		if (this.#view.byteLength === 0) this.#view = new Uint8Array(this.exports.memory.buffer, this.#base, WINDOW);
		return this.#view;
	}

	/** @internal */
	track(state: State, slot: number): void {
		this.#leaks.register(state, slot, state);
	}

	/** @internal */
	untrack(state: State): void {
		this.#leaks.unregister(state);
	}

	/** Hash `data` in one call. Strings are UTF-8. */
	hash(algorithm: AlgorithmType, data: Uint8Array | string, options: OptionsType = {}): Uint8Array {
		const { id, param, length } = select(algorithm, options);
		const key = options.key ?? new Uint8Array(0);
		const window = this.#window();
		if (key.length < WINDOW && length <= WINDOW) {
			window.set(key);
			let len = -1;
			if (typeof data === 'string') {
				// Three bytes per UTF-16 unit is the UTF-8 worst case, so a short string always fits.
				if (data.length * 3 <= WINDOW - key.length) {
					len = this.#encoder.encodeInto(data, window.subarray(key.length)).written;
				}
			} else if (data.length <= WINDOW - key.length) {
				window.set(data, key.length);
				len = data.length;
			}
			if (len >= 0) {
				const written = check(this.exports.oneshot(id, param, key.length, len));
				return window.slice(0, written);
			}
		}
		const state = this.create(algorithm, options);
		state.update(typeof data === 'string' ? this.#encoder.encode(data) : data);
		return state.digest();
	}

	/** Start an incremental state. */
	create(algorithm: AlgorithmType, options: OptionsType = {}): State {
		const { id, param, length } = select(algorithm, options);
		const key = options.key ?? new Uint8Array(0);
		if (key.length > WINDOW) throw new RangeError('key is longer than the module window');
		this.#window().set(key);
		const slot = check(this.exports.init(id, param, key.length));
		return new State(this, slot, length);
	}

	/** @internal Copy `data` through the window into `slot`. */
	absorb(slot: number, data: Uint8Array): void {
		const window = this.#window();
		for (let offset = 0; offset < data.length; offset += WINDOW) {
			const chunk = data.subarray(offset, offset + WINDOW);
			window.set(chunk);
			check(this.exports.update(slot, chunk.length));
		}
	}

	/** @internal Finish `slot` and collect `length` output bytes. */
	drain(slot: number, length: number): Uint8Array {
		const window = this.#window();
		const first = check(this.exports.finish(slot));
		if (first >= length) return window.slice(0, first);
		const out = new Uint8Array(length);
		out.set(window.subarray(0, first));
		try {
			for (let offset = first; offset < length; offset += WINDOW) {
				const size = Math.min(WINDOW, length - offset);
				check(this.exports.read(slot, size));
				out.set(window.subarray(0, size), offset);
			}
		} finally {
			this.exports.dispose(slot);
		}
		return out;
	}
}
