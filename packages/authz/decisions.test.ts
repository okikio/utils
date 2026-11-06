/** Provider data cannot gain policy authority through getters or inherited fields. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { decisions } from './decisions.ts';
import * as permission from './permission/mod.ts';

describe('inert authorization decisions', () => {
	it('rejects accessor decisions and list entries without invoking them', () => {
		let calls = 0;
		const decision = {
			get allowed() {
				calls++;
				return true;
			},
		};
		expect(() => decisions([decision], 1, (message) => new TypeError(message))).toThrow(TypeError);
		const list: unknown[] = [];
		Object.defineProperty(list, '0', {
			get() {
				calls++;
				return { allowed: true };
			},
			enumerable: true,
		});
		expect(() => decisions(list, 1, (message) => new TypeError(message))).toThrow(TypeError);
		expect(calls).toBe(0);
	});

	it('rejects inherited, ambiguous and sparse decisions', () => {
		for (
			const input of [
				[Object.create({ allowed: true })],
				[{ allowed: true, error: 'both' }],
				[{ allowed: 'yes' }],
				[{ allowed: true, surprise: 1 }],
				new Array(1),
			]
		) {
			expect(() => decisions(input, 1, (message) => new TypeError(message))).toThrow(TypeError);
		}
	});

	it('copies each decision and preserves an explicitly undefined failure', () => {
		const original = { allowed: false, reason: 'denied' };
		const result = decisions([original, { error: undefined }], 2, (message) => new TypeError(message));
		original.allowed = true;
		expect(result).toEqual([{ allowed: false, reason: 'denied' }, { error: undefined }]);
		expect(Object.hasOwn(result[1]!, 'error')).toBe(true);
	});

	it('requires canonical permission definitions even when metadata matches', () => {
		const declared = permission.define({ id: 'test.read', description: 'Read one item.' });
		const impostor = { ...declared };
		expect(permission.is(declared)).toBe(true);
		expect(permission.is(impostor)).toBe(false);
		expect(() => permission.require(impostor)).toThrow(TypeError);
		expect(() => permission.compose([impostor])).toThrow(TypeError);
	});
});
