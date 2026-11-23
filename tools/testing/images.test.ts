import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as images from '../../tests/fixtures/images.ts';

describe('pinned container images', () => {
	it('pins every image by name, tag and digest, as the CI image cache requires', () => {
		for (const image of images.Images) {
			expect(image).toMatch(/^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/u);
		}
	});
});
