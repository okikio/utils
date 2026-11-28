/** Read one source snapshot for the npm artifact lifecycle. @module */
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { packages } from '../source.ts';
import { files } from './files.ts';

/** Source-owned npm metadata; the projection replaces only distribution-specific fields. */
export interface Manifest {
	/** Registry identity; native workspace selection may use this name, a path, or a glob. */
	name: string;
	/** Canonical release version used when replacing workspace dependency ranges in the stage. */
	version: string;
	/** Canonical source paths become conditional ESM and declaration targets in the npm stage. */
	exports: Record<string, string | Record<string, Record<string, string>>>;
	/** Runtime dependencies remain external to the emitted package. */
	dependencies?: Record<string, string>;
	/** Host-provided dependencies retain their published peer contract. */
	peerDependencies?: Record<string, string>;
	/** Source test aliases are removed; external runtime aliases remain in the staged manifest. */
	imports?: Record<string, unknown>;
	/** Explicit polyfill paths are projected to dist; an absent list becomes false. */
	sideEffects?: false | string[];
	/** npm metadata outside the projection-owned fields is copied without rewriting it. */
	[key: string]: unknown;
}

/** Inputs and output locations owned by one CLI invocation; modules do no work at import time. */
export type SourceType = {
	/** Absolute checkout root; relative manifest and fixture paths resolve here. */
	readonly root: string;
	/** Generated npm stages, archive receipts and command logs owned by this invocation. */
	readonly output: string;
	/** Native pnpm package identities keyed by their source directory below packages/. */
	readonly manifests: ReadonlyMap<string, Manifest>;
	/** Authored installed-consumer scenarios keyed by their emitted filename stem. */
	readonly scenarioSources: Readonly<Record<string, string>>;
};

/** Read public manifests through pnpm and discover explicitly marked installed-consumer scenarios. */
export async function get(root: string): Promise<SourceType> {
	const output = resolve(root, '.tmp/artifacts/npm');
	const manifests = new Map<string, Manifest>();
	for (const member of packages(root)) {
		const directory = member.directory.slice('packages/'.length);
		const manifest = JSON.parse(await readFile(resolve(member.path, 'package.json'), 'utf8')) as Manifest;
		manifests.set(directory, manifest);
	}
	/** Reuse canonical tests through public imports in emitted ESM; never substitute artifact-only oracles. */
	const scenarioSources: Record<string, string> = {};
	for (const directory of ['tests', 'packages']) {
		for await (const file of files(resolve(root, directory))) {
			if (!file.endsWith('.test.ts')) continue;
			if (!(await readFile(file, 'utf8')).includes('// @installed-consumer:')) continue;
			const source = relative(root, file).replaceAll('\\', '/');
			scenarioSources[source.replace(/[^a-z0-9]/giu, '-')] = source;
		}
	}
	return { root, output, manifests, scenarioSources };
}

/** Deno adapters remain JSR-only; generic protocols and Node, Bun and browser adapters ship on npm. */
export function excluded(name: string, key: string): boolean {
	return name === 'runtime' && (key === './deno' || key.startsWith('./deno/')) ||
		name === 'utils' && (key === './runtime/deno' || key.startsWith('./runtime/deno/'));
}
