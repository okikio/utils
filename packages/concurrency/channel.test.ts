import { describe, it } from 'node:test';
import { expect } from '@std/expect';
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
});
