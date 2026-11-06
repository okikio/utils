import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as csv from './mod.ts';
import type { CleanupOutcome } from '@okikio/streams/reader';

describe('CSV discovery cancellation and explicit source choices', () => {
	it('does not acquire a reader for pre-aborted input', async () => {
		let cancels = 0;
		const source = new ReadableStream<Uint8Array>({
			cancel() {
				cancels++;
			},
		});
		const reason = new Error('already stopped');
		await expect(csv.parseStream(source, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
		expect(source.locked).toBe(false);
		expect(cancels).toBe(0);
		await source.cancel();
	});

	it('interrupts first-read discovery and retains delayed cancellation failure', async () => {
		const controller = new AbortController();
		let rejectCleanup!: (error: unknown) => void;
		let cleanup!: Promise<CleanupOutcome>;
		const source = new ReadableStream<Uint8Array>({
			cancel() {
				return new Promise<void>((_resolve, reject) => {
					rejectCleanup = reject;
				});
			},
		});
		const parsing = csv.parseStream(source, {
			signal: controller.signal,
			onCleanup: (value) => {
				cleanup = value;
			},
		});
		const reason = new Error('cancel discovery');
		controller.abort(reason);
		await expect(parsing).rejects.toBe(reason);
		expect(source.locked).toBe(false);
		const failure = new Error('late byte cleanup');
		rejectCleanup(failure);
		expect(await cleanup).toEqual({ status: 'failed', error: failure });
	});

	it('returns an explicit header without waiting for a live stream to fill the default prefix budget', async () => {
		const controller = new AbortController();
		const source = new ReadableStream<Uint8Array>({
			start(value) {
				value.enqueue(new TextEncoder().encode('A,B\n1,2\nx'));
			},
		});
		const timeout = setTimeout(() => controller.abort(new Error('Explicit discovery stalled.')), 1000);
		try {
			await using document = await csv.parseStream(source, {
				delimiter: ',',
				encoding: 'utf-8',
				headerRow: 1,
				signal: controller.signal,
			});
			expect(document.columns.map((column) => column.name)).toEqual(['A', 'B']);
		} finally {
			clearTimeout(timeout);
		}
		expect(source.locked).toBe(false);
	});

	it('shares row diagnostic rules between collecting and streaming consumers', async () => {
		const text = 'A,B\n=SUM(A1),2,extra\n';
		const complete = csv.parse(text, { headerRow: 1 });
		await using streamed = await csv.parseStream(new Blob([text]).stream(), { headerRow: 1 });
		expect(await Array.fromAsync(streamed.rows)).toEqual(complete.rows);
	});

	it('stops buffered discovery rows when the consumer aborts between records', async () => {
		const controller = new AbortController();
		const source = new Blob(['Name,Value\nfirst,1\nsecond,2\nthird,3\n']).stream();
		await using document = await csv.parseStream(source, { signal: controller.signal });
		const rows = document.rows[Symbol.asyncIterator]();
		expect((await rows.next()).value?.values).toEqual(['first', '1']);
		const reason = new Error('stop buffered rows');
		controller.abort(reason);
		await expect(rows.next()).rejects.toBe(reason);
		expect(source.locked).toBe(false);
	});
});
