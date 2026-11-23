import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as blake from './blake.ts';
import * as sha2 from './sha2.ts';
import * as shared from './_entry/shared/blake.ts';
import * as sharedSha2 from './_entry/shared/sha2.ts';
import { split } from './_entry/shared/pool.ts';

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const input = (length: number, seed = 0) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed) & 0xff);
const hasWorker = typeof (globalThis as { Worker?: unknown }).Worker === 'function';

describe('hash worker pools', () => {
	it('split inputs into contiguous ranges balanced by bytes', () => {
		expect(split([10, 10, 10, 10], 2)).toEqual([[0, 2], [2, 4]]);
		expect(split([100, 1, 1, 1], 2)).toEqual([[0, 1], [1, 4]]);
		expect(split([1, 1, 1], 3)).toEqual([[0, 1], [1, 2], [2, 3]]);
		expect(split([0, 0, 0, 0], 2)).toEqual([[0, 2], [2, 4]]);
		expect(split([5], 4)).toEqual([[0, 1]]);
	});

	it('give the same digests as the calling thread, in input order', { skip: !hasWorker }, async () => {
		await using ctx = context.create({ id: 'hash-pool' });
		await using pool = shared.open(ctx, { workers: 3 });
		expect(pool.size).toBe(3);
		await blake.ready();
		const inputs = Array.from({ length: 17 }, (_, index) => input(index * 997, index));
		const digests = await pool.many(ctx, 'blake3', inputs, { length: 48 });
		expect(digests.map(hex)).toEqual(inputs.map((data) => hex(blake.hash('blake3', data, { length: 48 }))));
		const key = input(32, 9);
		expect(hex(await pool.hash(ctx, 'blake2b-256', 'abc', { key }))).toBe(
			hex(blake.hash('blake2b-256', 'abc', { key })),
		);
		expect(await pool.many(ctx, 'blake3', [])).toEqual([]);
	});

	it('read inputs in shared memory and leave the caller buffers intact', { skip: !hasWorker }, async () => {
		await using ctx = context.create({ id: 'hash-pool-shared' });
		await using pool = sharedSha2.open(ctx, { workers: 2 });
		const memory = new Uint8Array(new SharedArrayBuffer(4096));
		memory.set(input(4096, 3));
		const views = [memory.subarray(0, 1000), memory.subarray(1000, 4096)];
		const plain = input(500, 5);
		const digests = await pool.many(ctx, 'sha256', [...views, plain, 'text']);
		expect(digests.map(hex)).toEqual([...views, plain, 'text'].map((data) => hex(sha2.hash('sha256', data))));
		expect(plain.byteLength).toBe(500);
	});

	it('reject an unknown algorithm and refuse work after close', { skip: !hasWorker }, async () => {
		await using ctx = context.create({ id: 'hash-pool-errors' });
		const pool = shared.open(ctx, { workers: 1 });
		await expect(pool.many(ctx, 'nope' as never, ['x'])).rejects.toThrow();
		await pool.close();
		await expect(pool.many(ctx, 'blake3', ['x'])).rejects.toThrow('closed');
		expect(() => shared.open(ctx, { workers: 0 })).toThrow(RangeError);
	});
});

describe('BLAKE3 split across workers', () => {
	it('plans subtrees that start at multiples of their size', async () => {
		const { leaves, left, plan } = await import('./_entry/shared/tree.ts');
		expect(left(1025)).toBe(1024);
		expect(left(4096)).toBe(2048);
		expect(left(4097)).toBe(4096);
		for (const [length, pieces] of [[5 << 20, 3], [1 << 20, 4], [3000, 8], [1024, 4], [7 * 1024 + 1, 5]] as const) {
			const parts = leaves(plan(length, pieces));
			expect(parts.length).toBeLessThanOrEqual(pieces);
			expect(parts.reduce((sum, part) => sum + part.length, 0)).toBe(length);
			for (const part of parts.slice(0, -1)) {
				expect(part.offset % part.length).toBe(0);
				expect(Math.log2(part.length / 1024) % 1).toBe(0);
			}
		}
	});

	it('gives the one-pass digest for plain, keyed, derive-key and long output', { skip: !hasWorker }, async () => {
		await using ctx = context.create({ id: 'hash-tree' });
		await using pool = shared.open(ctx, { workers: 3 });
		await blake.ready();
		const key = input(32, 7);
		for (const length of [1 << 20, (3 << 20) + 12345, 5 << 20]) {
			const data = input(length, length & 0xff);
			expect(hex(await pool.hash(ctx, 'blake3', data))).toBe(hex(blake.hash('blake3', data)));
			expect(hex(await pool.hash(ctx, 'blake3', data, { key, length: 100 }))).toBe(
				hex(blake.hash('blake3', data, { key, length: 100 })),
			);
			expect(hex(await pool.hash(ctx, 'blake3-derive', data, { key: 'context 2026' }))).toBe(
				hex(blake.hash('blake3-derive', data, { key: 'context 2026' })),
			);
		}
		const memory = new Uint8Array(new SharedArrayBuffer(3 << 20));
		memory.set(input(3 << 20, 1));
		const view = memory.subarray(1000, (2 << 20) + 999);
		expect(hex(await pool.hash(ctx, 'blake3', view, { length: 70_000 }))).toBe(
			hex(blake.hash('blake3', view, { length: 70_000 })),
		);
	});
});
