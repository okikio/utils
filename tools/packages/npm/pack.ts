/** Pack and inspect physical npm archives, retaining content hashes for later consumers. @module */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { command } from './command.ts';
import type { Manifest, SourceType } from './source.ts';

/** Pack the exact staging directories and validate extracted archives with the pinned package tools. */
export async function pack(workspace: SourceType): Promise<void> {
	const { root, output, manifests } = workspace;
	const portable = [...manifests];

	const archives = resolve(output, 'archives');
	await mkdir(archives, { recursive: true });
	const packed: string[] = [];
	for (const [name] of portable) {
		const stage = resolve(output, name);
		const result = command(
			workspace,
			'npm',
			['pack', '--json', '--ignore-scripts', '--pack-destination', archives],
			stage,
			true,
		);
		const record = JSON.parse(result)[0];
		if (record.files.some((file: { path: string }) => /(?:^src\/|\.test\.|\.bench\.)/.test(file.path))) {
			throw new Error(`${name} packed source-only files.`);
		}
		const archive = resolve(archives, record.filename);
		packed.push(archive);
		const extracted = resolve(output, 'extracted', name);
		await rm(extracted, { recursive: true, force: true });
		await mkdir(extracted, { recursive: true });
		command(workspace, 'tar', ['-xzf', archive, '-C', extracted]);
		// Run the installed pinned tools directly; validation must not trigger a package-manager reinstall.
		command(
			workspace,
			'node',
			[resolve(root, 'node_modules/publint/src/cli.js'), resolve(extracted, 'package'), '--strict'],
			root,
		);
		// Raw WebAssembly files have no types to resolve; inspect() checked that each one is in the stage.
		const manifest = JSON.parse(await readFile(resolve(stage, 'package.json'), 'utf8')) as Manifest;
		const files = Object.entries(manifest.exports ?? {}).filter(([, target]) => typeof target === 'string')
			.map(([key]) => key);
		command(
			workspace,
			'node',
			[
				resolve(root, 'node_modules/@arethetypeswrong/cli/dist/index.js'),
				// The archive comes first: --exclude-entrypoints takes every argument after it.
				archive,
				'--profile',
				'esm-only',
				...(files.length ? ['--exclude-entrypoints', ...files] : []),
			],
			root,
		);
	}
	await writeFile(resolve(archives, 'manifest.json'), `${JSON.stringify(packed, null, 2)}\n`);
	await writeFile(
		resolve(archives, 'receipt.json'),
		`${
			JSON.stringify(
				await Promise.all(
					packed.map(async (path) => ({
						archive: path.split('/').at(-1),
						sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
					})),
				),
				null,
				2,
			)
		}\n`,
	);
}
