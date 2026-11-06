/** A copied walkthrough must show the same complete modules that the native example checks run. */
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { expect } from '@std/expect';

describe('copyable MCP walkthrough', () => {
	it('keeps source-marked listings equal to their executable modules', async () => {
		const document = new URL('../../docs/server/11-mcp.md', import.meta.url);
		const markdown = await readFile(document, 'utf8');
		const listings = [...markdown.matchAll(/```ts source=([^\n]+)\n([\s\S]*?)\n```/gu)];
		expect(listings.length).toBe(2);
		for (const [, path, source] of listings) {
			expect(source!.trim()).toBe((await readFile(new URL(path!, document), 'utf8')).trim());
		}
	});
});
