import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@std/expect';
import { challengerCandidates, challengerNames } from './challenger-contract.ts';
import {
	challengerOrders,
	challengerWorkloads,
	compareChallengers,
	completeChallengers,
} from './challenger-compare.ts';

describe('four-way benchmark evidence', () => {
	it('requires every workload/candidate exactly once, independently of registration order', () => {
		const aliases = challengerWorkloads.flatMap((id) =>
			challengerCandidates.map((candidate) => `${challengerNames[candidate]}: ${id}`)
		);
		expect(() => completeChallengers([...aliases].reverse())).not.toThrow();
		expect(() => completeChallengers(aliases.slice(4))).toThrow(TypeError);
		expect(() => completeChallengers([...aliases, aliases[0]!])).toThrow(TypeError);
		expect(() => completeChallengers([...aliases.slice(1), 'Other: challenger-api'])).toThrow(TypeError);
	});
	it('balances candidate position and every directed immediate predecessor across eight fresh trials', () => {
		for (const candidate of challengerCandidates) {
			for (let position = 0; position < challengerCandidates.length; position++) {
				expect(challengerOrders.filter((order) => order[position] === candidate)).toHaveLength(2);
			}
			for (const next of challengerCandidates.filter((value) => value !== candidate)) {
				expect(
					challengerOrders.filter((order) =>
						order.some((value, index) => value === candidate && order[index + 1] === next)
					),
				).toHaveLength(2);
			}
		}
	});
	it('preserves a known factor and uncertainty while rejecting incomplete or invalid process means', () => {
		const times = [1, 2, 4, 8, 16, 32, 64, 128];
		const half = compareChallengers('known', 'baseline', times.map((value) => value / 2), times);
		expect(half.ratio).toBeCloseTo(.5, 12);
		expect(half.interval95[0]).toBeCloseTo(.5, 12);
		expect(half.interval95[1]).toBeCloseTo(.5, 12);
		const noisy = compareChallengers('noisy', 'baseline', [1, 2, 1, 2, 1, 2, 1, 2], [2, 1, 2, 1, 2, 1, 2, 1]);
		expect(noisy.interval95[0]).toBeLessThan(1);
		expect(noisy.interval95[1]).toBeGreaterThan(1);
		expect(() => compareChallengers('missing', 'baseline', [1], [1])).toThrow(TypeError);
		expect(() => compareChallengers('zero', 'baseline', times, [1, 2, 4, 8, 16, 32, 64, 0])).toThrow(TypeError);
		expect(() => compareChallengers('invalid', 'baseline', times, [1, 2, 4, 8, 16, 32, 64, Infinity])).toThrow(
			TypeError,
		);
	});
});

/** These reports test controller transport and ownership, not framework performance. */
const nativeFixture = String.raw`
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.UTILS_VARIANT_TEST_MARKER, JSON.stringify({pid: process.pid}) + '\n');
if (process.env.UTILS_VARIANT_TEST_FAILURE === '1') {
  process.stdout.write(JSON.stringify({pid: process.pid, fixture: 'partial'}), () => {
    process.stderr.write('fixture failure fully written\n', () => process.exit(7));
  });
} else {
  const orders = [
    ['utils', 'hono', 'vixeny', 'elysia'],
    ['hono', 'elysia', 'utils', 'vixeny'],
    ['elysia', 'vixeny', 'hono', 'utils'],
    ['vixeny', 'utils', 'elysia', 'hono'],
    ['vixeny', 'utils', 'elysia', 'hono'],
    ['elysia', 'vixeny', 'hono', 'utils'],
    ['hono', 'elysia', 'utils', 'vixeny'],
    ['utils', 'hono', 'vixeny', 'elysia'],
  ];
  const index = Number(process.argv.find(value => value.startsWith('--order=')).slice(8));
  const workload = process.argv.find(value => value.startsWith('--workload=')).slice(11);
  console.error(JSON.stringify({
    phase: 'challenger-runtime', order: orders[index],
    runtime: {name: 'node', version: process.versions.node},
    elysia: {fixture: true}, vixeny: {fixture: true},
  }));
  const stats = {
    samples: [1000, 2000], min: 1000, max: 2000, avg: 1500,
    p25: 1000, p50: 1000, p75: 1000, p99: 1000, p999: 1000,
  };
  console.log(JSON.stringify({benchmarks: ['Utils', 'Hono', 'Elysia', 'Vixeny'].map(name => ({
    alias: name + ': ' + workload, runs: [{stats}],
  }))}));
}
`;

