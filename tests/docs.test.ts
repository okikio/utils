import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { packages as umbrellaPackages } from '../packages/utils/mod.ts';

interface PackageManifest {
	readonly name: string;
	readonly exports?: Readonly<Record<string, string>>;
}

const packageRoot = new URL('../packages/', import.meta.url);
const repositoryRoot = new URL('../', import.meta.url);

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
	return JSON.parse(await Deno.readTextFile(new URL(`./${directory}/deno.jsonc`, packageRoot))) as PackageManifest;
}

/** Read one package README through the same repository-relative path consumers see. */
async function readme(directory: string): Promise<string> {
	return await Deno.readTextFile(new URL(`./${directory}/README.md`, packageRoot));
}

/** Detect a TypeScript example without requiring one Markdown fence style. */
function typescriptExample(markdown: string): boolean {
	return /^(?:```|~~~~)\s*(?:ts|typescript)\s*$/mu.test(markdown);
}

/** Map a focused package name to its matching umbrella subpath. */
function focusedSubpath(packageName: string): string {
	return packageName.replace('@okikio/', './');
}

/** Collect Markdown recursively while preserving repository-relative paths for diagnostics. */
async function collectMarkdown(
	directory: URL,
	prefix: string,
	files: Array<Readonly<{ path: string; markdown: string }>>,
): Promise<void> {
	for await (const entry of Deno.readDir(directory)) {
		const path = `${prefix}/${entry.name}`;
		const url = new URL(`./${entry.name}${entry.isDirectory ? '/' : ''}`, directory);
		if (entry.isDirectory) {
			await collectMarkdown(url, path, files);
			continue;
		}
		if (entry.isFile && entry.name.endsWith('.md')) {
			files.push({ path, markdown: await Deno.readTextFile(url) });
		}
	}
}

/**
 * Read authored Markdown that participates in the repository documentation.
 *
 * Generated artifacts and dependency documentation are intentionally excluded.
 * These files use the Okikio prose rules and can therefore share terminology
 * checks without imposing those rules on third-party text.
 */
async function documentationFiles(): Promise<readonly Readonly<{ path: string; markdown: string }>[]> {
	const files: Array<Readonly<{ path: string; markdown: string }>> = [];
	files.push({ path: 'README.md', markdown: await Deno.readTextFile(new URL('./README.md', repositoryRoot)) });

	await collectMarkdown(new URL('./docs/', repositoryRoot), 'docs', files);
	for (const directory of await packageDirectories()) {
		await collectMarkdown(new URL(`./packages/${directory}/`, repositoryRoot), `packages/${directory}`, files);
	}

	return files;
}

describe('package documentation', () => {
	it('gives every package consumer a real package description and TypeScript example', async () => {
		for (const directory of await packageDirectories()) {
			const definition = await manifest(directory);
			const markdown = await readme(directory);

			expect(markdown).toContain(definition.name);
			expect(markdown.split('\n').length).toBeGreaterThan(40);
			expect(typescriptExample(markdown)).toBe(true);
		}
	});

	it('does not send readers back to removed test layouts or APIs', async () => {
		const stale = [
			/\bqualification(?:\.test\.ts|\/)/u,
			/_test\.ts\b/u,
			/_bench\.ts\b/u,
			/@okikio\/hash\b/u,
			/\btry_\s*\(/u,
		];

		for (const directory of await packageDirectories()) {
			const markdown = await readme(directory);
			for (const pattern of stale) expect(markdown.match(pattern)).toBeNull();
		}
	});

	it('keeps project prose free of the generic architecture term prohibited by the writing guide', async () => {
		for (const file of await documentationFiles()) {
			if (/\bboundar(?:y|ies)\b/iu.test(file.markdown)) {
				throw new Error(`${file.path} uses the generic architecture term prohibited by the writing guide.`);
			}
			if (file.markdown.includes('—')) {
				throw new Error(`${file.path} uses an em dash, which the project prose guide excludes.`);
			}
		}
	});

	it('keeps newly authored long-form guides in the project Markdown form', async () => {
		const paths = [
			'docs/packaging.md',
			'docs/server.md',
			'packages/http/webhook/README.md',
			'packages/server/http/README.md',
		] as const;

		for (const path of paths) {
			const markdown = await Deno.readTextFile(new URL(`./${path}`, repositoryRoot));
			if (!/^[^\n]+\n=+$/mu.test(markdown)) throw new Error(`${path} must use a Setext document title.`);
			if (/^##\s/mu.test(markdown)) throw new Error(`${path} must use Setext major sections.`);
			if (markdown.includes('```')) throw new Error(`${path} must use four-tilde fences for multi-line examples.`);
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
	});
});
