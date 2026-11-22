import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { expect } from '@std/expect';
import * as native from './digest.ts';
import * as sync from './sync.ts';
import * as encoding from './encoding.ts';
import * as host from './_native.ts';
import { portable } from './_portable.ts';
import { web } from './_web.ts';

/** Encode literal vectors without obscuring their published text. */
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('SHA-2 admission and incremental ownership', () => {
	for (const name of ['sha256', 'sha384', 'sha512'] as const) {
		describe(name, () => {
			// SHA-256 pads 64-byte blocks; SHA-384/512 pad 128-byte blocks.
			// Name every boundary so one failed vector does not hide later cases.
			for (const length of [0, 1, 55, 56, 63, 64, 111, 112, 127, 128, 129, 8193]) {
				it(`matches an independent provider for ${length} bytes`, async () => {
					const bytes = Uint8Array.from({ length }, (_, index) => index % 251);
					const expected = createHash(name).update(bytes).digest('hex');
					expect(sync.digest(name, bytes, 'hex')).toBe(expected);
					expect(await native.digest(name, bytes, 'hex')).toBe(expected);
					// The fallback paths that a host without built-in node:crypto uses.
					expect(await web(name, bytes, 'hex')).toBe(expected);
					for (const create of [() => sync.create(name), () => portable(name)]) {
						const state = create();
						try {
							for (let offset = 0; offset < length; offset += 17) state.update(bytes.subarray(offset, offset + 17));
							expect(encoding.hex(state.digest())).toBe(expected);
							expect(() => state.digest()).toThrow();
							expect(() => state.update(bytes)).toThrow();
							expect(() => state.clone()).toThrow();
						} finally {
							state.destroy();
						}
					}
				});
			}
		});
	}
	it('forks independent unfinished states and consumes views immediately', () => {
		const state = sync.create().update(text('a'));
		const fork = state.clone();
		const bytes = text('bc');
		state.update(bytes);
		bytes.fill(0);
		expect(encoding.hex(state.digest())).toBe(sync.sha256('abc'));
		expect(encoding.hex(fork.update(text('bd')).digest())).toBe(sync.sha256('abd'));
		const abandoned = sync.create();
		abandoned.destroy();
		abandoned.destroy();
		expect(() => abandoned.clone()).toThrow();
	});
	it('uses the built-in hash on Deno, Node and Bun, and returns plain bytes from every path', async () => {
		expect(host.provider).toBeDefined();
		for (
			const value of [
				sync.digest('sha256', 'abc'),
				await native.digest('sha256', 'abc'),
				await web('sha256', 'abc', 'bytes'),
				sync.create().update(text('abc')).digest(),
				portable('sha256').update(text('abc')).digest(),
			]
		) {
			expect(Object.getPrototypeOf(value)).toBe(Uint8Array.prototype);
			expect(encoding.hex(value as Uint8Array)).toBe(sync.sha256('abc'));
		}
	});
	it('encodes text as UTF-8 the same way on every path, including a lone surrogate', async () => {
		for (const value of ['', 'é', 'a\ud800b', '\u{1f600}']) {
			const expected = createHash('sha256').update(new TextEncoder().encode(value)).digest('hex');
			expect(sync.sha256(value)).toBe(expected);
			expect(await native.sha256(value)).toBe(expected);
			expect(await web('sha256', value, 'hex')).toBe(expected);
		}
	});
	it('accepts a bare ArrayBuffer and rejects unknown algorithms and encodings before hashing', async () => {
		const buffer = text('abc').buffer;
		expect(sync.digest('sha256', buffer, 'hex')).toBe(sync.sha256('abc'));
		expect(await native.digest('sha256', buffer, 'hex')).toBe(sync.sha256('abc'));
		expect(await web('sha256', buffer, 'hex')).toBe(sync.sha256('abc'));
		const unknown = 'md5' as unknown as 'sha256';
		expect(() => sync.digest(unknown, 'abc')).toThrow(TypeError);
		expect(() => sync.create(unknown)).toThrow(TypeError);
		await expect(native.digest(unknown, 'abc')).rejects.toThrow(TypeError);
		await expect(native.digest('sha256', 'abc', 'base32' as unknown as 'hex')).rejects.toThrow(TypeError);
	});
	it('copies shared storage and byte-offset views before native work', async () => {
		const buffer = new SharedArrayBuffer(5);
		const bytes = new Uint8Array(buffer);
		bytes.set([0, 97, 98, 99, 0]);
		for (const hash of [native.digest, web] as const) {
			bytes.set([0, 97, 98, 99, 0]);
			const pending = hash('sha256', new DataView(buffer, 1, 3), 'base64url');
			bytes.fill(0);
			expect(await pending).toBe(encoding.base64url(sync.digest('sha256', 'abc')));
		}
		const view = new Uint8Array(new ArrayBuffer(5), 1, 3);
		view.set(text('abc'));
		const pending = web('sha256', view, 'hex');
		view.fill(0);
		expect(await pending).toBe(sync.sha256('abc'));
	});
});
