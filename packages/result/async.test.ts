import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as result from './mod.ts';
import * as asynchronous from './async.ts';

describe('asynchronous result composition', () => {
	it('skips failed callbacks and preserves their wrapper', async () => {
		const failed = result.fail('missing');
		const callback = () => {
			throw new Error('must not run');
		};
		expect(await asynchronous.map(failed, callback)).toBe(failed);
		expect(await asynchronous.flatMap(failed, callback)).toBe(failed);
	});
	it('awaits values and preserves the next result identity', async () => {
		expect(await asynchronous.map(result.ok(2), async (n) => n * 3)).toEqual(result.ok(6));
		const next = result.fail('invalid');
		expect(await asynchronous.flatMap(result.ok(2), async () => next)).toBe(next);
	});
	it('propagates synchronous defects and rejected undefined without reclassification', async () => {
		await expect(asynchronous.map(result.ok(1), () => {
			throw undefined;
		})).rejects.toBeUndefined();
		await expect(asynchronous.flatMap(result.ok(1), () => Promise.reject(undefined))).rejects.toBeUndefined();
		const defect = new Error('callback');
		await expect(asynchronous.map(result.ok(1), () => Promise.reject(defect))).rejects.toBe(defect);
	});
});
