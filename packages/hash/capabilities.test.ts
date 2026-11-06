import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { expect } from '@std/expect';
import * as native from './digest.ts';
import * as sync from './sync.ts';
import * as encoding from './encoding.ts';

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
					const state = sync.create(name);
					try {
						for (let offset = 0; offset < length; offset += 17) state.update(bytes.subarray(offset, offset + 17));
						expect(encoding.hex(state.digest())).toBe(expected);
						expect(() => state.digest()).toThrow();
						expect(() => state.update(bytes)).toThrow();
						expect(() => state.clone()).toThrow();
					} finally {
						state.destroy();
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
	it('copies shared storage and byte-offset views before native work', async () => {
		const buffer = new SharedArrayBuffer(5);
		const bytes = new Uint8Array(buffer);
		bytes.set([0, 97, 98, 99, 0]);
		const pending = native.digest('sha256', new DataView(buffer, 1, 3), 'base64url');
		bytes.fill(0);
		expect(await pending).toBe(encoding.base64url(sync.digest('sha256', 'abc')));
	});
});
