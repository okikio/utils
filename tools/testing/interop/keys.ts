/**
 * A content key for every cell of the interoperability suite: one target and one client.
 *
 * A cell's key changes only when something that cell runs changes: a file its imports reach, an npm package in the
 * dependency closure of an import, the pinned runtime that runs it, a digest of an image it starts, or a known limit
 * that applies to it. Two registries and two data files are left out of the walk on purpose, and the key holds what
 * they mean for the cell instead:
 *
 * - `clients/mod.ts` and `targets/mod.ts` only list every module, so following them would tie every cell to every
 *   client and target.
 * - `expectations.ts` is replaced by the limits that apply to the cell, so a new limit for CockroachDB reruns only
 *   CockroachDB cells.
 * - `targets/images.ts` is replaced by the digests of the images the target starts, so a new digest for one image
 *   reruns only the targets that start it.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { walk } from './graph.ts';
import { closure, type LockType, parseLock } from './lock.ts';

/** The suite's folder, relative to the repository root. */
export const suite = 'tests/interop';

/** Files that run every cell but that the walk does not reach: the test runner and the task that starts it. */
const runners = [
	'tools/testing/run.ts',
	'tools/testing/discover.ts',
	'.mise/tasks/test/interop.sh',
	`${suite}/package.json`,
];

/** Files the key replaces with their meaning for one cell; see the module notes. */
const replaced = new Set([
	`${suite}/clients/mod.ts`,
	`${suite}/targets/mod.ts`,
	`${suite}/expectations.ts`,
	`${suite}/targets/images.ts`,
]);

/** The types module the cases load for each server flavor; see `cases/mod.ts`. */
const flavors: Readonly<Record<string, string>> = {
	postgres: 'packages/sql/postgres/mod.ts',
	cockroach: 'packages/sql/postgres/cockroach.ts',
};
const flavorFiles = new Set(Object.values(flavors));

/** The shape of a client and a target that the key reads; the suite's own types hold more. */
interface ClientType {
	readonly name: string;
	readonly reach: string;
	readonly runtime: 'node' | 'bun' | 'deno';
}
interface TargetType {
	readonly name: string;
	readonly reach?: string;
	readonly flavor?: string;
	readonly images: readonly string[];
}
interface LimitType {
	readonly targets?: readonly string[];
	readonly clients?: readonly string[];
}

/** One cell and the file that defines each side of it. */
export interface CellType {
	readonly target: string;
	readonly client: string;
	readonly key: string;
	/** Image references the target starts, for the CI step that stores them. */
	readonly images: readonly string[];
	/** How many clients may run against the target at once, from its module's `concurrency` export; 4 by default. */
	readonly concurrency: number;
	/** Repository files in the key, for `explain` and the planner's tests. */
	readonly files: readonly string[];
	/** npm packages in the key, as `importer package`. */
	readonly packages: readonly string[];
}

const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

/** The modules of one suite folder, each with what it exports under the names the suite uses. */
async function modules(root: string, folder: string, skip: readonly string[]) {
	const dir = path.join(root, suite, folder);
	const files = readdirSync(dir).filter((name) => name.endsWith('.ts') && !skip.includes(name)).sort();
	return await Promise.all(files.map(async (name) => ({
		file: `${suite}/${folder}/${name}`,
		exports: await import(pathToFileURL(path.join(dir, name)).href) as Record<string, unknown>,
	})));
}

/** Pinned runtime versions from `mise.toml`: the exact versions CI installs. */
export function tools(root: string): Readonly<Record<string, string>> {
	const text = readFileSync(path.join(root, 'mise.toml'), 'utf8');
	const section = /^\[tools\]\n([\s\S]*?)(?:^\[|$(?![\s\S]))/mu.exec(text)?.[1] ?? '';
	return Object.fromEntries([...section.matchAll(/^(\w+)\s*=\s*"([^"]+)"/gmu)].map((match) => [match[1]!, match[2]!]));
}

/** Compute every cell and its key. */
export async function cells(root: string): Promise<readonly CellType[]> {
	const lock: LockType = parseLock(readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
	const versions = tools(root);
	const clientModules = await modules(root, 'clients', ['types.ts', 'mod.ts']);
	const targetModules = await modules(root, 'targets', ['types.ts', 'mod.ts', 'images.ts', 'server.ts']);
	const clients = clientModules.flatMap(({ file, exports }) =>
		[...(exports.clients ?? []) as readonly ClientType[], ...(exports.client ? [exports.client as ClientType] : [])]
			.map((client) => ({ file, client }))
	);
	const targets = targetModules.flatMap(({ file, exports }) =>
		[...(exports.targets ?? []) as readonly TargetType[], ...(exports.target ? [exports.target as TargetType] : [])]
			.map((target) => ({ file, target, concurrency: Number(exports.concurrency ?? 4) }))
	);
	const { limits } = await import(pathToFileURL(path.join(root, suite, 'expectations.ts')).href) as {
		limits: readonly LimitType[];
	};
	// The digest names an image whatever registry, mirror or local tag serves it.
	const { digest } = await import(pathToFileURL(path.join(root, suite, 'targets/images.ts')).href) as {
		digest: (reference: string) => string;
	};
	const { reaches } = await import(pathToFileURL(path.join(root, suite, 'cells.ts')).href) as {
		reaches: (client: ClientType, target: TargetType) => boolean;
	};
	const clientFiles = new Set(clients.map(({ file }) => file));
	const hashes = new Map<string, string>();
	const hash = (file: string) => {
		let found = hashes.get(file);
		if (!found) hashes.set(file, found = sha(readFileSync(path.join(root, file))));
		return found;
	};
	const found: CellType[] = [];
	for (const { file: targetFile, target, concurrency } of targets) {
		for (const { file: clientFile, client } of clients) {
			if (!reaches(client, target)) continue;
			const roots = [`${suite}/matrix.test.ts`, clientFile, targetFile];
			if (client.runtime !== 'node') roots.push(`${suite}/runtime.ts`);
			const flavor = flavors[target.flavor ?? 'postgres'];
			const graph = walk(root, roots, {
				skip: replaced,
				// `runtime.ts` loads the Bun or the Deno client by name, and the cases load the types module of the
				// server's flavor; a cell follows only its own.
				dynamic: (_from, to) => (!clientFiles.has(to) || to === clientFile) && (!flavorFiles.has(to) || to === flavor),
			});
			const files = [...new Set([...graph.files, ...runners])].sort();
			const npm = [...graph.packages].sort().map((entry) => {
				const [importer, name] = entry.split('\0') as [string, string];
				return [importer, name, ...closure(lock, importer, name)];
			});
			const identity = {
				schema: 'interop-cell-v1',
				target: target.name,
				client: client.name,
				files: files.map((file) => [file, hash(file)]),
				npm,
				tools: {
					node: versions.node,
					...(client.runtime === 'node' ? {} : { [client.runtime]: versions[client.runtime] }),
				},
				images: target.images.map(digest),
				limits: limits.filter((limit) =>
					(limit.targets?.includes(target.name) ?? true) && (limit.clients?.includes(client.name) ?? true)
				),
				platform: `${process.platform}-${process.arch}`,
			};
			found.push({
				target: target.name,
				client: client.name,
				key: `interop-v1-${sha(JSON.stringify(identity))}`,
				images: target.images,
				concurrency,
				files,
				packages: npm.map(([importer, name]) => `${importer} ${name}`),
			});
		}
	}
	return found;
}
