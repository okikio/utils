/** Independent fault controls for retained capability graphs and setup metadata. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { graphProblems } from '#tools/packages/bundles.ts';
import { packageProblems, taskProblems } from '#tools/packages/check.ts';
import { patch, project, sync } from '#tools/packages/exports.ts';
import { parse } from '@std/jsonc';
import { pathToFileURL } from 'node:url';

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
			origins: [...focused.origins, 'packages/worker/thread/mod.ts'],
			modules: [...focused.modules, 'packages/worker/thread/mod.ts'],
		};
		expect(graphProblems(focused, unrelated, bridge, owner).length).toBeGreaterThan(0);
		expect(graphProblems(focused, { origins: [], modules: [] }, bridge, owner).length).toBeGreaterThan(0);
		const dependency = {
			origins: [...focused.origins, 'packages/collection/record/mod.ts'],
			modules: [...focused.modules, 'packages/collection/record/mod.ts'],
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

	it('preserves nested manifest ownership and authored text, then converges after a write', async () => {
		await Deno.mkdir('.tmp/tests', { recursive: true });
		const directory = await Deno.makeTempDir({ dir: `${Deno.cwd()}/.tmp/tests`, prefix: 'utils-export-projection-' });
		// Lexical disposal runs on Deno too, where node:test per-test after hooks do not run.
		await using _cleanup = { [Symbol.asyncDispose]: () => Deno.remove(directory, { recursive: true }) };
		const root = new URL(`file://${directory}/`);
		await Deno.writeTextFile(new URL('pnpm-workspace.yaml', root), "packages:\n  - 'packages/**'\n");
		await Deno.writeTextFile(new URL('package.json', root), '{"private":true}\n');
		await Deno.mkdir(new URL('packages/group/source/', root), { recursive: true });
		await Deno.mkdir(new URL('packages/utils/', root));
		await Deno.writeTextFile(
			new URL('packages/group/source/package.json', root),
			JSON.stringify({
				name: '@okikio/example',
				exports: { '.': './mod.ts' },
				sideEffects: false,
				scripts: { check: 'deno check --frozen .' },
			}),
		);
		await Deno.writeTextFile(
			new URL('packages/group/source/deno.jsonc', root),
			'{"exports": {".": "./mod.ts"}, "tasks": {}}',
		);
		const manifest = '{\n\t// Preserve author intent.\n\t"exports": {},\n\t"sideEffects": false,\n\t"tasks": {}\n}\n';
		await Deno.writeTextFile(new URL('packages/utils/deno.jsonc', root), manifest);
		await Deno.writeTextFile(
			new URL('packages/utils/package.json', root),
			JSON.stringify({
				name: '@okikio/utils',
				exports: {},
				sideEffects: false,
				scripts: { check: 'deno check --frozen .' },
				note: 'authored',
			}),
		);
		const before = await Deno.readTextFile(new URL('packages/utils/package.json', root));
		expect(new Set(await sync(root))).toEqual(
			new Set(['../group/source/deno.jsonc', 'example.ts', 'package.json', 'deno.jsonc']),
		);
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

	it('rejects a missing required owner and an independently drifted task projection', () => {
		const scripts = {
			check: 'deno check .',
			test: 'deno test',
			'test:deno': 'deno test',
			'test:node': 'node --test',
			'test:bun': 'bun test',
			build: 'node build.ts',
			bench: 'deno run bench.ts',
			'bench:check': 'deno run bench.ts --check',
		};
		expect(taskProblems({ scripts }, { tasks: scripts })).toEqual([]);
		const { check: _check, ...missing } = scripts;
		expect(taskProblems({ scripts: missing }, { tasks: missing }))
			.toEqual(['The package must own a non-empty check script.']);
		expect(taskProblems({ scripts }, { tasks: { ...scripts, check: 'mise run check' } }))
			.toEqual(['Deno tasks must project the package-owned npm scripts.']);
	});

	for (const name of ['example', 'utils']) {
		it(`checks generated ${name} tasks in their owner and propagates a real compiler failure`, async () => {
			const owner = name === 'example' ? 'http' : 'utils';
			const actual = JSON.parse(await Deno.readTextFile(new URL(`../packages/${owner}/package.json`, import.meta.url)));
			await Deno.mkdir('.tmp/tests', { recursive: true });
			const directory = await Deno.makeTempDir({ dir: `${Deno.cwd()}/.tmp/tests`, prefix: 'utils-package-check-' });
			await using _cleanup = { [Symbol.asyncDispose]: () => Deno.remove(directory, { recursive: true }) };
			const root = pathToFileURL(`${directory}/`);
			await Deno.writeTextFile(new URL('pnpm-workspace.yaml', root), "packages:\n  - 'packages/*'\n");
			await Deno.writeTextFile(new URL('package.json', root), '{"private":true}\n');
			await Deno.writeTextFile(new URL('deno.json', root), '{"workspace":["packages/*"]}\n');
			for (const member of ['example', 'utils']) {
				await Deno.mkdir(new URL(`packages/${member}/`, root), { recursive: true });
				await Deno.writeTextFile(
					new URL(`packages/${member}/package.json`, root),
					JSON.stringify({
						name: `@okikio/${member}`,
						exports: { '.': './mod.ts' },
						sideEffects: false,
						scripts: { check: actual.scripts.check },
					}),
				);
				await Deno.writeTextFile(
					new URL(`packages/${member}/deno.jsonc`, root),
					JSON.stringify({
						name: `@okikio/${member}`,
						exports: {},
						tasks: {},
					}),
				);
				await Deno.writeTextFile(new URL(`packages/${member}/mod.ts`, root), 'export const value: number = 1;\n');
			}
			await Deno.writeTextFile(new URL('packages/utils/all.ts', root), 'export {};\n');
			await sync(root, 'write');
			// Add an unrelated broken owner after projection: a local check must not expand into the whole workspace.
			await Deno.mkdir(new URL('packages/unrelated/', root));
			await Deno.writeTextFile(new URL('packages/unrelated/deno.json', root), '{"name":"@okikio/unrelated"}\n');
			await Deno.writeTextFile(new URL('packages/unrelated/mod.ts', root), 'export const unrelated: string = 1;\n');
			const invoke = () =>
				new Deno.Command(Deno.execPath(), {
					args: ['task', '--cwd', `packages/${name}`, 'check'],
					cwd: directory,
				}).output();
			const initial = await invoke();
			expect(initial.code, new TextDecoder().decode(initial.stderr)).toBe(0);
			await Deno.writeTextFile(new URL(`packages/${name}/mod.ts`, root), 'export const value: string = 1;\n');
			const failed = await invoke();
			expect(failed.code).not.toBe(0);
			expect(new TextDecoder().decode(failed.stderr)).toContain('TS2322');
			await Deno.writeTextFile(new URL(`packages/${name}/mod.ts`, root), 'export const value: number = 1;\n');
			const restored = await invoke();
			expect(restored.code, new TextDecoder().decode(restored.stderr)).toBe(0);
		});
	}
});
