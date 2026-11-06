import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as json from './json.ts';

const body = (text: string) => new Response(text).body!;
const budgets = { maximumBytes: 100, maximumLineBytes: 20, maximumItems: 2 };

describe('bounded JSON streams', () => {
	it('reads strict UTF-8, rejects overrun and releases stalled reads on abort', async () => {
		expect(await json.read(body('{"ok":true}'), 11)).toEqual({ ok: true });
		await expect(json.read(body('null '), 4)).rejects.toThrow(RangeError);
		await expect(json.read(new Response(new Uint8Array([34, 255, 34])).body!, 3)).rejects.toThrow(TypeError);
		const controller = new AbortController();
		const source = new ReadableStream<Uint8Array>({
			cancel() {
				return new Promise<void>(() => {});
			},
		});
		const pending = json.read(source, 100, controller.signal);
		controller.abort('stop');
		await expect(pending).rejects.toBe('stop');
		expect(source.locked).toBe(false);
	});
	it('bounds complete input, each line and record count independently', async () => {
		expect(await Array.fromAsync(json.lines(body('null\r\nfalse\n'), budgets))).toEqual([null, false]);
		for (
			const [text, options] of [
				['null\nfalse\n0', budgets],
				['"12345"', { ...budgets, maximumLineBytes: 4 }],
				['null\n', { ...budgets, maximumBytes: 4 }],
			] as const
		) await expect(Array.fromAsync(json.lines(body(text), options))).rejects.toThrow();
		await expect(Array.fromAsync(json.lines(new Response(new Uint8Array([34, 255, 34, 10])).body!, budgets))).rejects
			.toThrow(TypeError);
	});
	it('settles line cancellation even when source cleanup stalls', async () => {
		const controller = new AbortController();
		const source = new ReadableStream<Uint8Array>({
			cancel() {
				return new Promise<void>(() => {});
			},
		});
		const pending = Array.fromAsync(json.lines(source, { ...budgets, signal: controller.signal }));
		controller.abort('stop');
		await expect(pending).rejects.toBe('stop');
		expect(source.locked).toBe(false);
	});
	it('keeps JSONL output on one physical line and borrows writer ownership', async () => {
		const chunks: Uint8Array[] = [];
		await json.write({
			write: (chunk) => {
				chunks.push(chunk!);
				return Promise.resolve();
			},
		}, { message: 'first\nsecond' });
		expect(new TextDecoder().decode(chunks[0])).toBe('{"message":"first\\nsecond"}\n');
		expect(() => json.encode(undefined)).toThrow(TypeError);
		expect(() => json.encode('wide', 2)).toThrow(RangeError);
	});
});
