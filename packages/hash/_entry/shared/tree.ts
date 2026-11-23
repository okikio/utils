/**
 * Split one BLAKE3 input across workers. BLAKE3 is a binary tree of 1024-byte chunks, so separate subtrees can be
 * hashed in parallel and their chaining values merged. The result is the same digest as hashing in one pass.
 *
 * The split follows `left_subtree_len` from `blake3::hazmat`: the left part is the largest power of two chunks that
 * is shorter than the input. Both parts then start at a multiple of their own size, which hazmat requires.
 *
 * @module
 */
import type { Engine } from '../../_wasm/engine.ts';
import type { AlgorithmType } from '../../_wasm/registry.ts';

/** Module ids of the subtree and merge operations in the `blake` module. */
export const subtree: AlgorithmType = { id: 18, size: 32, xof: false, key: 'custom' };
const parent: AlgorithmType = { id: 19, size: 32, xof: false, key: 'custom' };
const root: AlgorithmType = { id: 20, size: 32, xof: true, key: 'custom' };

const CHUNK = 1024;

/** The length of the left subtree of an input longer than one chunk. */
export function left(length: number): number {
	const chunks = Math.floor((length - 1) / CHUNK);
	return 2 ** Math.floor(Math.log2(chunks)) * CHUNK;
}

/** A node of the split: a leaf that one worker hashes, or two halves that are merged. */
export type NodeType =
	| { readonly kind: 'leaf'; readonly offset: number; readonly length: number }
	| { readonly kind: 'pair'; readonly left: NodeType; readonly right: NodeType };

/** Split `length` bytes into at most `pieces` leaves along the tree. */
export function plan(length: number, pieces: number, offset = 0): NodeType {
	if (pieces <= 1 || length <= CHUNK) return { kind: 'leaf', offset, length };
	const size = left(length);
	return {
		kind: 'pair',
		left: plan(size, Math.ceil(pieces / 2), offset),
		right: plan(length - size, Math.floor(pieces / 2), offset + size),
	};
}

/** The leaves of a split, left to right. */
export function leaves(node: NodeType): { offset: number; length: number }[] {
	return node.kind === 'leaf' ? [node] : [...leaves(node.left), ...leaves(node.right)];
}

/** The mode bytes for a BLAKE3 call: 0 for hashing, 1 and the key, or 2 and the derive-key context. */
export function mode(derive: boolean, key: Uint8Array | undefined): Uint8Array {
	if (derive) return Uint8Array.of(2, ...(key ?? new Uint8Array(0)));
	return key === undefined ? Uint8Array.of(0) : Uint8Array.of(1, ...key);
}

/** The key bytes of a subtree operation: the 8-byte little-endian offset, then the mode. */
export function subtreeKey(offset: number, modeBytes: Uint8Array): Uint8Array {
	const key = new Uint8Array(8 + modeBytes.length);
	new DataView(key.buffer).setBigUint64(0, BigInt(offset), true);
	key.set(modeBytes, 8);
	return key;
}

/**
 * Merge chaining values up the split. `values` are the leaves' chaining values, left to right; the root merge
 * returns `length` bytes of output.
 */
export function merge(
	engine: Engine,
	node: NodeType,
	values: readonly Uint8Array[],
	modeBytes: Uint8Array,
	length: number,
): Uint8Array {
	let next = 0;
	const walk = (current: NodeType, top: boolean): Uint8Array => {
		if (current.kind === 'leaf') return values[next++]!;
		const pair = new Uint8Array(64);
		pair.set(walk(current.left, false), 0);
		pair.set(walk(current.right, false), 32);
		const out = engine.hash(top ? root : parent, pair, { key: modeBytes, ...(top ? { length } : {}) });
		if (out.length !== (top ? length : 32)) throw new RangeError('BLAKE3 merge received a malformed pair.');
		return out;
	};
	return walk(node, true);
}
