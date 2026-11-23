/**
 * A pool of workers that hash many inputs in parallel. Each worker runs the family's WebAssembly module in its own
 * thread, so throughput grows with the number of cores until memory bandwidth is the limit.
 *
 * A pool helps when there are many inputs, or a few large ones. One input of a sequential hash (SHA-2, SHA-3, MD5)
 * still runs on one core. Inputs are split into one contiguous batch per worker, balanced by bytes, and the digests
 * come back in input order. Inputs that are all views of one `SharedArrayBuffer` reach the workers without a copy.
 * Other inputs are copied once per call into shared memory. The caller's buffers stay usable either way.
 *
 * @module
 */
import type { Context } from '@okikio/context';
import * as worker from '@okikio/worker/thread';
import { copy } from '../../_bytes.ts';
import type { InputType } from '../../_bytes.ts';
import type { HashOptionsType } from '../../_family.ts';
import type { FamilyType } from '../../_wasm/registry.ts';
import { type BatchType, type DigestsType, protocol } from './protocol.ts';
import { leaves, merge, mode, plan, subtreeKey } from './tree.ts';
import type { Engine } from '../../_wasm/engine.ts';

/** Inputs from this size up are split across workers by `hash()` for BLAKE3. */
const TREE = 1 << 20;

/** How to open a pool. */
export interface PoolOptionsType {
	/** Number of workers. Defaults to `navigator.hardwareConcurrency`, or 4 where the host does not report it. */
	readonly workers?: number;
	/**
	 * Creates each worker. Deno, Bun and browsers have a global `Worker` and need none. Node.js needs the adapter
	 * from `@okikio/runtime/node/worker`.
	 */
	readonly create?: worker.WorkerFactory;
	/** Grace period for each worker to stop cooperatively before it is terminated, in milliseconds. */
	readonly shutdownMs?: number;
}

/** An open pool. Dispose it, or call `close()`, to stop its workers. */
export interface PoolType<Name extends string> extends AsyncDisposable {
	/** The number of workers. */
	readonly size: number;
	/** Hash every input with the same algorithm and options. Resolves to one digest per input, in order. */
	many(ctx: Context, name: Name, inputs: readonly InputType[], options?: HashOptionsType): Promise<Uint8Array[]>;
	/**
	 * Hash one input on a worker, to keep it off the calling thread. A BLAKE3 input of 1 MiB or more is split into
	 * one subtree per worker, and the calling thread merges their chaining values. The digest is the same.
	 */
	hash(ctx: Context, name: Name, input: InputType, options?: HashOptionsType): Promise<Uint8Array>;
	/** Stop every worker and wait for them to exit. */
	close(): Promise<void>;
}

/** The visible bytes of an input, as a `Uint8Array` view. Text is encoded. */
function bytes(input: InputType): Uint8Array {
	if (typeof input === 'string') return copy(input);
	return ArrayBuffer.isView(input)
		? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
		: new Uint8Array(input);
}

const Shared = (globalThis as { SharedArrayBuffer?: SharedArrayBufferConstructor }).SharedArrayBuffer;

/** A batch's bytes and the start and end of each input in them, with the buffer to transfer, if any. */
interface PackedType {
	readonly data: Uint8Array;
	readonly offsets: Uint32Array;
	readonly transfer: ArrayBuffer[];
}

/**
 * Put a batch into one buffer the worker can read. When every input is a view of the same `SharedArrayBuffer`, that
 * buffer goes as it is and nothing is copied. Otherwise the inputs are copied once, end to end, into new shared memory,
 * or into an `ArrayBuffer` that is transferred where the host has no `SharedArrayBuffer` (a browser page that is not
 * cross-origin isolated). One copy costs less than cloning each buffer: on Bun, BLAKE3 on one worker ran at 0.21 GiB/s
 * with per-input clones and 0.51 GiB/s from shared memory.
 */
function pack(views: readonly Uint8Array[]): PackedType {
	const offsets = new Uint32Array(views.length * 2);
	const first = views[0]?.buffer;
	if (
		Shared && first instanceof Shared && first.byteLength <= 0xffff_ffff && views.every((view) => view.buffer === first)
	) {
		views.forEach((view, index) => {
			offsets[2 * index] = view.byteOffset;
			offsets[2 * index + 1] = view.byteOffset + view.byteLength;
		});
		return { data: new Uint8Array(first), offsets, transfer: [] };
	}
	const total = views.reduce((sum, view) => sum + view.byteLength, 0);
	if (total > 0xffff_ffff) throw new RangeError('One pool call can hash at most 4 GiB; split the inputs.');
	const buffer = Shared ? new Shared(total) : new ArrayBuffer(total);
	const data = new Uint8Array(buffer);
	let offset = 0;
	views.forEach((view, index) => {
		data.set(view, offset);
		offsets[2 * index] = offset;
		offsets[2 * index + 1] = offset += view.byteLength;
	});
	return { data, offsets, transfer: buffer instanceof ArrayBuffer ? [buffer] : [] };
}

