import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readable } from '@okikio/streams';
import type { CleanupOutcome } from '@okikio/streams/reader';
import * as events from './events.ts';
const limits = { maximumBytes: 8192, maximumChunkBytes: 8192, maximumEventBytes: 1024, maximumEvents: 10 };
describe('bounded STD SSE composition', () => {
	it('preserves UTF-8, split CR/LF, multiline data, comment/id/retry and exact EOF semantics at every split', async () => {
		const bytes = new TextEncoder().encode(
			'\uFEFF:note\r\nevent:update\rdata:é😀\ndata:next\rid:7\r\nretry:25\r\n\r\n:heartbeat\n\nid:\n\ndata:final',
		);
		const expected = [
			{ comment: 'note', event: 'update', data: 'é😀\nnext', id: '7', retry: 25 },
			{ comment: 'heartbeat' },
			{ id: '' },
			{ data: 'final' },
		];
		for (let split = 0; split <= bytes.length; split++) {
			const source = readable([bytes.slice(0, split), bytes.slice(split)]);
			expect(await Array.fromAsync(events.read(source, limits))).toEqual(expected);
			expect(source.locked).toBe(false);
		}
		expect(await Array.fromAsync(events.read(readable([...bytes].map((byte) => new Uint8Array([byte]))), limits)))
			.toEqual(expected);
	});
	it('bounds accumulated events before STD allocation across chunks and counts unknown/comment fields too', async () => {
		for (const text of ['data:123456789\n\n', ':123456789\n\n', 'unknown:12345\n\n']) {
			const source = readable([...new TextEncoder().encode(text)].map((byte) => new Uint8Array([byte])));
			await expect(Array.fromAsync(events.read(source, { ...limits, maximumEventBytes: 8 }))).rejects.toThrow(
				RangeError,
			);
			expect(source.locked).toBe(false);
		}
		await expect(Array.fromAsync(events.read(readable([new Uint8Array(9)]), { ...limits, maximumChunkBytes: 8 })))
			.rejects.toThrow(RangeError);
		await expect(
			Array.fromAsync(
				events.read(readable([new TextEncoder().encode('data:a\n\ndata:b\n\n')]), { ...limits, maximumEvents: 1 }),
			),
		).rejects.toThrow(RangeError);
		await expect(
			Array.fromAsync(events.read(readable([new TextEncoder().encode('retry:999999999999999999999\n\n')]), limits)),
		).rejects.toThrow(RangeError);
	});
	it('releases the actual input reader promptly and exposes stalled/failed cancellation separately', async () => {
		const gate = Promise.withResolvers<void>();
		const defect = new Error('late cleanup');
		let cleanup!: Promise<CleanupOutcome>;
		let cancelled = false;
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('data:a\n\n'));
			},
			async cancel() {
				cancelled = true;
				await gate.promise;
				throw defect;
			},
		});
		const reader = events.read(source, {
			...limits,
			onCleanup: (outcome) => {
				cleanup = outcome;
			},
		});
		expect((await reader.next()).value).toEqual({ data: 'a' });
		await reader.return(undefined);
		expect(cancelled).toBe(true);
		expect(source.locked).toBe(false);
		gate.resolve();
		expect(await cleanup).toEqual({ status: 'failed', error: defect });
	});
	it('interrupts a pending input read with the exact cancellation reason', async () => {
		const controller = new AbortController();
		const reason = new Error('stop');
		const source = new ReadableStream<Uint8Array>();
		const result = events.read(source, { ...limits, signal: controller.signal }).next();
		controller.abort(reason);
		await expect(result).rejects.toBe(reason);
		expect(source.locked).toBe(false);
	});
	it('writes through STD with bounded complete output and rejects lost IDs/unsafe retry', async () => {
		const messages = [{ comment: 'keep\nalive', event: 'update', data: 'é\n😀', id: '7', retry: 100 }, {
			id: '',
			data: '',
		}];
		const chunks = await Array.fromAsync(events.write(readable(messages), limits));
		expect(await Array.fromAsync(events.read(readable(chunks), limits))).toEqual(messages);
		for (const message of [{ id: '\0' }, { id: 'a\nb' }, { retry: -1 }, { retry: Infinity }]) {
			await expect(Array.fromAsync(events.write(readable([message]), limits))).rejects.toThrow();
		}
		await expect(Array.fromAsync(events.write(readable([{ data: 'a' }]), { ...limits, maximumEventBytes: 1 }))).rejects
			.toThrow(RangeError);
		expect(await Array.fromAsync(events.read(readable([]), limits))).toEqual([]);
		expect(await Array.fromAsync(events.write(readable([]), limits))).toEqual([]);
	});
});

it('resets raw frame bounds correctly for bare CR, CRLF and split initial BOM', async () => {
	for (const separator of ['\r', '\n', '\r\n']) {
		const text = 'data:a' + separator + separator;
		const input = new TextEncoder().encode(text.repeat(3));
		const output = await Array.fromAsync(
			events.read(readable([...input].map((byte) => new Uint8Array([byte]))), {
				...limits,
				maximumEventBytes: new TextEncoder().encode(text).length,
			}),
		);
		expect(output).toEqual([{ data: 'a' }, { data: 'a' }, { data: 'a' }]);
	}
	const text = new TextEncoder().encode('\uFEFF\n\ndata:a\n\n');
	expect(
		await Array.fromAsync(events.read(
			readable([...text].map((byte) => new Uint8Array([byte]))),
			{ ...limits, maximumEventBytes: 8 },
		)),
	).toEqual([{ data: 'a' }]);
});
