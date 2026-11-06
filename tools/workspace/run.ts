/** Public repository workflows. Selection is validated before any recipe starts. @module */
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const family = process.argv[2];
const supplied = process.argv.slice(3);
const boundary = supplied.indexOf('--');
const forwarded = boundary < 0 ? [] : supplied.slice(boundary + 1);
const { values, positionals } = parseArgs({
	args: boundary < 0 ? supplied : supplied.slice(0, boundary),
	allowPositionals: true,
	options: {
		kind: { type: 'string' },
		project: { type: 'string', multiple: true },
		runtime: { type: 'string', default: 'deno' },
		suite: { type: 'string' },
		target: { type: 'string', default: 'npm' },
		operation: { type: 'string' },
		bump: { type: 'string' },
		message: { type: 'string' },
		check: { type: 'boolean' },
		write: { type: 'boolean' },
		full: { type: 'boolean' },
		help: { type: 'boolean' },
		base: { type: 'string' },
		head: { type: 'string' },
		lane: { type: 'string' },
		output: { type: 'string' },
		program: { type: 'string' },
		'timeout-ms': { type: 'string' },
		reverse: { type: 'boolean' },
		'with-deps': { type: 'boolean' },
		'source-root': { type: 'string' },
		jobs: { type: 'string' },
		concurrency: { type: 'string' },
		samples: { type: 'string' },
		seed: { type: 'string' },
	},
});

