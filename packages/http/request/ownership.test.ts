import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { SuppressedError } from '@okikio/dispose';
import * as request from './mod.ts';

describe('request-owned cleanup', () => {
	it('attempts every disposer in reverse order and retains multiple failures', async () => {
		const owner = {};
		const first = new Error('first');
		const last = new Error('last');
		const calls: string[] = [];
		await request.memoize(owner, 'a', () => ({
			[Symbol.dispose]() {
				calls.push('a');
				throw first;
			},
		}));
		await request.memoize(owner, 'b', () => ({
			[Symbol.asyncDispose]() {
				calls.push('b');
				return Promise.resolve();
			},
		}));
		await request.memoize(owner, 'c', () => ({
			[Symbol.dispose]() {
				calls.push('c');
				throw last;
			},
		}));
		const [result] = await Promise.allSettled([request.disposeMemo(owner)]);
		expect(calls).toEqual(['c', 'b', 'a']);
		if (result!.status !== 'rejected') throw new Error('Expected both cleanup errors.');
		expect(result.reason).toBeInstanceOf(SuppressedError);
		expect(result.reason.error).toBe(first);
		expect(result.reason.suppressed).toBe(last);
		await request.disposeMemo(owner);
		expect(calls).toEqual(['c', 'b', 'a']);
	});

	it('deduplicates resources after pending loaders resolve and survives rejected cache entries', async () => {
		const owner = {};
		let disposed = 0;
		const value = {
			[Symbol.dispose]() {
				disposed++;
			},
		};
		const first = request.memoize(owner, 'first', async () => value);
		const second = request.memoize(owner, 'second', async () => value);
		const error = new Error('loader rejected');
		const rejected = request.memoize(owner, 'rejected', () => {
			throw error;
		}, { cacheRejected: true });
		const loads = Promise.allSettled([first, second, rejected]);
		await expect(request.disposeMemo(owner)).rejects.toBe(error);
		await loads;
		expect(disposed).toBe(1);
	});
});

describe('shared request body ownership', () => {
	it('reads once and returns independent bytes to raw and JSON consumers', async () => {
		const value = new Request('https://service.invalid', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{"ok":true}',
		});
		const [raw, parsed] = await Promise.all([request.readBody(value), request.parseJson(value)]);
		raw.fill(0);
		expect(parsed).toEqual({ ok: true });
		expect(new TextDecoder().decode(await request.readBody(value))).toBe('{"ok":true}');
		expect(await request.bodyCleanup(value)).toEqual({ status: 'completed' });
		await expect(request.readBody(value, { maximumBodyBytes: 1 })).rejects.toBeInstanceOf(
			request.RequestTransportError,
		);
	});

	it('rejects overflow promptly without waiting for a caller-owned tee sibling', async () => {
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2]));
			},
		});
		const [left, right] = source.tee();
		const value = new Request(
			'https://service.invalid',
			{ method: 'POST', body: left, duplex: 'half' } as RequestInit & { duplex: 'half' },
		);
		await expect(request.readBody(value, { maximumBodyBytes: 1 })).rejects.toBeInstanceOf(
			request.RequestTransportError,
		);
		expect(value.body!.locked).toBe(false);
		let settled = false;
		void request.bodyCleanup(value).then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		await right.cancel();
		expect(await request.bodyCleanup(value)).toEqual({ status: 'cancelled' });
	});
});