interface ProjectionType {
	readonly directory: string;
	readonly baseline: string;
	readonly candidate: string;
	readonly output: string;
	readonly marker: string;
}

/** Give each fault an independent valid pair and keep observations outside the hashed sources. */
async function projection(test: TestContext): Promise<ProjectionType> {
	const directory = await mkdtemp(join(tmpdir(), 'utils-variant-control-'));
	test.after(() => rm(directory, { recursive: true, force: true }));
	const baseline = join(directory, 'baseline'), candidate = join(directory, 'candidate');
	const files: Readonly<Record<string, string>> = {
		'bench/http-challengers.bench.ts': nativeFixture,
		'bench/challenger-compare.ts': '// comparison control\n',
		'bench/challenger-contract.ts': '// candidate control\n',
		'bench/challenger-run.ts': '// runtime control\n',
		'bench/fixtures/http-challengers.ts': '// workload control\n',
		'pnpm-lock.yaml': 'lockfileVersion: 9\n',
		'deno.lock': '{}\n',
		'package.json': '{"type":"module"}\n',
		'mise.toml': '[tools]\nnode = "26.10.0"\n',
		'deno.jsonc':
			'// authored JSONC\n{"imports":{"example":"npm:example@1"},"compilerOptions":{"strict":true},"tasks":{},"fmt":{},"lint":{}}\n',
		'tests/fixtures/http-parity/corpus.ts': '// literal oracle control\n',
		'tests/fixtures/http-parity/hono.ts': '// Hono control\n',
		'tests/fixtures/http-parity/elysia.ts': '// Elysia control\n',
		'tests/fixtures/http-parity/vixeny.ts': '// Vixeny control\n',
		'tests/fixtures/http-parity/vixeny-runtime.ts': '// loader control\n',
		'.artifacts/challengers/vixeny.mjs': '// emitted native candidate control\n',
		'.artifacts/challengers/vixeny-build.json': '{}\n',
	};
	for (const root of [baseline, candidate]) {
		for (const [name, contents] of Object.entries(files)) {
			const path = join(root, name);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, contents);
		}
	}
	return {
		directory,
		baseline,
		candidate,
		output: join(directory, 'output'),
		marker: join(directory, 'launched.jsonl'),
	};
}

/** Join the real controller; the watchdog bounds a broken control without defining acceptable speed. */
async function compareProjection(
	fixture: ProjectionType,
	options: { readonly candidate?: string; readonly workload?: string; readonly failure?: boolean } = {},
): Promise<{ readonly code: number | null; readonly signal: string | null }> {
	const child = spawn('node', [
		fileURLToPath(new URL('./variant-repeat.mjs', import.meta.url)),
		fixture.output,
		`--baseline=${fixture.baseline}`,
		`--candidate=${options.candidate ?? fixture.candidate}`,
		'--runtime=node',
		`--workload=${options.workload ?? 'challenger-api'}`,
	], {
		cwd: fixture.directory,
		env: {
			...process.env,
			UTILS_VARIANT_TEST_MARKER: fixture.marker,
			UTILS_VARIANT_TEST_FAILURE: options.failure ? '1' : '0',
		},
		stdio: ['ignore', 'ignore', 'ignore'],
	});
	let failure: Error | undefined;
	child.once('error', (error) => {
		failure = error;
	});
	const watchdog = setTimeout(() => {
		failure = new Error('Controller control exceeded its watchdog.');
		child.kill('SIGKILL');
	}, 60_000);
	try {
		const exit = await new Promise<{ code: number | null; signal: string | null }>((settle) =>
			child.once('close', (code, signal) => settle({ code, signal }))
		);
		if (failure) throw failure;
		return exit;
	} finally {
		clearTimeout(watchdog);
	}
}

/** File absence must mean ENOENT rather than another access failure. */
async function absent(path: string): Promise<boolean> {
	try {
		await access(path);
		return false;
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return true;
		throw error;
	}
}

