import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { asyncDispose } from './ponyfill.ts';
import { once } from './once.ts';

describe('joined one-time disposal', () => {
	it('is lazy and joins concurrent and later callers through one receipt', async () => {
		const barrier = Promise.withResolvers<void>();
		let calls = 0;
		const owner = once(() => {
			calls++;
			return barrier.promise;
		});
		expect(calls).toBe(0);
		const receipt = owner.close();
		expect(owner.close()).toBe(receipt);
		expect(owner[asyncDispose]()).toBe(receipt);
		await Promise.resolve();
		expect(calls).toBe(1);
		barrier.resolve();
		await receipt;
		expect(owner.close()).toBe(receipt);
		expect(calls).toBe(1);
	});
	it('publishes the receipt before a synchronous callback reenters close', async () => {
		let nested: Promise<void> | undefined;
		const owner = once(() => {
			nested = owner.close();
		});
		const receipt = owner.close();
		await receipt;
		expect(nested).toBe(receipt);
	});
	it('retains thrown undefined and rejected object identity for all callers', async () => {
		for (const reason of [undefined, new Error('cleanup')]) {
			let calls = 0;
			const owner = once(() => {
				calls++;
				throw reason;
			});
			const receipt = owner.close();
			await expect(receipt).rejects.toBe(reason);
			await expect(owner.close()).rejects.toBe(reason);
			expect(owner.close()).toBe(receipt);
			expect(calls).toBe(1);
		}
	});
	it('does not finish an uncooperative cleanup when another owner stops waiting', async () => {
		const barrier = Promise.withResolvers<void>();
		const owner = once(() => barrier.promise);
		let completed = false;
		const receipt = owner.close().then(() => {
			completed = true;
		});
		await Promise.resolve();
		expect(completed).toBe(false);
		barrier.resolve();
		await receipt;
		expect(completed).toBe(true);
	});
});
