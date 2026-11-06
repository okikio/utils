import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { ChannelClosedError } from '@std/async';
import { Channel } from './channel.ts';

describe('Channel', () => {
	it('drains buffered values after close', async () => {
		const channel = new Channel<number>({ capacity: 2 });
		await channel.send(1);
		await channel.send(2);
		channel.close();

		const values: number[] = [];
		for await (const value of channel) values.push(value);
		expect(values).toEqual([1, 2]);
	});

	it('propagates close reasons after buffered values drain', async () => {
		const channel = new Channel<number>({ capacity: 1 });
		await channel.send(1);
		channel.close(new Error('failed'));

		const iterator = channel[Symbol.asyncIterator]();
		expect(await iterator.next()).toEqual({ done: false, value: 1 });
		await expect(iterator.next()).rejects.toThrow('failed');
	});

	it('closes when disposed', async () => {
		let channel!: Channel<number>;
		{
			await using owned = new Channel<number>({ capacity: 1 });
			channel = owned;
		}
		await expect(channel.receive()).rejects.toThrow();
	});

	for (const reason of [undefined, new ChannelClosedError('upstream failed')]) {
		it(`retains an explicit ${reason === undefined ? 'undefined' : 'ChannelClosedError'} close reason`, async () => {
			const channel = new Channel<number>({ capacity: 1 });
			await channel.send(1);
			channel.close(reason);
			channel.close();
			const iterator = channel[Symbol.asyncIterator]();
			expect(await iterator.next()).toEqual({ done: false, value: 1 });
			await expect(iterator.next()).rejects.toBe(reason);
			await expect(channel.receive()).rejects.toBe(reason);
		});
	}

	it('does not interpret a consumer-thrown ChannelClosedError as normal closure', async () => {
		const channel = new Channel<number>({ capacity: 1 });
		await channel.send(1);
		channel.close();
		const iterator = channel[Symbol.asyncIterator]();
		await iterator.next();
		const reason = new ChannelClosedError('consumer failed');
		if (iterator.throw === undefined) throw new Error('Expected a generator throw operation.');
		await expect(iterator.throw(reason)).rejects.toBe(reason);
	});
});
