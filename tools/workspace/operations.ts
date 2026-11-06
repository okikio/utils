/**
 * Private operation recipes used by the public workflows.
 * These retain each existing host and permission contract. Adding a package or
 * ordinary test does not add a recipe: selection belongs to discovery.
 * @module
 */
export const operations = {
	'bench:compare': {
		'description': 'Compare six fresh counterbalanced HTTP parity measurements',
		'dependencies': [
			'prepare:bench',
		],
		'script': 'set -euo pipefail\nexec deno run --frozen -A tools/bench/repeat.ts "$@"\n',
	},
	'bench:run': {
		'description': 'Record native benchmark reports with exact inputs and runtime metadata',
		'dependencies': [
			'prepare:bench',
		],
		'script': 'set -euo pipefail\nexec deno run --frozen -A tools/bench/measure.ts "$@"\n',
	},
	'bench:queue': {
		'description': 'Measure bounded PostgreSQL queue completion batches against an explicit disposable database',
		'dependencies': [
			'prepare:deps',
		],
		'script': 'set -euo pipefail\nexec deno run --frozen -A tools/bench/queue.ts "$@"\n',
	},
	'bench:challengers': {
		'description': 'Record counterbalanced independent HTTP implementation measurements',
		'dependencies': [
			'prepare:bench',
		],
		'script': 'set -euo pipefail\nexec node tools/bench/challenger-repeat.mjs "$@"\n',
	},
	'bench:check': {
		'description': 'Run all untimed benchmark fixture checks in isolated processes',
		'dependencies': [
			'prepare:bench',
		],
		'script': 'set -euo pipefail\nexec deno run --frozen --allow-read --allow-run tools/bench/check.ts --check "$@"\n',
	},
	'bench:profile': {
		'description': 'Record isolated native CPU profiles for selected workloads',
		'dependencies': [
			'prepare:bench',
		],
		'script': 'set -euo pipefail\nexec node tools/bench/profile.mjs "$@"\n',
	},
	'bench:npm': {
		'description': 'Measure installed npm root imports; --check validates fixtures without timing',
		'dependencies': [],
		'script':
			'set -euo pipefail\nexec deno run --frozen --no-check --allow-read --allow-run bench/npm-imports.bench.ts "$@"\n',
	},
	'bench:freeze:verify': {
		'description': 'Verify freeze source, dependency and treatment hashes; read-only unless --write',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/bench/freeze/verify.mjs "$@"\n',
	},
	'bench:freeze:prepare': {
		'description': 'Prepare current frozen/plain treatments and record verified dependency provenance',
		'dependencies': [],
		'script':
			'set -euo pipefail\nnode tools/bench/freeze/prepare.mjs\nexec node tools/bench/freeze/verify.mjs --write\n',
	},
	'bench:freeze:run': {
		'description': 'Measure prepared frozen/plain treatments; pass --output and --seed for new evidence',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node bench/freeze/freeze.bench.ts "$@"\n',
	},
	'bench:freeze:check': {
		'description': 'Validate the prepared frozen/plain experiment without timing or rewriting evidence',
		'dependencies': [],
		'script':
			'set -euo pipefail\nnode tools/bench/freeze/verify.mjs\nexec node bench/freeze/freeze.bench.ts --validate-only\n',
	},
	'bench:freeze:summarize': {
		'description': 'Summarize explicit freeze reports from one source checkpoint with raw-file hashes',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/bench/freeze/summarize.mjs "$@"\n',
	},
	'bench:profile:bun': {
		'description': 'Record JavaScriptCore CPU profiles for selected HTTP workloads',
		'dependencies': [
			'prepare:bench',
		],
		'script': 'set -euo pipefail\nexec node tools/bench/profile-bun.mjs "$@"\n',
	},
	'test:consumer': {
		'description': 'Run canonical tests against installed artifacts on Deno, Node ESM/CommonJS and Bun',
		'dependencies': [],
		'script': 'set -euo pipefail\nexport UTILS_BUN="${UTILS_BUN:-bun}"\nexec node tools/testing/consumer.mjs "$@"\n',
	},
	'test:browser': {
		'description': 'Test real Chromium input, pointer capture and module Worker ownership',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/browser.mjs "$@"\n',
	},
	'test:soak': {
		'description': 'Run opt-in two-hour PostgreSQL writes, lease renewal and primary promotion',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts soak "$@"\n',
	},
	'test:postgres': {
		'description':
			'Test workflow recovery, durable queues and persisted state against explicit UTILS_TEST_DATABASE_URL',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts postgres "$@"\n',
	},
	'test:bun': {
		'description': 'Run the same discovered portable tests and Bun Web Workers; optional selectors',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts bun "$@"\n',
	},
	'test:deno': {
		'description': 'Run discovered portable tests and Deno adapters; optional file or directory selectors',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts deno "$@"\n',
	},
	'test:node': {
		'description': 'Run discovered portable tests and native Node adapters; optional selectors',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts node "$@"\n',
	},
	'test:comparisons': {
		'description': 'Run prepared library comparisons: deno, node or bun, then optional selectors',
		'dependencies': [
			'prepare:bench',
		],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts comparisons "$@"\n',
	},
	'test:bundles': {
		'description': 'Test consumer bundles and browser-selected exports in a Web API host',
		'dependencies': [],
		'script':
			'set -euo pipefail\nmkdir -p .tmp/artifacts/tests/native\n{\n  deno run --frozen -A tools/packages/bundles.ts || exit "$?"\n  deno run --frozen -A tools/packages/browser.ts\n} 2>&1 | tee .tmp/artifacts/tests/native/bundles.log\n',
	},
	'test:list': {
		'description': 'List all tests with runtime or resource requirements',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts list "$@"\n',
	},
	'test:containers': {
		'description': 'Test worker recovery, streaming through nginx and PostgreSQL promotion with Docker',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts containers "$@"\n',
	},
	'test:npm': {
		'description': 'Build, inspect, pack and test physically installed npm archives',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/npm.ts verify\n',
	},
	'test:docs': {
		'description': 'Compile and execute maintained documentation examples',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts docs "$@"\n',
	},
	'test:browser:artifact': {
		'description': 'Test real Chromium against the installed npm archive consumer',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/browser.mjs --artifact "$@"\n',
	},
	'prepare:browser': {
		'description': 'Install the Chromium revision selected by the pinned Playwright package',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node node_modules/playwright/cli.js install chromium "$@"\n',
	},
	'prepare:bench': {
		'description': 'Emit the pinned competitor fixture for comparison tests and benchmarks',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/bench/prepare.mjs\n',
	},
	'prepare:deps': {
		'description': 'Install the frozen workspace dependency graph',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec pnpm install --frozen-lockfile\n',
	},
	'release:check': {
		'description': 'Check Bumpy release metadata without running source tests again',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec pnpm exec bumpy ci check --strict\n',
	},
	'build:exports': {
		'description': 'Regenerate umbrella forwarding modules from focused package exports',
		'dependencies': [],
		'script':
			'set -euo pipefail\nexec deno run --frozen --allow-read --allow-write --allow-env --allow-ffi tools/sync-utils-exports.ts --write\n',
	},
	'build:npm': {
		'description': 'Build ESM, CommonJS and declarations for all publishable packages',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/npm.ts build\n',
	},
	'check:portable': {
		'description': 'Compile browser, worker and Node consumer views without unrelated runtime globals',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/portable.ts\n',
	},
	'check:tests': {
		'description': 'Audit automatically discovered tests and their declared host requirements',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec node tools/testing/run.ts check\n',
	},
	'check:versions': {
		'description': 'Check package and JSR release-version agreement',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec deno run --frozen --allow-read .bumpy/release.ts check\n',
	},
	'check:lint': {
		'description': 'Lint authored TypeScript and JavaScript',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec deno lint\n',
	},
	'check:exports': {
		'description': 'Check focused-package and umbrella export agreement',
		'dependencies': [],
		'script':
			'set -euo pipefail\nexec deno run --frozen --allow-read --allow-env --allow-ffi tools/sync-utils-exports.ts --check\n',
	},
	'check:types': {
		'description': 'Compile source and public inference fixtures',
		'dependencies': [],
		'script':
			'set -euo pipefail\nexec node node_modules/typescript-native/bin/tsc --pretty false --project tsconfig.json\n',
	},
	'check:hono': {
		'description': 'Check pinned Hono fixture source and executable mappings',
		'dependencies': [],
		'script':
			'set -euo pipefail\nexec deno run --frozen --allow-read --allow-env tools/testing/hono-inventory.ts check\n',
	},
	'check:packages': {
		'description': 'Check publishable package metadata and targets',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec deno run --frozen --allow-read tools/packages/check.ts\n',
	},
	'check:format': {
		'description': 'Check formatting without modifying authored files',
		'dependencies': [],
		'script': 'set -euo pipefail\nexec deno fmt --check\n',
	},
} as const;
