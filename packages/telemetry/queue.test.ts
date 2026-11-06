import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { queued, reporter } from './json.ts';
import { event } from './mod.ts';

/** Fixed timestamp makes the encoded representation byte-for-byte reproducible across runtimes. */
const record = (name: string) => event({ name, at: '2026-11-04T00:00:00.000Z', message: 'é😀' });
async function lineBytes(): Promise<number> {
	let size = 0;
	await reporter({
		write: (line) => {
			size = new TextEncoder().encode(line).byteLength;
		},
	}).report(record('a'));
	return size;
}
describe('bounded JSON delivery ownership', () => {
	it('charges the active line, rejects max+1 before retaining, and joins a stalled writer', async () => {
		const gate = Promise.withResolvers<void>();
		const lines: string[] = [];
		const size = await lineBytes();
		await using output = queued({
			write: async (line) => {
				lines.push(line);
				await gate.promise;
			},
			maximumRecords: 2,
			maximumQueuedBytes: size * 2,
			overflow: 'reject',
		});
		// Release the test gate before the reporter owner joins its active writer.
		using release = { [Symbol.dispose]: () => gate.resolve() };
		void release;
		output.report(record('a'));
		output.report(record('b'));
		expect(output.stats()).toEqual({ records: 2, bytes: size * 2, dropped: 0, errors: 0, state: 'open' });
		expect(() => output.report(record('c'))).toThrow(RangeError);
		let closed = false;
		const closing = output.close().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		expect(() => output.report(record('c'))).toThrow(ReferenceError);
		gate.resolve();
		await closing;
		await output.close();
		expect(lines.map((line) => JSON.parse(line).name)).toEqual(['a', 'b']);
		expect(output.stats()).toEqual({ records: 0, bytes: 0, dropped: 0, errors: 0, state: 'closed' });
	});
	it('drops only waiting oldest lines, never active writes, and drops oversized newcomers without evicting useful history', async () => {
		for (const overflow of ['drop-oldest', 'drop-newest'] as const) {
			const gate = Promise.withResolvers<void>();
			const names: string[] = [];
			const size = await lineBytes();
			await using output = queued({
				write: async (line) => {
					names.push(JSON.parse(line).name);
					await gate.promise;
				},
				maximumRecords: 2,
				maximumQueuedBytes: size * 2,
				overflow,
			});
			// Release the test gate before the reporter owner joins its active writer.
			using release = { [Symbol.dispose]: () => gate.resolve() };
			void release;
			output.report(record('a'));
			output.report(record('b'));
			output.report(record('c'));
			output.report(record('x'.repeat(1000)));
			expect(output.stats().dropped).toBe(2);
			expect(output.stats().records).toBe(2);
			gate.resolve();
			await output.close();
			expect(names).toEqual(overflow === 'drop-oldest' ? ['a', 'c'] : ['a', 'b']);
		}
	});
	it('retains the first arbitrary sink failure through flush and repeated close while attempting remaining writes', async () => {
		const first = undefined;
		let calls = 0;
		let flushed = 0;
		const output = queued({
			write: async () => {
				if (++calls === 1) throw first;
			},
			flush: () => {
				flushed++;
				throw new Error('later flush');
			},
			maximumRecords: 3,
			maximumQueuedBytes: 10000,
			overflow: 'reject',
		});
		output.report(record('a'));
		output.report(record('b'));
		const flush = output.flush();
		expect(output.flush()).toBe(flush);
		await expect(flush).rejects.toBe(first);
		const close = output.close();
		expect(output.close()).toBe(close);
		await expect(close).rejects.toBe(first);
		expect(calls).toBe(2);
		expect(flushed).toBe(2);
		expect(output.stats().errors).toBe(3);
	});
	it('serializes reentrant admission and pauses writes during destination flush', async () => {
		const names: string[] = [];
		const gate = Promise.withResolvers<void>();
		let inside = 0;
		let peak = 0;
		let flushes = 0;
		await using output = queued({
			write: async (line) => {
				inside++;
				peak = Math.max(peak, inside);
				const name = JSON.parse(line).name;
				names.push(name);
				if (name === 'a') output.report(record('b'));
				await Promise.resolve();
				inside--;
			},
			flush: async () => {
				if (++flushes === 1) {
					output.report(record('c'));
					await gate.promise;
				}
			},
			maximumRecords: 3,
			maximumQueuedBytes: 10000,
			overflow: 'reject',
		});
		// Release the test gate before the reporter owner joins its active writer.
		using release = { [Symbol.dispose]: () => gate.resolve() };
		void release;
		output.report(record('a'));
		const flush = output.flush();
		while (flushes === 0) await Promise.resolve();
		expect(names).toEqual(['a', 'b']);
		expect(output.stats().records).toBe(1);
		const closed = output.close();
		gate.resolve();
		await flush;
		await closed;
		expect(names).toEqual(['a', 'b', 'c']);
		expect(peak).toBe(1);
		expect(output.stats().bytes).toBe(0);
	});
});

it('enforces the byte limit independently of the record limit and makes zero capacity explicit', async () => {
	const size = await lineBytes();
	const gate = Promise.withResolvers<void>();
	await using output = queued({
		write: () => gate.promise,
		maximumRecords: 10,
		maximumQueuedBytes: size,
		overflow: 'reject',
	});
	// Release the test gate before the reporter owner joins its active writer.
	using release = { [Symbol.dispose]: () => gate.resolve() };
	void release;
	output.report(record('a'));
	expect(() => output.report(record('b'))).toThrow(RangeError);
	gate.resolve();
	await output.close();
	const disabled = queued({
		write: () => {
			throw new Error('must not write');
		},
		maximumRecords: 0,
		maximumQueuedBytes: 0,
		overflow: 'drop-newest',
	});
	disabled.report(record('a'));
	expect(disabled.stats().dropped).toBe(1);
	await disabled.close();
});
