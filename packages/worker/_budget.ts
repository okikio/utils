/** Logical structured-clone payload accounting. Native transport queues and VM object overhead are not observable. */
import type { PayloadBudgetType } from './protocol.ts';

/** A reservation retains its measured cost after ArrayBuffers are detached by a native transfer. */
export interface Reservation {
	/** Replace the input representation with its encoded envelope before sending, without charging both. */
	replace(value: unknown, transfer?: readonly unknown[]): void;
	/** Release only when this transport owner stops retaining the represented work. Idempotent. */
	close(): void;
}

/** Shared count/byte admission owner. No waiter is allocated when a measured payload exceeds either limit. */
export class Budget {
	readonly #options: PayloadBudgetType | undefined;
	/** Encoded request liabilities and currently decoding/writing message costs; not native queued bytes. */
	#bytes = 0;
	/** Snapshot valid limits before any request can reserve payload memory. Undefined disables accounting. */
	constructor(options: PayloadBudgetType | undefined) {
		if (options !== undefined) {
			for (const value of [options.maximumMessageBytes, options.maximumInFlightBytes, options.maximumNodes]) {
				if (!Number.isSafeInteger(value) || value < 1) {
					throw new RangeError('Worker payload budgets must be positive safe integers.');
				}
			}
			const depth = options.maximumDepth ?? 128;
			if (!Number.isSafeInteger(depth) || depth < 0) {
				throw new RangeError('Worker payload maximumDepth must be a non-negative safe integer.');
			}
			this.#options = Object.freeze({ ...options, maximumDepth: depth });
		}
	}
	/** Admit one liability synchronously, before an asynchronous codec or queued write can retain it. */
	hold(value: unknown, transfer?: readonly unknown[]): Reservation {
		let current = 0, closed = false;
		/**
		 * Replace this reservation's cost without charging the old and new forms together.
		 * Check the new total before changing counters so rejection leaves the prior reservation intact.
		 */
		const replace = (value: unknown, transfer?: readonly unknown[]): void => {
			if (closed) throw new TypeError('Payload reservation is closed.');
			const next = this.#options === undefined ? 0 : size(value, transfer, this.#options);
			if (this.#options !== undefined && this.#bytes - current + next > this.#options.maximumInFlightBytes) {
				throw new RangeError('Worker exceeds maximumInFlightBytes.');
			}
			this.#bytes += next - current;
			current = next;
		};
		replace(value, transfer);
		return {
			replace,
			close: () => {
				if (!closed) {
					closed = true;
					this.#bytes -= current;
				}
			},
		};
	}
}

/**
 * Count UTF-8 strings/keys, eight bytes per numeric/date/bigint value, and full binary backing stores once
 * per message, including transfer-only buffers. Repeated graph references and views do not charge their
 * backing store twice. Signed 64-bit BigInts charge eight logical bytes; larger BigInts reject. This is not an encoding size.
 * Unsupported host objects require a narrower wire codec; getters and custom serializers never run.
 */
function size(value: unknown, transfer: readonly unknown[] | undefined, options: PayloadBudgetType): number {
	let bytes = 0, nodes = 0;
	// Distinct objects cost traversal work; shared references and cycles must not be visited forever.
	const seen = new Set<object>();
	const stores = new Set<ArrayBufferLike>();
	/** Charge logical bytes and reject unsafe totals before a request can be admitted. */
	function add(amount: number): void {
		bytes += amount;
		if (!Number.isSafeInteger(bytes) || bytes > options.maximumMessageBytes) {
			throw new RangeError('Worker exceeds maximumMessageBytes.');
		}
	}
	/** Count UTF-8 bytes directly, including surrogate pairs, without allocating an encoded copy. */
	function text(value: string): void {
		for (let index = 0; index < value.length; index++) {
			const point = value.codePointAt(index)!;
			add(point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4);
			if (point > 0xffff) index++;
		}
	}
	/**
	 * Charge a buffer's complete backing store once per message.
	 * Sending a small view can still transfer the full store, so view length is insufficient.
	 */
	function buffer(value: ArrayBufferLike): void {
		if (!stores.has(value)) {
			stores.add(value);
			const prototype = value instanceof ArrayBuffer ? ArrayBuffer.prototype : SharedArrayBuffer.prototype;
			add(Object.getOwnPropertyDescriptor(prototype, 'byteLength')!.get!.call(value));
		}
	}
	/**
	 * Walk supported payload data without invoking getters or custom serializers.
	 * Count nodes and depth as well as bytes: tiny values can still form an expensive graph.
	 */
	function visit(value: unknown, depth = 0): void {
		if (depth > (options.maximumDepth ?? 128)) throw new RangeError('Worker payload exceeds maximumDepth.');
		if (++nodes > options.maximumNodes) throw new RangeError('Worker payload exceeds maximumNodes.');
		if (typeof value === 'string') {
			text(value);
			return;
		}
		if (typeof value === 'bigint' && BigInt.asIntN(64, value) !== value) {
			throw new RangeError('Payload-budgeted BigInts must fit signed 64 bits.');
		}
		if (typeof value === 'number' || typeof value === 'bigint') {
			add(8);
			return;
		}
		if (typeof value === 'boolean') {
			add(1);
			return;
		}
		if (value === null || value === undefined) return;
		if (typeof value !== 'object') throw new TypeError('Unsupported worker payload value.');
		if (seen.has(value)) return;
		seen.add(value);
		if (
			value instanceof ArrayBuffer || typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer
		) {
			buffer(value);
			return;
		}
		if (ArrayBuffer.isView(value)) {
			const prototype = value instanceof DataView ? DataView.prototype : Object.getPrototypeOf(Uint8Array.prototype);
			buffer(Object.getOwnPropertyDescriptor(prototype, 'buffer')!.get!.call(value));
			return;
		}
		if (value instanceof Date) {
			add(8);
			return;
		}
		if (value instanceof Map) {
			for (const [key, item] of Map.prototype.entries.call(value)) {
				visit(key, depth + 1);
				visit(item, depth + 1);
			}
			return;
		}
		if (value instanceof Set) {
			for (const item of Set.prototype.values.call(value)) visit(item, depth + 1);
			return;
		}
		if (
			Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null &&
			!Array.isArray(value)
		) throw new TypeError('Payload budget requires inert records, arrays, collections, dates or binary buffers.');
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== 'string') throw new TypeError('Worker payload symbols are unsupported.');
			if (Array.isArray(value) && key === 'length') continue;
			const field = Object.getOwnPropertyDescriptor(value, key)!;
			if (!field.enumerable) continue;
			if (!('value' in field)) throw new TypeError('Worker payload accessors are unsupported.');
			text(key);
			visit(field.value, depth + 1);
		}
	}
	visit(value);
	for (const item of transfer ?? []) {
		if (!(item instanceof ArrayBuffer)) throw new TypeError('Payload-budgeted transfers require ArrayBuffers.');
		buffer(item);
	}
	return bytes;
}
