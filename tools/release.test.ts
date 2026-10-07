/** Protect registry name/version agreement and JSONC preservation in the real release command. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { parse } from '@std/jsonc';

/** Copy the release command into an owned fixture repository so source manifests cannot be changed. */
async function fixture(ctx: import('node:test').TestContext): Promise<string> {
	const root = await Deno.makeTempDir({ prefix: 'okikio-release-' });
	ctx.after(() => Deno.remove(root, { recursive: true }));
	await Deno.mkdir(`${root}/.bumpy`);
	await Deno.mkdir(`${root}/packages/example`, { recursive: true });
	await Deno.copyFile(new URL('../.bumpy/release.ts', import.meta.url), `${root}/.bumpy/release.ts`);
	await Deno.writeTextFile(
		`${root}/packages/example/package.json`,
		JSON.stringify({ name: '@example/owned', version: '1.2.3' }),
	);
	await Deno.writeTextFile(
		`${root}/packages/example/deno.jsonc`,
		'{\n\t// Keep the source publication intent.\n\t"name": "@example/owned",\n\t"version": "1.1.0",\n}\n',
	);
	return root;
}

/** Invoke the actual command with only fixture read/write authority and capture terminal status. */
async function command(root: string, mode: 'check' | 'sync'): Promise<Deno.CommandOutput> {
	return await new Deno.Command(Deno.execPath(), {
		args: ['run', '--no-check', `--allow-read=${root}`, `--allow-write=${root}`, `${root}/.bumpy/release.ts`, mode],
		cwd: root,
		stdout: 'piped',
		stderr: 'piped',
	}).output();
}

describe('JSR release versions', () => {
	it('rejects drift, preserves JSONC when synchronizing, and is idempotent', async (ctx) => {
		const root = await fixture(ctx);
		expect((await command(root, 'check')).success).toBe(false);
		expect((await command(root, 'sync')).success).toBe(true);
		const synchronized = await Deno.readTextFile(`${root}/packages/example/deno.jsonc`);
		expect((parse(synchronized) as { version: string }).version).toBe('1.2.3');
		expect(synchronized).toContain('// Keep the source publication intent.');
		expect((await command(root, 'check')).success).toBe(true);
		expect((await command(root, 'sync')).success).toBe(true);
		expect(await Deno.readTextFile(`${root}/packages/example/deno.jsonc`)).toBe(synchronized);
	});

	it('rejects a mismatched registry name without overwriting the JSR manifest', async (ctx) => {
		const root = await fixture(ctx);
		const path = `${root}/packages/example/deno.jsonc`;
		const before = (await Deno.readTextFile(path)).replace('@example/owned', '@example/other');
		await Deno.writeTextFile(path, before);
		expect((await command(root, 'sync')).success).toBe(false);
		expect(await Deno.readTextFile(path)).toBe(before);
	});
});