if (values.help) {
	console.log(`Usage: mise run ${family} [options] [file-or-directory ...]
  --project <name>    Select a utility; repeat to select several
  --runtime <host>    deno (default), node, or bun
  --kind <operation> Select a check or preparation operation
  --suite <suite>    source, comparisons, docs, examples, packages, bundles,
                     browser, postgres, containers, soak, list
  --check            Benchmark correctness or release/publish dry runs
  --operation <name> bench: measure, compare, profile; release: add, plan, version, publish
  --full             Select all CI lanes (default planning uses --base and --head)
  --output <path>    Fresh report directory

Preparation kinds: deps, bench, browser, freeze
Check kinds: format, lint, types, portable, exports, packages, hono, tests, versions, jsr
Build targets: npm, exports. Export generation is explicit with --write.
Additional operation inputs are validated by their owning program.`);
	process.exit(0);
}
const projects =
	values.project?.map((name) => name.replace(/^@okikio\//u, '').replace(/^packages\//u, '').replace(/\/$/u, '')) ?? [];
const members = readdirSync('packages', { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) =>
	entry.name
);
for (const name of projects) {
	if (name !== 'tools' && !members.includes(name)) throw new TypeError(`Unknown project ${name}.`);
}
if (!['deno', 'node', 'bun'].includes(values.runtime!)) throw new TypeError('Runtime must be deno, node, or bun.');
const selectors = [
	...projects.map((name) => name === 'tools' ? 'tools' : `packages/${name}`),
	...positionals,
	...forwarded,
];

/** Recipes are trusted repository code. User arguments remain separate argv entries, never shell interpolation. */
function command(binary: string, args: readonly string[], environment: NodeJS.ProcessEnv = process.env): void {
	const result = spawnSync(binary, [...args], { cwd: root, stdio: 'inherit', env: environment });
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`${binary} stopped with ${result.signal}.`);
	if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Mise owns recipe dependencies; this CLI only selects an operation and forwards its arguments. */
function operation(name: string, args: readonly string[] = []): void {
	command('mise', ['run', `ops:${name}`, '--', ...args]);
}

/** Test source publication, including explicit public declarations, without uploading packages. */
function jsr(): void {
	command('deno', [
		'publish',
		'--dry-run',
		'--frozen-lockfile',
		...(process.env.CI ? [] : ['--allow-dirty']),
	]);
}

/** Run checks independently; the caller decides which checks are advisory in CI. */
function check(kind = values.kind): void {
	const kinds = kind
		? [kind]
		: ['format', 'lint', 'types', 'portable', 'exports', 'packages', 'hono', 'tests', 'versions'];
	if (kinds.length > 1) {
		command('mise', ['run', ...kinds.flatMap((name, index) => [...(index ? [':::'] : []), `ops:check:${name}`])]);
		return;
	}
	for (const name of kinds) {
		if (name === 'jsr') jsr();
		else if (['format', 'lint'].includes(name) && projects.length) {
			command('deno', [name === 'format' ? 'fmt' : 'lint', ...(name === 'format' ? ['--check'] : []), ...selectors]);
		} else operation(`check:${name}`);
	}
}

/** Infrastructure is selected explicitly, so a missing database cannot become a skipped source test. */
function test(suite = values.suite ?? 'source'): void {
	if (suite === 'source') operation(`test:${values.runtime}`, selectors);
	else if (suite === 'comparisons') operation('test:comparisons', [values.runtime!, ...selectors]);
	else if (suite === 'packages') {
		operation('test:npm');
		operation('test:consumer');
		operation('test:browser:artifact');
	} else if (suite === 'examples') command('node', ['tools/testing/examples-run.ts', '--runtime', values.runtime!]);
	else operation(`test:${suite}`, selectors);
}

/** Keep common benchmark selection separate from experiment-specific arguments. */
function bench(): void {
	const name = values.operation ?? 'measure';
	const args = [...positionals, ...forwarded];
	if (values.output) args.unshift(values.output);
	if (name === 'measure') {
		if (projects.length > 1) throw new TypeError('Measure one project per retained report.');
		args.push(`--runtime=${values.runtime}`, `--suite=${values.suite ?? (projects.length ? 'packages' : 'all')}`);
		if (projects[0]) args.push(`--project=${projects[0]}`);
		if (values.program) args.push(`--program=${values.program}`);
		if (values['timeout-ms']) args.push(`--timeout-ms=${values['timeout-ms']}`);
		if (values.reverse) args.push('--reverse');
		if (values.check) {
			if (values.output) throw new TypeError('--output is for measured reports.');
			operation('bench:check', args);
		} else operation('bench:run', args);
	} else if (name === 'freeze') {
		// Preparation is explicit: a correctness check must reject a stale checkpoint rather than replace it.
		operation(`bench:freeze:${values.check ? 'check' : 'run'}`, [
			...positionals,
			...(values.output ? ['--output', values.output] : []),
			...(values.seed ? ['--seed', values.seed] : []),
		]);
	} else {
		for (const key of ['source-root', 'jobs', 'concurrency', 'samples'] as const) {
			if (values[key]) args.push(`--${key}`, values[key]!);
		}
		operation(`bench:${name}`, [...args, ...(values.check ? ['--check'] : [])]);
	}
}

/** CI receives a revision-based plan and runs the same operations available to a maintainer. */
async function ci(): Promise<void> {
	if (family === 'ci:plan') {
		const { plan } = await import('./ci.ts');
		const paths: string[] = [];
		if (!values.full) {
			if (!values.base || !values.head) throw new TypeError('Affected planning requires --base and --head, or --full.');
			for (const revision of [values.base, values.head]) {
				if (!/^[a-f0-9]{40}$/iu.test(revision)) throw new TypeError('CI revisions must be full commit hashes.');
			}
			const result = spawnSync('git', ['diff', '--name-only', '-z', values.base, values.head], { encoding: 'utf8' });
			if (result.status !== 0) throw new Error(result.stderr);
			paths.push(...result.stdout.split('\0').filter(Boolean));
		}
		const result = plan(
			paths,
			members.map((name) => {
				const manifest = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8'));
				return {
					name,
					dependencies: Object.keys({
						...manifest.dependencies,
						...manifest.peerDependencies,
						...manifest.optionalDependencies,
					}).filter((name) => name.startsWith('@okikio/')).map((name) => name.slice(8)),
				};
			}),
			values.full,
		);
		console.log(JSON.stringify(result, null, 2));
		if (process.env.GITHUB_OUTPUT) {
			for (const [name, selected] of Object.entries(result.lanes)) {
				appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${selected}\n`);
			}
		}
	} else {
		switch (values.lane) {
			case 'source':
				for (const kind of ['types', 'portable', 'exports', 'packages', 'hono', 'tests', 'versions']) check(kind);
				break;
			case 'advisory':
				check('format');
				check('lint');
				break;
			case 'runtimes':
				test('source');
				test('comparisons');
				break;
			case 'packages':
				test('packages');
				operation('bench:npm', ['--check']);
				jsr();
				break;
			case 'benchmark':
				values.check = true;
				bench();
				operation('bench:freeze:prepare');
				operation('bench:freeze:check');
				break;
			case 'browser':
				operation('prepare:browser', ['--with-deps']);
				test('browser');
				break;
			case 'docs':
				test('docs');
				test('bundles');
				break;
			case 'examples':
				test('examples');
				break;
			case 'postgres':
				test('postgres');
				break;
			case 'containers':
				test('containers');
				break;
			default:
				throw new TypeError('Select a known --lane.');
		}
	}
}

switch (family) {
	case 'prepare':
		if (values.kind === 'freeze') operation('bench:freeze:prepare');
		else {operation(`prepare:${values.kind ?? 'deps'}`, [
				...positionals,
				...forwarded,
				...(values['with-deps'] ? ['--with-deps'] : []),
			]);}
		break;
	case 'check':
		check();
		break;
	case 'test':
		test();
		break;
	case 'bench':
		bench();
		break;
	case 'build':
		if (values.target === 'exports') operation(values.write ? 'build:exports' : 'check:exports');
		else if (values.target === 'npm') command('node', ['tools/packages/npm.ts', 'build', ...projects]);
		else throw new TypeError('Unknown build target.');
		break;
	case 'verify':
		check();
		for (const runtime of ['deno', 'node', 'bun']) {
			values.runtime = runtime;
			test('source');
			test('comparisons');
			test('examples');
		}
		test('docs');
		test('bundles');
		test('packages');
		jsr();
		break;
	case 'release': {
		// Installation must run without workspace dependencies. Load release tooling only after selection.
		const { versions } = await import('../releases/versions.ts');
		const { candidates, clean } = await import('../releases/candidates.ts');
		const action = values.operation ?? 'plan';
		if (action === 'add') {
			command('pnpm', [
				'exec',
				'sampo',
				'add',
				...projects.flatMap((name) => ['--package', `npm/@okikio/${name}`]),
				...(values.bump ? ['--bump', values.bump] : []),
				...(values.message ? ['--message', values.message] : []),
				...forwarded,
			]);
		} else if (action === 'plan') {
			await versions(root);
			// A PR checks its release target, not GitHub's synthetic <number>/merge ref.
			// This override applies only to a read-only preview; writes retain Sampo's branch policy.
			command('pnpm', ['exec', 'sampo', 'release', '--dry-run'], {
				...process.env,
				SAMPO_RELEASE_BRANCH: process.env.GITHUB_BASE_REF || 'main',
			});
		} else if (action === 'version') {
			command(
				'pnpm',
				['exec', 'sampo', 'release', ...(values.check ? ['--dry-run'] : [])],
				values.check
					? {
						...process.env,
						SAMPO_RELEASE_BRANCH: process.env.GITHUB_BASE_REF || 'main',
					}
					: process.env,
			);
			if (!values.check) await versions(root, true);
		} else if (action === 'publish') {
			if (!values.check) clean(root);
			await versions(root);
			if (existsSync('.sampo/changesets') && readdirSync('.sampo/changesets').some((name) => name.endsWith('.md'))) {
				throw new Error('Prepare and merge the release versions before publishing pending changesets.');
			}
			// Publication selects a registry explicitly. A failed target can be retried at the same revision.
			if (values.target === 'npm') {
				await candidates(root);
				command('pnpm', ['exec', 'sampo', 'publish', ...(values.check ? ['--dry-run'] : [])]);
			} else if (values.target === 'jsr') {
				command('deno', ['publish', '--frozen-lockfile', ...(values.check ? ['--dry-run', '--allow-dirty'] : [])]);
			} else throw new TypeError('Select --target npm or jsr.');
		} else throw new TypeError('Release operation must be add, plan, version, or publish.');
		break;
	}
	case 'ci:plan':
	case 'ci:run':
		await ci();
		break;
	default:
		throw new TypeError(`Unknown workflow ${family}.`);
}
