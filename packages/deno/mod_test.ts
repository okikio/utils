import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as permissions from './permissions.ts';

describe('Deno permission arguments', () => {
	it('builds stable unscoped and scoped allow arguments', () => {
		expect(permissions.args({
			write: ['/tmp/output', '/tmp/output', '/tmp/cache,one'],
			read: true,
			net: false,
			run: ['chromium'],
		})).toEqual([
			'--allow-read',
			'--allow-write=/tmp/output,/tmp/cache,,one',
			'--allow-run=chromium',
		]);
	});

	it('round trips canonical scoped arguments including literal commas', () => {
		const built = permissions.args({
			write: ['/tmp/cache,one', '/tmp/output'],
			env: ['TMPDIR', 'HOME'],
		});
		expect(permissions.parse(built)).toEqual({
			write: ['/tmp/cache,one', '/tmp/output'],
			env: ['TMPDIR', 'HOME'],
		});
	});

	it('merges repeated scoped flags and lets an unscoped grant dominate', () => {
		expect(permissions.parse([
			'--allow-read=/srv/a',
			'--allow-read=/srv/b',
			'--allow-read',
		])).toEqual({ read: true });
	});

	it('rejects unsupported arguments and empty scope entries', () => {
		expect(() => permissions.parse(['--quiet'])).toThrow('Expected a Deno --allow-*');
		expect(() => permissions.parse(['--allow-read='])).toThrow('must not be empty');
		expect(() => permissions.decodeList('/a,/b,')).toThrow('empty values');
	});
});
