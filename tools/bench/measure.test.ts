/** The recorder keeps samples, metadata and resource files in the caller's claimed directory. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Fixed report data exercises collection and validation without making a performance claim. */
const Report = {
	benchmarks: [{
		alias: 'report collection fixture',
		runs: [{ stats: { samples: [1], min: 1, max: 1, avg: 1, p25: 1, p50: 1, p75: 1, p99: 1, p999: 1 } }],
	}],
};

describe('benchmark report ownership', () => {
	for (const location of ['package', 'root', 'absolute'] as const) {
		it(`keeps all reports together for ${location} output`, async () => {
			await mkdir('.tmp/tests', { recursive: true });
			const root = await mkdtemp(resolve('.tmp/tests/measure-output-'));
			await using _cleanup = { [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) };
			// Copy the real recorder and its source owners into a dependency-free repository.
			// The only program emits fixed report data, so this checks paths without timing work.
			const files: Readonly<Record<string, string>> = {
				'deno.jsonc': '{"imports":{"#tools/":"./tools/"},"nodeModulesDir":"none","lock":false}\n',
				'deno.lock': '{}\n',
				'package.json': '{"type":"module"}\n',
				'pnpm-lock.yaml': 'lockfileVersion: 9\n',
				'mise.toml': '',
				'.mise/tasks/bench/run.sh': '',
				'.mise/tasks/fixture/bench.sh': '',
				'packages/example/report.bench.ts': `
import { writeFileSync } from 'node:fs';
import process from 'node:process';
const destination = process.argv.find((argument) => argument.startsWith('--resources='))?.slice(12);
if (destination === undefined) throw new Error('The recorder must supply a resource destination.');
writeFileSync(destination, JSON.stringify({ fixture: 'report collection', cwd: process.cwd() }) + '\\n');
console.log(${JSON.stringify(JSON.stringify(Report))});
console.error('report collection fixture');
`,
			};
			for (const [path, source] of Object.entries(files)) {
				const target = join(root, path);
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, source);
			}
			for (const directory of ['tools/bench', 'bench', 'tests/fixtures']) {
				await mkdir(join(root, directory), { recursive: true });
			}
			for (const name of ['measure.ts', 'output.ts', 'suite.ts', 'validate.ts']) {
				await copyFile(new URL(`./${name}`, import.meta.url), join(root, 'tools/bench', name));
			}
			const cwd = location === 'root' ? root : join(root, 'packages/example');
			const output = location === 'absolute' ? join(root, '.tmp/absolute-report') : '.tmp/report';
			const expected = location === 'absolute' ? output : join(cwd, output);
			const result = spawnSync('deno', [
				'run',
				'--frozen',
				'-A',
				join(root, 'tools/bench/measure.ts'),
				output,
				'--suite=packages',
			], { cwd, encoding: 'utf8', timeout: 10_000 });
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(0);
			const metadata = JSON.parse(await readFile(join(expected, 'meta.json'), 'utf8'));
			expect(metadata.status).toBe('pass');
			expect(metadata.inputsAfter).toEqual(metadata.inputs);
			expect(metadata.runs).toHaveLength(1);
			expect(metadata.runs[0].program).toBe('packages/example/report.bench.ts');
			expect(JSON.parse(await readFile(join(expected, '0.resources.json'), 'utf8')))
				.toEqual({ fixture: 'report collection', cwd });
			expect(JSON.parse(await readFile(join(expected, '0.json'), 'utf8'))).toEqual(Report);
			expect(await readFile(join(expected, '0.stderr'), 'utf8')).toContain('report collection fixture\n');
		});
	}
});
