/** Execute an admitted CI lane without rebuilding native task or package selection. @module */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { packages } from '../../packages/source.ts';
import type { TestFile } from '../../testing/discover.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { values } = parseArgs({
	options: {
		lane: { type: 'string' },
		runtime: { type: 'string', default: 'deno' },
		'projects-json': { type: 'string' },
		shard: { type: 'string' },
		help: { type: 'boolean' },
	},
});

/** Native tools own execution; a signal or nonzero exit cannot become a successful lane receipt. */
function command(binary: string, args: readonly string[]): void {
	const result = spawnSync(binary, [...args], { cwd: root, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`${binary} stopped with ${result.signal}.`);
	if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Mise owns resource preparation and task dependencies; arguments remain separate argv entries. */
function task(name: string, args: readonly string[] = []): void {
	command('mise', ['run', name, '--', ...args]);
}

if (values.help) {
	console.log(
		'Usage: mise run ci:run -- --lane <lane> [--runtime deno|node|bun] [--projects-json <owner array>] [--shard <index>/<total>]',
	);
} else {
	const runtime = z.enum(['deno', 'node', 'bun']).parse(values.runtime);
	switch (values.lane) {
		case 'source':
			for (
				const name of [
					'types',
					'portable',
					'exports',
					'packages',
					'members',
					'hono',
					'tests',
					'versions',
					'wasm',
					'actions',
					'shell',
					'tasks',
					'secrets',
				]
			) task(`check:${name}`);
			break;
		case 'advisory':
			task('check:format');
			task('check:lint');
			// Advisory data changes without a commit, so this check stays outside the cached source lane.
			task('check:security');
			break;
		case 'runtimes': {
			const selection = values['projects-json'] === undefined
				? []
				: z.array(z.string()).parse(JSON.parse(values['projects-json']));
			if (selection.length === 0) task(`test:${runtime}`);
			else {
				const known = new Set(packages(root).map((member) => member.directory.slice('packages/'.length)));
				if (selection.some((name) => !known.has(name))) {
					throw new TypeError('CI runtime selection contains an unknown source owner.');
				}
				command('pnpm', [
					'--config.verifyDepsBeforeRun=error',
					...selection.flatMap((name) => ['--filter', `./packages/${name}`]),
					'--fail-if-no-match',
					'--no-sort',
					'-r',
					'exec',
					'pnpm',
					'--config.verifyDepsBeforeRun=error',
					'run',
					`test:${runtime}`,
				]);
				// Non-package compositions can combine any changed owner and remain required.
				task(`test:${runtime}`, ['tests', 'tools', 'bench']);
			}
			task('test:comparisons', [runtime]);
			break;
		}
		case 'packages':
			for (const name of ['test:npm', 'test:consumer', 'test:browser:artifact']) task(name);
			task('bench:npm', ['--check']);
			task('check:jsr');
			break;
		case 'benchmark':
			for (const name of ['bench:check', 'bench:freeze:prepare', 'bench:freeze:check']) task(name);
			break;
		case 'browser':
			task('fixture:browser', ['chromium', '--with-deps']);
			task('test:browser');
			break;
		case 'docs':
			task('test:docs');
			task('test:bundles');
			break;
		case 'examples':
			task('test:examples', ['--runtime', runtime]);
			break;
		case 'interop':
			// The workflow's INTEROP_TARGETS selects the servers this explicit resource job starts.
			task('test:interop');
			break;
		case 'postgres':
		case 'containers': {
			// Resource suites serialize their files locally; CI distributes those files across native jobs.
			const { BrowserFiles, discover, shard } = await import('../../testing/discover.ts');
			let files: readonly TestFile[] = (await discover(root)).filter((file) => file.family === values.lane);
			if (values.shard !== undefined) {
				const match = /^(\d+)\/(\d+)$/u.exec(values.shard);
				if (!match) throw new TypeError('Pass --shard as <index>/<total>, for example 2/3.');
				files = shard(files, Number(match[1]), Number(match[2]));
			}
			if (files.length === 0) {
				console.log(`No ${values.lane} test files fall in shard ${values.shard}.`);
				break;
			}
			// Only the shard that drives a real browser through its reverse proxy installs browser engines.
			if (files.some((file) => BrowserFiles.has(file.path))) {
				task('fixture:browser', ['chromium', 'firefox', 'webkit', '--with-deps']);
			}
			task(`test:${values.lane}`, files.map((file) => file.path));
			break;
		}
		default:
			throw new TypeError('Select a known CI --lane.');
	}
}
