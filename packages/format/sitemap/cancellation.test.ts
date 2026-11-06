import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { parseStream } from './mod.ts';
import type { CleanupOutcome } from '@okikio/streams/reader';

describe('sitemap byte reader ownership', () => {
	it('checks cancellation and byte limits before acquiring the source', async () => {
		const source = new ReadableStream<Uint8Array>();
		const reason = new Error('already stopped');
		await expect(
			parseStream({
				stream: source,
				url: 'https://example.test/sitemap.xml',
				signal: AbortSignal.abort(reason),
				onRecord() {},
			}),
		).rejects.toBe(reason);
		expect(source.locked).toBe(false);
		await expect(parseStream({ stream: source, url: 'https://example.test/sitemap.xml', maxBytes: -1, onRecord() {} }))
			.rejects.toThrow(RangeError);
		expect(source.locked).toBe(false);
		await source.cancel();
	});

	it('releases preparation failures and retains their cleanup outcome', async () => {
		const failure = new Error('first read failed');
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(failure);
			},
		});
		let cleanup!: Promise<CleanupOutcome>;
		await expect(parseStream({
			stream: source,
			url: 'https://example.test/sitemap.xml',
			onCleanup(value) {
				cleanup = value;
			},
			onRecord() {},
		})).rejects.toBe(failure);
		expect(source.locked).toBe(false);
		expect(await cleanup).toEqual({ status: 'failed', error: failure });
	});

	it('interrupts a stalled preparation read independently of delayed source cleanup', async () => {
		let rejectCleanup!: (error: unknown) => void;
		const source = new ReadableStream<Uint8Array>({
			cancel() {
				return new Promise<void>((_resolve, reject) => {
					rejectCleanup = reject;
				});
			},
		});
		const signal = new AbortController();
		let cleanup!: Promise<CleanupOutcome>;
		const parsing = parseStream({
			stream: source,
			url: 'https://example.test/sitemap.xml',
			signal: signal.signal,
			onCleanup(value) {
				cleanup = value;
			},
			onRecord() {},
		});
		const reason = new Error('stop first read');
		signal.abort(reason);
		await expect(parsing).rejects.toBe(reason);
		expect(source.locked).toBe(false);
		const failure = new Error('late cancellation failed');
		rejectCleanup(failure);
		expect(await cleanup).toEqual({ status: 'failed', error: failure });
	});

	it('stops buffered text and XML records after an awaited sink aborts', async () => {
		for (const format of ['text', 'xml']) {
			const controller = new AbortController();
			const reason = new Error('stop after one record');
			const text = format === 'text'
				? 'https://example.test/first\nhttps://example.test/second\n'
				: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/first</loc></url><url><loc>https://example.test/second</loc></url></urlset>';
			const source = new Blob([text]).stream();
			const seen: string[] = [];
			await expect(parseStream({
				stream: source,
				url: `https://example.test/sitemap.${format === 'text' ? 'txt' : 'xml'}`,
				signal: controller.signal,
				onRecord(record) {
					seen.push(record.loc);
					controller.abort(reason);
				},
			})).rejects.toBe(reason);
			expect(seen).toEqual(['https://example.test/first']);
			expect(source.locked).toBe(false);
		}
	});
});
