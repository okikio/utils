import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { audit } from './audit-duplicates.ts';

describe('duplicate audit', () => {
	it('reports structural duplicates and repeated helper names without reading test fixtures', async () => {
		const root = await Deno.makeTempDir({ prefix: 'okikio-audit-' });
		try {
			await Deno.writeTextFile(`${root}/first.ts`, 'function first(value: string) { return value.trim().toLowerCase().replaceAll("first", "other").slice(0, 80); }');
			await Deno.writeTextFile(`${root}/second.ts`, 'function second(input: string) { return input.trim().toLowerCase().replaceAll("alpha", "other").slice(0, 80); }');
			await Deno.writeTextFile(`${root}/ignored.test.ts`, 'function first(value: string) { return value.trim().toLowerCase().replaceAll("first", "other").slice(0, 80); }');
			const result = await audit(root);
			expect(result.files).toBe(2);
			expect(result.functions).toBe(2);
			expect(result.errors).toEqual([]);
			expect(result.shapes).toHaveLength(1);
			expect(result.shapes[0]?.functions.map((value) => value.name)).toEqual(['first', 'second']);
		} finally {
			await Deno.remove(root, { recursive: true });
		}
	});
});
