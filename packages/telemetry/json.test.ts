import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { reporter } from './json.ts';
import { event } from './mod.ts';

describe('JSON telemetry', () => {
	it('redacts credential fields and application text without serializing the live error', async () => {
		const lines: string[] = [];
		const output = reporter({
			write: (line) => {
				lines.push(line);
			},
			redact: (text) => text.replaceAll('private', '[redacted]'),
		});
		await output.report(
			event({
				name: 'test',
				message: 'private\nline',
				fields: { apiKey: 'hidden', nested: { token: 'hidden', count: 2 } },
				error: new Error('private'),
			}),
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]!.split('\n')).toHaveLength(2);
		const value = JSON.parse(lines[0]!);
		expect(value.fields).toEqual({ apiKey: '[redacted]', nested: { token: '[redacted]', count: 2 } });
		expect(value.message).toBe('[redacted]\nline');
		expect(value.error).toBeUndefined();
		expect(lines[0]).not.toContain('private');
	});
	it('rejects an oversized record before writing', async () => {
		let writes = 0;
		await expect(
			reporter({
				write: () => {
					writes++;
				},
				maximumBytes: 1,
			}).report(event({ name: 'test' })),
		).rejects.toThrow(RangeError);
		expect(writes).toBe(0);
	});
});
