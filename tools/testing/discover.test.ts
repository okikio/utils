import { describe, it } from 'node:test';
import '@okikio/dispose/polyfill';
import { expect } from '@std/expect';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, discover, select, supports } from '#tools/testing/discover.ts';

describe('test discovery', () => {
	it('automatically admits a new package test without executing fixtures or following dependency links', async () => {
		await using cleanup = new AsyncDisposableStack();
		const temporary = new URL('../../.tmp/', import.meta.url);
		await mkdir(temporary, { recursive: true });
		const root = await mkdtemp(fileURLToPath(new URL('test-discovery-', temporary)));
		cleanup.defer(() => rm(root, { recursive: true, force: true }));
		for (
			const directory of [
				'packages/example/fixtures',
				'packages/example/.tmp',
				'tests',
				'tools',
				'bench',
				'node_modules',
			]
		) {
			await mkdir(join(root, directory), { recursive: true });
		}
		await writeFile(
			join(root, 'packages/example/new.test.ts'),
			'throw new Error("discovery must not execute source");',
		);
		await writeFile(join(root, 'packages/example/fixtures/ignored.test.ts'), '');
		// A retained diagnostic can resemble a test but must never join authored suites.
		await writeFile(join(root, 'packages/example/.tmp/ignored.test.ts'), 'throw new Error("temporary diagnostic");');
		await writeFile(join(root, 'node_modules/ignored.test.ts'), '');
		await symlink(join(root, 'node_modules'), join(root, 'packages/example/dependency'), 'dir');

		const files = await discover(root);

		expect(files.map((file) => file.path)).toEqual(['packages/example/new.test.ts']);
		for (const runtime of ['deno', 'node', 'bun'] as const) expect(supports(files[0]!, runtime)).toBe(true);
	});

	it('keeps PostgreSQL, container and compiler fixtures out of ordinary runtime tests', () => {
		const files = [
			'packages/storage/queue/postgres.test.ts',
			'packages/storage/state/postgres.test.ts',
			'tests/workflows/recovery.test.ts',
			'tests/workflows/containers.test.ts',
			'tests/workflows/streaming-load.test.ts',
			'tests/workflows/postgres-failover.test.ts',
			'tests/workflows/postgres-leases.test.ts',
			'tests/workflows/postgres-soak.test.ts',
			'packages/input/types.test.ts',
		].map(classify);
		expect(files.map((file) => file.family)).toEqual([
			'postgres',
			'postgres',
			'postgres',
			'containers',
			'containers',
			'containers',
			'containers',
			'soak',
			'types',
		]);
		for (const runtime of ['deno', 'node', 'bun'] as const) {
			expect(files.some((file) => supports(file, runtime))).toBe(false);
		}
	});

	it('rejects a mistyped or escaping selection while preserving deterministic directory selection', () => {
		const files = ['packages/context/view.test.ts', 'packages/context/state.test.ts', 'packages/input/keys.test.ts']
			.map(classify);
		expect(select(files, ['./packages/context/']).map((file) => file.path)).toEqual([
			'packages/context/state.test.ts',
			'packages/context/view.test.ts',
		]);
		expect(() => select(files, ['packages/contxt'])).toThrow(TypeError);
		expect(() => select(files, ['../packages/context'])).toThrow(TypeError);
	});
});
