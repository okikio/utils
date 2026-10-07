/** Independent fault controls for retained capability graphs and setup metadata. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { graphProblems } from './check-treeshake.ts';
import { packageProblems } from './check-packaging.ts';
import { patch, project, sync } from './sync-utils-exports.ts';
import { parse } from '@std/jsonc';

const bridge = 'packages/utils/result.ts';
const owner = 'packages/result/';
const focused = { origins: ['packages/result/mod.ts'], modules: ['packages/result/mod.ts'] };

describe('selective package contracts', () => {
	it('accepts the selected bridge and valid constant folding without fixing byte contributions', () => {
		expect(
			graphProblems(
				focused,
				{ origins: [...focused.origins, bridge], modules: [...focused.modules, bridge] },
				bridge,
				owner,
			),
		).toEqual([]);
		expect(graphProblems({ ...focused, modules: [] }, focused, bridge, owner)).toEqual([]);
		expect(graphProblems(focused, { ...focused, modules: [] }, bridge, owner)).toEqual([]);
	});

	it('rejects separately isolated unrelated capability, missing provenance, and omitted dependency graphs', () => {
		const unrelated = {
			origins: [...focused.origins, 'packages/worker/mod.ts'],
			modules: [...focused.modules, 'packages/worker/mod.ts'],
		};
		expect(graphProblems(focused, unrelated, bridge, owner).length).toBeGreaterThan(0);
		expect(graphProblems(focused, { origins: [], modules: [] }, bridge, owner).length).toBeGreaterThan(0);
		const dependency = {
			origins: [...focused.origins, 'packages/record/mod.ts'],
			modules: [...focused.modules, 'packages/record/mod.ts'],
		};
		expect(graphProblems(dependency, dependency, bridge, owner)).toEqual([]);
		expect(graphProblems(dependency, focused, bridge, owner).length).toBeGreaterThan(0);
	});

	it('accepts order-independent source exports and physically present explicit setup metadata', () => {
		const files = new Set(['./mod.ts', './polyfill.ts']);
		const npm = { exports: { '.': './mod.ts', './polyfill': './polyfill.ts' }, sideEffects: ['./polyfill.ts'] };
		const deno = { exports: { './polyfill': './polyfill.ts', '.': './mod.ts' } };
		expect(packageProblems(npm, deno, files)).toEqual([]);
		expect(
			packageProblems({ exports: { '.': './mod.ts' }, sideEffects: false }, { exports: { '.': './mod.ts' } }, files),
		).toEqual([]);
	});

	it('rejects stripped setup metadata while every export target still exists', () => {
		const deno = { exports: { '.': './mod.ts', './polyfill': './polyfill.ts' } };
		const files = new Set(['./mod.ts', './polyfill.ts']);
		expect(packageProblems({ ...deno, sideEffects: ['./polyfill.ts'] }, deno, files)).toEqual([]);
		expect(packageProblems({ ...deno, sideEffects: false }, deno, files).length).toBeGreaterThan(0);
	});

	it('rejects escaped local targets even when export maps match and the declared file is reported present', () => {
		const deno = { exports: { '.': './%2e%2e/outside.ts' } };
		const files = new Set(['./%2e%2e/outside.ts']);
		expect(packageProblems({ ...deno, sideEffects: false }, deno, files).length).toBeGreaterThan(0);
	});

	it('rejects unsupported blanket effects without a missing target or export mismatch', () => {
		const deno = { exports: { '.': './mod.ts' } };
		const files = new Set(['./mod.ts']);
		expect(packageProblems({ ...deno, sideEffects: false }, deno, files)).toEqual([]);
		expect(packageProblems({ ...deno, sideEffects: true }, deno, files).length).toBeGreaterThan(0);
	});

	it('rejects missing export files and missing effect files as independent failures', () => {
		const deno = { exports: { '.': './mod.ts' } };
		expect(packageProblems({ ...deno, sideEffects: false }, deno, new Set()).length).toBeGreaterThan(0);
		expect(packageProblems({ ...deno, sideEffects: ['./setup.ts'] }, deno, new Set(['./mod.ts', './setup.ts'])))
			.toEqual([]);
		expect(packageProblems({ ...deno, sideEffects: ['./setup.ts'] }, deno, new Set(['./mod.ts'])).length)
			.toBeGreaterThan(0);
	});

	it('rejects duplicate effect declarations with otherwise valid files and exports', () => {
		const deno = { exports: { '.': './mod.ts' } };
		const files = new Set(['./mod.ts', './setup.ts']);
		expect(packageProblems({ ...deno, sideEffects: ['./setup.ts'] }, deno, files)).toEqual([]);
		expect(packageProblems({ ...deno, sideEffects: ['./setup.ts', './setup.ts'] }, deno, files).length).toBeGreaterThan(
			0,
		);
	});
});

describe('umbrella export projection', () => {
	it('changes owned values while preserving Unicode comments, unknown fields and JSONC layout', () => {
		const source = '{\r\n\t// Authored 雪: "exports": {}\r\n\t"name": "@okikio/utils",\r\n' +
			'\t"note": "exports and sideEffects are words",\r\n\t"exports": /* Keep this comment. */ {},\r\n' +
			'\t"sideEffects": false,\r\n\t"private": false,\r\n}\r\n';
		const fields = { exports: { '.': './mod.ts', './result': './result.ts' }, sideEffects: ['./setup.ts'] };
		const result = patch(source, fields);
		expect(parse(result)).toEqual({
			name: '@okikio/utils',
			note: 'exports and sideEffects are words',
			...fields,
			private: false,
		});
		for (const authored of ['// Authored 雪: "exports": {}', '/* Keep this comment. */', '\t"private": false,\r\n']) {
			expect(result.includes(authored)).toBe(true);
		}
		expect(result.replaceAll('\r\n', '').includes('\n')).toBe(false);
		expect(patch(result, fields)).toBe(result);
	});

	it('rejects ambiguous or malformed owned fields without selecting documentary strings', () => {
		expect(() => patch('{"exports":{},"exports":{}}', { exports: {} })).toThrow(TypeError);
		expect(() => patch('{"note":"exports"}', { exports: {} })).toThrow(TypeError);
		expect(() => patch('{"exports":', { exports: {} })).toThrow();
		expect(() => project([{ name: '@okikio/example', exports: { './../escape': './mod.ts' }, sideEffects: false }]))
			.toThrow(TypeError);
	});

	it('derives deterministic bridges and explicit setup from focused module metadata', () => {
		const value = { name: '@okikio/value', exports: { '.': './mod.ts' }, sideEffects: false as const };
		const setup = {
			name: '@okikio/setup',
			exports: { './polyfill': './polyfill.ts', '.': './mod.ts' },
			sideEffects: ['./polyfill.ts'],
		};
		const result = project([value, setup]);
		expect(result).toEqual(project([setup, value]));
		expect(result.exports).toEqual({
			'.': './mod.ts',
			'./all': './all.ts',
			'./setup': './setup.ts',
			'./setup/polyfill': './setup/polyfill.ts',
			'./value': './value.ts',
		});
		expect(result.sideEffects).toEqual(['./setup/polyfill.ts']);
		expect(result.bridges['setup/polyfill.ts']?.includes("import '@okikio/setup/polyfill';")).toBe(true);
		expect(result.bridges['value.ts']?.includes("export * from '@okikio/value';")).toBe(true);
		expect(() => project([value, value])).toThrow(TypeError);
	});

	it('checks without writes, publishes only validated output, then converges after a write', async (t) => {
		const directory = await Deno.makeTempDir({ prefix: 'utils-export-projection-' });
		t.after(() => Deno.remove(directory, { recursive: true }));
		const root = new URL(`file://${directory}/`);
		await Deno.mkdir(new URL('packages/example/', root), { recursive: true });
		await Deno.mkdir(new URL('packages/utils/', root));
		await Deno.writeTextFile(
			new URL('packages/example/package.json', root),
			JSON.stringify({
				name: '@okikio/example',
				exports: { '.': './mod.ts' },
				sideEffects: false,
			}),
		);
		const manifest = '{\n\t// Preserve author intent.\n\t"exports": {},\n\t"sideEffects": false\n}\n';
		await Deno.writeTextFile(new URL('packages/utils/deno.jsonc', root), manifest);
		await Deno.writeTextFile(
			new URL('packages/utils/package.json', root),
			JSON.stringify({ exports: {}, sideEffects: false, note: 'authored' }),
		);
		const before = await Deno.readTextFile(new URL('packages/utils/package.json', root));
		expect(new Set(await sync(root))).toEqual(new Set(['example.ts', 'package.json', 'deno.jsonc']));
		expect(await Deno.readTextFile(new URL('packages/utils/package.json', root))).toBe(before);
		await expect(Deno.stat(new URL('packages/utils/example.ts', root))).rejects.toBeInstanceOf(Deno.errors.NotFound);
		// Validate the second manifest before any bridge or first manifest write.
		await Deno.writeTextFile(new URL('packages/utils/deno.jsonc', root), '{"exports":');
		await expect(sync(root, 'write')).rejects.toBeInstanceOf(Error);
		expect(await Deno.readTextFile(new URL('packages/utils/package.json', root))).toBe(before);
		await expect(Deno.stat(new URL('packages/utils/example.ts', root))).rejects.toBeInstanceOf(Deno.errors.NotFound);
		await Deno.writeTextFile(new URL('packages/utils/deno.jsonc', root), manifest);
		expect((await sync(root, 'write')).length).toBeGreaterThan(0);
		expect(await sync(root)).toEqual([]);
		const written = await Deno.readTextFile(new URL('packages/utils/package.json', root));
		expect((JSON.parse(written) as { note: string }).note).toBe('authored');
		expect((await Deno.readTextFile(new URL('packages/utils/deno.jsonc', root))).includes('// Preserve author intent.'))
			.toBe(true);
		expect(await sync(root, 'write')).toEqual([]);
		expect(await Deno.readTextFile(new URL('packages/utils/package.json', root))).toBe(written);
	});
});
