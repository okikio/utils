import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parse } from '@std/jsonc';

import { checkExamples } from '#tools/testing/examples.ts';

import { packages as umbrellaPackages } from '@okikio/utils';

interface PackageManifest {
	readonly name: string;
	readonly exports?: Readonly<Record<string, string>>;
}

const packageRoot = new URL('../packages/', import.meta.url);

/** Return package directories that publish a Deno package manifest. */
async function packageDirectories(): Promise<readonly string[]> {
	const names: string[] = [];
	for await (const entry of Deno.readDir(packageRoot)) {
		if (!entry.isDirectory) continue;
		const manifest = new URL(`./${entry.name}/deno.jsonc`, packageRoot);
		try {
			await Deno.stat(manifest);
			names.push(entry.name);
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) throw error;
		}
	}
	return names.toSorted();
}

/** Read the package manifest used by the documentation checks. */
async function manifest(directory: string): Promise<PackageManifest> {
	const value = parse(await Deno.readTextFile(new URL(`./${directory}/deno.jsonc`, packageRoot)));
	if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value.name !== 'string') {
		throw new TypeError(`Package ${directory} must declare a string name.`);
	}
	if (value.exports === undefined) return { name: value.name };
	if (value.exports === null || typeof value.exports !== 'object' || Array.isArray(value.exports)) {
		throw new TypeError(`Package ${directory} must declare an export record.`);
	}
	const exports: Record<string, string> = {};
	for (const [name, target] of Object.entries(value.exports)) {
		if (typeof target !== 'string') throw new TypeError(`Package ${directory} export ${name} must name a source file.`);
		exports[name] = target;
	}
	return { name: value.name, exports };
}

/** Map a focused package name to its matching umbrella subpath. */
function focusedSubpath(packageName: string): string {
	return packageName.replace('@okikio/', './');
}

describe('package documentation', () => {
	it('compares example values independently of terminal colors and still rejects a changed value', async () => {
		const temporary = new URL('../.tmp/', import.meta.url);
		await Deno.mkdir(temporary, { recursive: true });
		const directory = await Deno.makeTempDir({ dir: temporary.pathname, prefix: 'example-color-' });
		const path = pathToFileURL(`${directory}/README.md`);
		const source =
			'```ts runnable\nconsole.log("\\u001b[33m42\\u001b[39m completed");\n```\n\n```text output\n42 completed\n```\n';
		try {
			await Deno.writeTextFile(path, source);
			expect(await checkExamples([path])).toBe(1);
			await Deno.writeTextFile(path, source.replace('42 completed\n```', '43 completed\n```'));
			await expect(checkExamples([path])).rejects.toBeInstanceOf(AggregateError);
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});

	it('compiles and runs complete README examples through public exports', async () => {
		await checkExamples();
	});

	it('documents every focused public entry so submodules remain discoverable', async () => {
		for (const directory of await packageDirectories()) {
			const definition = await manifest(directory);
			// The umbrella forwards these same entries; its README explains that mapping once.
			if (definition.name === '@okikio/utils') continue;
			const readme = await Deno.readTextFile(new URL(`${directory}/README.md`, packageRoot));
			for (const subpath of Object.keys(definition.exports ?? {})) {
				const specifier = definition.name + (subpath === '.' ? '' : subpath.slice(1));
				expect(readme, `${specifier} needs a discoverable README entry`).toContain(`\`${specifier}\``);
			}
		}
	});

	it('keeps umbrella inventory and focused re-export subpaths aligned with package manifests', async () => {
		const directories = await packageDirectories();
		const manifests = await Promise.all(directories.map(manifest));
		const focused = manifests
			.map((definition) => definition.name)
			.filter((name) => name !== '@okikio/utils')
			.toSorted();

		expect([...umbrellaPackages].toSorted()).toEqual(focused);

		const umbrella = manifests.find((definition) => definition.name === '@okikio/utils');
		expect(umbrella).toBeDefined();
		if (!umbrella) return;

		for (const packageName of focused) {
			expect(umbrella.exports?.[focusedSubpath(packageName)]).toBe(`./${packageName.slice('@okikio/'.length)}.ts`);
		}

		// A removed package must disappear from deep exports as well as the inventory.
		const subpaths = new Set(['.', './all']);
		for (const definition of manifests.filter((value) => value.name !== '@okikio/utils')) {
			for (const key of Object.keys(definition.exports ?? {})) {
				if (key === './package.json') continue;
				subpaths.add(focusedSubpath(definition.name) + (key === '.' ? '' : key.slice(1)));
			}
		}
		expect(Object.keys(umbrella.exports ?? {}).toSorted()).toEqual([...subpaths].toSorted());
	});

	it('resolves every local workspace dependency to a package that still exists', async () => {
		const directories = await packageDirectories();
		const definitions = await Promise.all(directories.map(manifest));
		const names = new Set(definitions.map((value) => value.name));
		const paths = [
			new URL('../package.json', import.meta.url),
			...directories.map((name) => new URL(`${name}/package.json`, packageRoot)),
		];
		for (const path of paths) {
			const source = JSON.parse(await Deno.readTextFile(path)) as {
				readonly dependencies?: Readonly<Record<string, string>>;
				readonly devDependencies?: Readonly<Record<string, string>>;
				readonly optionalDependencies?: Readonly<Record<string, string>>;
				readonly peerDependencies?: Readonly<Record<string, string>>;
			};
			for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
				for (const [name, range] of Object.entries(source[field] ?? {})) {
					if (range.startsWith('workspace:')) {
						expect(names.has(name), `${path.pathname} ${field}: ${name}`).toBe(true);
					}
				}
			}
		}
	});
});
