import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as proxy from './proxy.ts';

describe('explicit proxy admission', () => {
	it('refuses an environment bypass for a required proxy', () => {
		for (const bypass of [['*'], ['.example'], [undefined, 'localhost']]) {
			expect(() => proxy.create({ url: 'socks5h://127.0.0.1:1055', bypass })).toThrow('empty NO_PROXY and no_proxy');
		}
	});

	it('rejects credentials and unexpected transport configuration without exposing secrets', () => {
		for (
			const url of [
				'invalid-secret',
				'file:///secret',
				'socks5h://user:secret@localhost:1055',
				'http://localhost/proxy',
			]
		) {
			expect(() => proxy.create({ url, bypass: [] })).toThrow(TypeError);
		}
	});

	it('rejects use after its owned lifetime ends', async () => {
		const transport = proxy.create({ bypass: [] });
		transport[Symbol.dispose]();
		transport[Symbol.dispose]();
		await expect(transport.fetch('https://proxy-target.invalid')).rejects.toThrow('disposed');
	});
});