/**
 * Split inputs with these byte sizes into at most `parts` contiguous, non-empty ranges of about equal weight. Each
 * input weighs its size plus one, so empty inputs still spread across workers.
 */
export function split(sizes: readonly number[], parts: number): [number, number][] {
	const total = sizes.reduce((sum, size) => sum + size + 1, 0);
	const ranges: [number, number][] = [];
	let start = 0;
	let sum = 0;
	for (let index = 0; index < sizes.length && ranges.length < parts - 1; index++) {
		sum += sizes[index]! + 1;
		const remaining = sizes.length - index - 1;
		const target = (total * (ranges.length + 1)) / parts;
		if (sum >= target || remaining === parts - ranges.length - 1) {
			ranges.push([start, index + 1]);
			start = index + 1;
		}
	}
	if (start < sizes.length) ranges.push([start, sizes.length]);
	return ranges;
}

/** Open a pool for one family. The family entry points wrap this with their algorithm names. */
export function open<Name extends string>(
	ctx: Context,
	family: FamilyType,
	options: PoolOptionsType = {},
): PoolType<Name> {
	const navigator = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator;
	const size = options.workers ?? Math.max(1, navigator?.hardwareConcurrency ?? 4);
	if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('workers must be a positive integer.');
	const module = new URL('./worker.ts', import.meta.url);
	const handles = Array.from({ length: size }, (_, index) =>
		worker.open<BatchType, DigestsType>(ctx, {
			module,
			protocol,
			name: `hash-${family}-${index}`,
			...(options.create ? { create: options.create } : {}),
			...(options.shutdownMs === undefined ? {} : { shutdownMs: options.shutdownMs }),
		}));
	let next = 0;
	let closing: Promise<void> | undefined;

	const batch = (name: string, packed: PackedType, options?: HashOptionsType): BatchType => ({
		family,
		name,
		data: packed.data,
		offsets: packed.offsets,
		...(options?.key === undefined ? {} : { key: copy(options.key) }),
		...(options?.length === undefined ? {} : { length: options.length }),
	});

	const many = async (
		request: Context,
		name: Name,
		inputs: readonly InputType[],
		options?: HashOptionsType,
	): Promise<Uint8Array[]> => {
		if (closing) throw new TypeError('The hash pool is closed.');
		const views = inputs.map(bytes);
		const ranges = split(views.map((view) => view.byteLength), Math.min(size, views.length));
		const offset = next;
		next = (next + ranges.length) % size;
		const results = await Promise.all(
			ranges.map(([start, end], index) => {
				const packed = pack(views.slice(start, end));
				return handles[(offset + index) % size]!.request(request, batch(name, packed, options), {
					transfer: packed.transfer,
				});
			}),
		);
		return results.flatMap((result, index) => {
			const [start, end] = ranges[index]!;
			const count = end - start;
			const width = result.digests.length / count;
			return Array.from({ length: count }, (_, item) => result.digests.slice(item * width, (item + 1) * width));
		});
	};

	const close = (): Promise<void> =>
		closing ??= Promise.all(handles.map((handle) => handle[Symbol.asyncDispose]())).then(() => {});

	let merger: Promise<Engine> | undefined;
	const tree = async (request: Context, name: string, view: Uint8Array, options?: HashOptionsType) => {
		merger ??= Promise.all([import('../../_wasm/load.ts'), import('../../_wasm/packed/blake.ts')]).then((
			[{ load, unpack }, { text }],
		) => unpack(text).then(load));
		const key = options?.key === undefined ? undefined : copy(options.key);
		const modeBytes = mode(name === 'blake3-derive', key);
		const root = plan(view.byteLength, size);
		const parts = leaves(root);
		// With shared memory every worker reads its part of one copy. Without it, each part is copied and
		// transferred, because cloning a view would clone the whole buffer behind it.
		const packed = Shared ? pack([view]) : undefined;
		const values = await Promise.all(parts.map((part, index) => {
			const start = (packed?.offsets[0] ?? 0) + part.offset;
			const data = packed
				? packed.data.subarray(start, start + part.length)
				: view.slice(part.offset, part.offset + part.length);
			return handles[index % size]!.request(request, {
				family,
				name,
				data,
				offsets: Uint32Array.of(0, part.length),
				subtree: subtreeKey(part.offset, modeBytes),
			}, { transfer: packed ? [] : [data.buffer as ArrayBuffer] }).then((result) => result.digests);
		}));
		return merge(await merger, root, values, modeBytes, options?.length ?? 32);
	};

	return {
		size,
		many,
		async hash(request, name, input, options) {
			const view = bytes(input);
			if (
				family === 'blake' && size > 1 && view.byteLength >= TREE && (name === 'blake3' || name === 'blake3-derive')
			) {
				if (closing) throw new TypeError('The hash pool is closed.');
				return await tree(request, name, view, options);
			}
			return (await many(request, name, [input], options))[0]!;
		},
		close,
		[Symbol.asyncDispose]: close,
	};
}
