import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readable } from '@okikio/streams';
import { jsonl, jsonlCompletion } from './mod.ts';
const options = {
	maximumBytes: 1024,
	maximumRecordBytes: 128,
	maximumItems: 10,
	projection: { maximumDepth: 8, maximumNodes: 100, maximumStringCodeUnits: 100 },
};
describe('native bounded JSONL response', () => {
	it('owns one native identity and reports consumed bytes separately from input cleanup', async () => {
		const source = readable([{ name: 'é' }, false, null]);
		const response = jsonl(source, options);
		const completion = jsonlCompletion(response);
		expect(jsonlCompletion(response)).toBe(completion);
		expect(response).toBeInstanceOf(Response);
		expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
		const text = await response.text();
		expect(text).toBe('{"name":"é"}\nfalse\nnull\n');
		const result = await completion;
		expect(result.outcome).toBe('completed');
		expect(result.bytes).toBe(new TextEncoder().encode(text).length);
		expect(await result.cleanup).toEqual({ status: 'completed' });
		expect(source.locked).toBe(false);
	});
	it('does not acquire or consume a HEAD or bodyless-status source', async () => {
		for (const policy of [{ method: 'HEAD' }, { status: 204 }, { status: 205 }, { status: 304 }]) {
			let pulls = 0;
			const source = new ReadableStream({
				pull() {
					pulls++;
				},
			}, { highWaterMark: 0 });
			const response = jsonl(source, { ...options, ...policy });
			expect(response.body).toBeNull();
			expect(source.locked).toBe(false);
			expect(pulls).toBe(0);
			expect((await jsonlCompletion(response)).outcome).toBe('completed');
		}
	});
	it('cancels before the first pull and retains a late cleanup failure without replacing the cancellation result', async () => {
		const gate = Promise.withResolvers<void>();
		const failure = new Error('cleanup');
		const reason = new Error('client stopped');
		const source = new ReadableStream({
			async cancel() {
				await gate.promise;
				throw failure;
			},
		});
		const response = jsonl(source, options);
		await response.body!.cancel(reason);
		const result = await jsonlCompletion(response);
		expect(result.outcome).toBe('cancelled');
		expect(result.reason).toBe(reason);
		expect(source.locked).toBe(false);
		gate.resolve();
		expect(await result.cleanup).toEqual({ status: 'failed', error: failure });
	});
	it('keeps serialization/limit defects on the native body and completion, refusing getters and cycles', async () => {
		let invoked = 0;
		const getter = {
			get value() {
				invoked++;
				return 1;
			},
		};
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		for (const value of [getter, cyclic, 'x'.repeat(200)]) {
			const response = jsonl(readable([value]), options);
			await expect(response.text()).rejects.toThrow();
			expect((await jsonlCompletion(response)).outcome).toBe('errored');
		}
		expect(invoked).toBe(0);
		const response = jsonl(readable([1, 2]), { ...options, maximumItems: 1 });
		await expect(response.text()).rejects.toThrow(RangeError);
		expect((await jsonlCompletion(response)).bytes).toBe(2);
	});
});