describe('source comparison controller boundaries', () => {
	it('rejects one physical source through either identical paths or a symlink before launching', async (test) => {
		for (const alias of [false, true]) {
			const fixture = await projection(test);
			const candidate = alias ? join(fixture.directory, 'alias') : fixture.baseline;
			if (alias) await symlink(fixture.baseline, candidate, 'dir');
			expect((await compareProjection(fixture, { candidate })).code).not.toBe(0);
			expect(await absent(fixture.marker)).toBe(true);
			expect(await absent(fixture.output)).toBe(true);
		}
	});
	it('preserves an existing evidence directory and never starts a trial in it', async (test) => {
		const fixture = await projection(test);
		await mkdir(fixture.output);
		const sentinel = join(fixture.output, 'comparison.json');
		await writeFile(sentinel, 'previous independently retained evidence\n');
		expect((await compareProjection(fixture)).code).not.toBe(0);
		expect(await readFile(sentinel, 'utf8')).toBe('previous independently retained evidence\n');
		expect(await absent(fixture.marker)).toBe(true);
	});
	it('accepts JSONC presentation/task differences while forwarding the selected workload through all pairs', async (test) => {
		const fixture = await projection(test);
		await writeFile(
			join(fixture.candidate, 'deno.jsonc'),
			`{
			// The order and task/presentation fields can change without changing runtime interpretation.
			"lint":{"rules":{"exclude":["no-unused-vars"]}}, "tasks":{"sync":"tool --check"},
			"compilerOptions":{"strict":true}, "fmt":{"lineWidth":120}, "imports":{"example":"npm:example@1"}
		}\n`,
		);
		const workload = 'challenger-routes-16';
		expect((await compareProjection(fixture, { workload })).code).toBe(0);
		const receipt = JSON.parse(await readFile(join(fixture.output, 'meta.json'), 'utf8'));
		const comparison = JSON.parse(await readFile(join(fixture.output, 'comparison.json'), 'utf8'));
		expect(receipt.status).toBe('pass');
		expect(receipt.trials).toHaveLength(16);
		expect(receipt.trials.every((trial: { status: string }) => trial.status === 'pass')).toBe(true);
		expect(comparison.workload).toBe(workload);
		for (const variant of ['baseline', 'candidate']) {
			for (const name of ['utils', 'hono', 'elysia', 'vixeny']) {
				expect(comparison.rows[variant][name]).toEqual(Array(8).fill(1500));
			}
		}
		expect((await readFile(fixture.marker, 'utf8')).trim().split('\n')).toHaveLength(16);
	});
	it('rejects independent dependency, runtime-tool and Deno interpretation drift before native launch', async (test) => {
		for (
			const [name, contents] of [
				['pnpm-lock.yaml', 'lockfileVersion: 8\n'],
				['package.json', '{"type":"module","imports":{"#control":"./different.js"}}\n'],
				['mise.toml', '[tools]\nnode = "different"\n'],
				['deno.jsonc', '{"imports":{"example":"npm:example@2"},"compilerOptions":{"strict":true}}\n'],
				['deno.jsonc', '{"imports":{"example":"npm:example@1"},"compilerOptions":{"strict":false}}\n'],
			] as const
		) {
			const fixture = await projection(test);
			await writeFile(join(fixture.candidate, name), contents);
			expect((await compareProjection(fixture)).code).not.toBe(0);
			const receipt = JSON.parse(await readFile(join(fixture.output, 'meta.json'), 'utf8'));
			expect(receipt.status).toBe('fail');
			expect(receipt.trials).toEqual([]);
			expect(await absent(fixture.marker)).toBe(true);
		}
	});
	it('joins a failed native trial and retains complete raw streams with a failed trial receipt', async (test) => {
		const fixture = await projection(test);
		expect((await compareProjection(fixture, { failure: true })).code).not.toBe(0);
		const receipt = JSON.parse(await readFile(join(fixture.output, 'meta.json'), 'utf8'));
		const raw = JSON.parse(await readFile(join(fixture.output, 'baseline-0.json'), 'utf8'));
		expect(receipt.status).toBe('fail');
		expect(receipt.trials).toHaveLength(1);
		expect(receipt.trials[0].status).toBe('fail');
		expect(receipt.trials[0].pid).toBe(raw.pid);
		expect(raw.fixture).toBe('partial');
		expect(await readFile(join(fixture.output, 'baseline-0.stderr'), 'utf8')).toBe('fixture failure fully written\n');
		expect(() => process.kill(raw.pid, 0)).toThrow();
	});
});
