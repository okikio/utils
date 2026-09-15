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

	it('ranks private context timer bypasses above matching private lifecycle helpers', async () => {
		const root = await Deno.makeTempDir({ prefix: 'okikio-audit-' });
		try {
			await Deno.mkdir(`${root}/packages/context`, { recursive: true });
			await Deno.mkdir(`${root}/packages/queue`, { recursive: true });
			await Deno.mkdir(`${root}/packages/process`, { recursive: true });
			await Deno.mkdir(`${root}/packages/worker`, { recursive: true });
			await Deno.writeTextFile(
				`${root}/packages/context/mod.ts`,
				'export function wait() { return Promise.resolve(); }',
			);
			await Deno.writeTextFile(
				`${root}/packages/queue/mod.ts`,
				"import * as context from '@okikio/context'; function waitForChange(ctx: context.Context) { ctx.signal.addEventListener('abort', () => {}); return setTimeout(() => {}, 1); }",
			);
			const settle = [
				'async function settlesWithin(value: Promise<unknown>, milliseconds: number) {',
				'  return await Promise.race([value, new Promise((resolve) => setTimeout(resolve, milliseconds))]);',
				'}',
			].join('\n');
			await Deno.writeTextFile(`${root}/packages/process/mod.ts`, settle);
			await Deno.writeTextFile(`${root}/packages/worker/mod.ts`, settle);

			const result = await audit(root);
			const bypass = result.findings.find((value) => value.kind === 'owner-bypass');
			const queue = bypass?.functions[0];
			expect(queue).toMatchObject({ package: 'queue', exported: false, usesContext: true });
			expect(queue?.markers).toContain('timer');
			expect(bypass?.functions).toEqual([queue]);
			expect(result.findings.find((value) => value.kind === 'private-lifecycle')?.functions.map((value) => value.name)).toEqual([
				'settlesWithin',
				'settlesWithin',
			]);
		} finally {
			await Deno.remove(root, { recursive: true });
		}
	});
});
