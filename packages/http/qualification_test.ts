import { expect } from '@std/expect';
import fc from 'fast-check';
import { describe, it } from 'node:test';

import * as request from './request/mod.ts';

/** Build the canonical repeated-query record used as an independent oracle for URLSearchParams inputs. */
function expectedQuery(entries: readonly (readonly [string, string])[]): Readonly<Record<string, string | readonly string[]>> {
	const grouped = new Map<string, string[]>();
	for (const [key, value] of entries) {
		let values = grouped.get(key);
		if (!values) {
			values = [];
			grouped.set(key, values);
		}
		values.push(value);
	}
	return Object.fromEntries([...grouped].map(([key, values]) => [key, values.length === 1 ? values[0]! : values]));
}

describe('HTTP qualification', () => {
	it('preserves URLSearchParams values across generated repeated-query inputs', () => {
		fc.assert(fc.property(
			fc.array(fc.tuple(fc.string({ maxLength: 20 }), fc.string({ maxLength: 40 })), { maxLength: 30 }),
			(entries) => {
				const parameters = new URLSearchParams();
				for (const [key, value] of entries) parameters.append(key, value);
				expect(request.parseQuery(parameters, {
					maximumQueryParameters: 30,
					maximumParameterLength: 20,
					maximumQueryValueLength: 40,
				})).toEqual(expectedQuery(entries));
			},
		), { numRuns: 500 });
	});

	it('accepts the exact body limit and rejects one byte beyond it', async () => {
		const exact = new Request('https://service.invalid/body', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '1234',
		});
		expect(await request.readBody(exact, { maximumBodyBytes: 4 })).toEqual(new TextEncoder().encode('1234'));

		const tooLarge = new Request('https://service.invalid/body', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '12345',
		});
		await expect(request.readBody(tooLarge, { maximumBodyBytes: 4 })).rejects.toThrow(request.RequestTransportError);
	});

	it('distinguishes malformed Content-Length from an oversized body', async () => {
		const malformed = new Request('https://service.invalid/body', {
			method: 'POST',
			headers: { 'content-length': '4.5' },
			body: '1234',
		});
		try {
			await request.readBody(malformed, { maximumBodyBytes: 4 });
			throw new Error('Expected malformed Content-Length to fail.');
		} catch (error) {
			expect(error).toBeInstanceOf(request.RequestTransportError);
			expect((error as request.RequestTransportError).issues[0]?.code).toBe('invalid-content-length');
		}
	});

	it('does not return a partial body after request cancellation', async () => {
		const controller = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('partial'));
			},
		});
		const input: RequestInit & { duplex: 'half' } = {
			method: 'POST',
			body,
			duplex: 'half',
			signal: controller.signal,
		};
		const reading = request.readBody(new Request('https://service.invalid/body', input));
		await Promise.resolve();
		controller.abort(new Error('caller cancelled'));
		await expect(reading).rejects.toThrow('caller cancelled');
	});
});
