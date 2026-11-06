import { describe, it } from 'node:test';
import '@okikio/dispose/polyfill';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@std/expect';
import { audit } from '#tools/testing/audit.ts';
import { classify } from '#tools/testing/discover.ts';

/** Register scratch cleanup with the caller's lexical owner before preparing unevaluated parser input. */
async function fixture(cleanup: AsyncDisposableStack, sources: Readonly<Record<string, string>>) {
	const scratch = fileURLToPath(new URL('../../.tmp/testing/audit/', import.meta.url));
	await mkdir(scratch, { recursive: true });
	const root = await mkdtemp(join(scratch, 'run-'));
	cleanup.defer(() => rm(root, { recursive: true, force: true }));
	await Promise.all(
		Object.entries(sources).map(async ([path, source]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), source);
		}),
	);
	return { root, files: Object.keys(sources).map(classify) };
}

describe('authored test registration', () => {
	it('rejects an imported runner with no call, including examples in comments or strings', async () => {
		await using cleanup = new AsyncDisposableStack();
		const { root, files } = await fixture(cleanup, {
			'packages/example/mod.test.ts': `import { test } from 'node:test';
// test('comment', () => {});
export const example = "test('string', () => {})";
`,
		});
		await expect(audit(root, files)).rejects.toBeInstanceOf(AggregateError);
	});

	it('recognizes aliased, namespace and native Deno registrations without executing their bodies', async () => {
		await using cleanup = new AsyncDisposableStack();
		const { root, files } = await fixture(cleanup, {
			'packages/example/alias.test.ts':
				"import { it as scenario } from 'node:test'; scenario('value', () => { throw 1; });",
			'packages/example/namespace.test.ts':
				"import * as runner from 'node:test'; runner.test.skip('optional', () => { throw 2; });",
			'packages/runtime/deno/host.test.ts': "Deno.test('host', () => { throw 3; });",
		});
		await audit(root, files);
	});

	it('keeps compiler fixtures separate and rejects behavior hidden inside a types filename', async () => {
		await using cleanup = new AsyncDisposableStack();
		const { root, files } = await fixture(cleanup, {
			'packages/example/types.test.ts':
				"import type { TestContext } from 'node:test'; export type Consumer = TestContext;",
		});
		await audit(root, files);
		await writeFile(join(root, files[0]!.path), "import { describe } from 'node:test'; describe('hidden', () => {});");
		await expect(audit(root, files)).rejects.toBeInstanceOf(AggregateError);
	});
});
