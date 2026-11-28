/** Emit each npm member in its own process and replace only its generated stage. @module */
import { cp, mkdir, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { build } from 'tsdown';
import { projection } from '../../../tsdown.config.ts';
import { npmRegistry } from '../../releases/candidates.ts';
import { command } from './command.ts';
import { files } from './files.ts';
import { excluded } from './source.ts';
import type { Manifest, SourceType } from './source.ts';

/** Preserve prior output and build each member serially so declaration graphs have separate lifetimes. */
export async function all(workspace: SourceType, entry: string): Promise<void> {
	const { root, output, manifests } = workspace;
	const portable = [...manifests];

	try {
		await rename(output, `${output}-before-${Date.now()}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	await mkdir(output, { recursive: true });
	// A fresh member process owns each declaration graph and releases it before the next package starts.
	for (const [name] of portable) command(workspace, 'node', [entry, 'member', name], root);
}

/** Build exactly one native-selected owner; retry removes only that owner's incomplete generated stage. */
export async function member(workspace: SourceType, memberName: string | undefined): Promise<void> {
	const { root, output, manifests } = workspace;
	const portable = [...manifests];

	const selected = portable.filter(([name]) => name === memberName);
	if (selected.length !== 1) throw new Error('Select one supported npm member for isolated emission.');
	for (const [name, source] of selected) {
		const stage = resolve(output, name);
		// A failed build can leave its source copy and dependency link. Retry replaces only this owner's generated stage.
		await rm(stage, { recursive: true, force: true });
		const documents = (await readdir(resolve(root, 'packages', name))).filter((file) =>
			['diagram.png', 'diagram.mmd'].includes(file)
		);
		await mkdir(resolve(stage, 'src'), { recursive: true });
		await symlink(resolve(root, 'packages', name, 'node_modules'), resolve(stage, 'node_modules'), 'dir');
		await cp(resolve(root, 'packages', name), resolve(stage, 'src'), {
			recursive: true,
			filter: (path) =>
				!/(?:\.test\.ts|\.bench\.ts|\/\.example-[^/]+(?:\/|$)|\/fixtures(?:\/|$)|\/dist(?:\/|$)|\/node_modules(?:\/|$))/
					.test(path),
		});
		// Package-local guides must accompany root README links, including focused pages such as record/json.md.
		for await (const file of files(resolve(stage, 'src'))) {
			const document = relative(resolve(stage, 'src'), file).replaceAll('\\', '/');
			if (document.endsWith('.md') && document !== 'README.md') documents.push(document);
		}
		const exports: Record<string, unknown> = {};
		const entries: Record<string, string> = {};
		for (const [key, target] of Object.entries(source.exports)) {
			if (excluded(name, key)) continue;
			if (typeof target !== 'string') throw new Error(`Canonical source export ${name}${key} must be a path.`);
			// A raw WebAssembly file is copied into dist below, at the same relative path, and exported as itself.
			if (target.endsWith('.wasm')) {
				exports[key] = `./dist/${target.replace(/^\.\//, '')}`;
				continue;
			}
			const stem = target.replace(/^\.\//, '').replace(/\.ts$/, '');
			entries[stem] = resolve(stage, 'src', target);
			exports[key] = {
				import: { types: `./dist/${stem}.d.mts`, default: `./dist/${stem}.mjs` },
			};
		}
		const manifest: Manifest = {
			...source,
			exports: exports as Manifest['exports'],
			files: ['dist', 'README.md', 'LICENSE', ...documents],
			engines: { node: '>=26.10.0' },
		};
		delete manifest.devDependencies;
		// The staged package is the publication root, not another redirect to source staging.
		manifest.publishConfig = { access: 'public', registry: npmRegistry };
		// Trusted publishing binds the package to the repository that owns this workflow.
		manifest.repository = {
			type: 'git',
			url: 'git+https://github.com/okikio/utils.git',
			directory: `packages/${name}`,
		};
		delete manifest.scripts;
		// Source-local test aliases do not address any emitted artifact; external runtime aliases remain explicit.
		if (manifest.imports) {
			manifest.imports = Object.fromEntries(
				Object.entries(manifest.imports as Record<string, unknown>).filter(([, target]) =>
					target !== './' && target !== './*'
				),
			);
			if (Object.keys(manifest.imports).length === 0) delete manifest.imports;
		}
		for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
			if (!manifest[field]) continue;
			manifest[field] = Object.fromEntries(
				Object.entries(manifest[field] as Record<string, string>).map(
					([dependency, version]) => {
						const member = [...manifests.values()].find((value) => value.name === dependency);
						if (version.startsWith('workspace:') && member === undefined) {
							throw new Error(`Unknown workspace dependency ${dependency} in ${name}.`);
						}
						return [dependency, version.startsWith('workspace:') ? member!.version : version];
					},
				),
			);
		}
		manifest.sideEffects = Array.isArray(source.sideEffects)
			? source.sideEffects.flatMap((
				path,
			) => [
				path.replace(/\.ts$/, '.mjs').replace(/^\.\//, './dist/'),
			])
			: false;
		await writeFile(resolve(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
		await cp(resolve(root, 'LICENSE'), resolve(stage, 'LICENSE'));
		await cp(resolve(root, 'packages', name, 'README.md'), resolve(stage, 'README.md'));
		for (const document of documents) {
			await mkdir(dirname(resolve(stage, document)), { recursive: true });
			await cp(resolve(root, 'packages', name, document), resolve(stage, document));
		}
		await writeFile(
			resolve(stage, 'tsconfig.json'),
			JSON.stringify({
				extends: resolve(root, 'tsconfig.json'),
				include: ['src/**/*.ts'],
				compilerOptions: { rootDir: 'src' },
			}),
		);
		const bundles = (await build(projection(stage, entries, root))).bundles;
		for (const bundle of bundles) await bundle[Symbol.asyncDispose]();
		// WebAssembly modules are loaded with `new URL('./x.wasm', import.meta.url)`. Emitted modules keep the
		// source layout, so each module is copied to the same relative path under dist.
		for await (const file of files(resolve(stage, 'src'))) {
			if (!file.endsWith('.wasm')) continue;
			const target = resolve(stage, 'dist', relative(resolve(stage, 'src'), file));
			await mkdir(dirname(target), { recursive: true });
			await cp(file, target);
		}
		// Source copies exist only for the build. Published contents come from files plus actual pack inspection.
		await rm(resolve(stage, 'src'), { recursive: true });
		await rm(resolve(stage, 'node_modules'));
	}
}
