/**
 * Plan, record and keep the interoperability suite's results in CI, one cell at a time.
 *
 * ```sh
 * node tools/testing/interop/cli.ts fetch --out .tmp/interop/ledgers      # newest trusted ledgers, from artifacts
 * node tools/testing/interop/cli.ts plan --ledgers .tmp/interop/ledgers --out .tmp/interop/plan.json [--fresh]
 * node tools/testing/interop/cli.ts images --target cockroachdb --out .tmp/interop/images.txt  # pull ref and local tag
 * node tools/testing/interop/cli.ts record --target cockroachdb --out .tmp/interop/passed/cockroachdb.json
 * node tools/testing/interop/cli.ts merge --base .tmp/interop/plan.json --passed .tmp/interop/passed --out ledger.json
 * node tools/testing/interop/cli.ts explain --target postgres-18 --client postgresjs
 * ```
 *
 * `plan` writes one shard per target that has a cell whose key the ledger lacks, holding only those clients, and
 * GitHub outputs `interop` (whether any shard runs) and `shards` (the matrix). A target whose cells all passed before
 * starts no job at all.
 *
 * @module
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import type { CellType } from './keys.ts';
import { empty, type LedgerType, merge, parse, type PassType, prune } from './ledger.ts';

const root = path.resolve(import.meta.dirname, '../../..');

/** Every cell and its key. Loaded only by commands that need it, so `merge` runs without the suite's dependencies. */
const cells = async (): Promise<readonly CellType[]> => (await import('./keys.ts')).cells(root);

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		out: { type: 'string' },
		ledgers: { type: 'string' },
		base: { type: 'string' },
		passed: { type: 'string' },
		results: { type: 'string', default: '.tmp/tests/interop/results.json' },
		target: { type: 'string' },
		client: { type: 'string' },
		fresh: { type: 'boolean', default: false },
	},
});

/** Append GitHub step outputs, when running in Actions. */
function output(entries: Readonly<Record<string, string>>): void {
	const file = process.env.GITHUB_OUTPUT;
	if (!file) return;
	appendFileSync(file, Object.entries(entries).map(([key, value]) => `${key}=${value}\n`).join(''));
}

/** Every ledger JSON file in a folder, merged; a folder that is missing or holds none gives the empty ledger. */
function ledgers(dir: string | undefined): LedgerType {
	if (!dir || !existsSync(dir)) return empty;
	const files = readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.map((entry) => path.join(entry.parentPath, entry.name));
	return merge(...files.map((file) => {
		try {
			return parse(readFileSync(file, 'utf8'));
		} catch (error) {
			console.warn(`Ignoring ${file}: ${(error as Error).message}`);
			return empty;
		}
	}));
}

/** The plan file: the merged ledger it read, and the shards it chose. */
interface PlanType {
	readonly ledger: LedgerType;
	readonly current: readonly string[];
	readonly shards: readonly { readonly target: string; readonly clients: string; readonly concurrency: number }[];
}

/** A trusted ledger artifact is one a push or a manual run of this repository uploaded; pull requests cannot. */
async function fetchLedgers(out: string): Promise<void> {
	const repository = process.env.GITHUB_REPOSITORY;
	const token = process.env.GH_TOKEN;
	mkdirSync(out, { recursive: true });
	if (!repository || !token) {
		console.warn('No GITHUB_REPOSITORY or GH_TOKEN: planning without earlier results.');
		return;
	}
	const api = async (route: string) => {
		const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, {
			headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
		});
		if (!response.ok) throw new Error(`GitHub API ${route}: ${response.status}`);
		return response;
	};
	type Artifact = { id: number; expired: boolean; created_at: string; workflow_run: { id: number } };
	const { artifacts } = await (await api('actions/artifacts?name=interop-ledger&per_page=20')).json() as {
		artifacts: Artifact[];
	};
	let taken = 0;
	let newest = '';
	for (const artifact of artifacts.filter((item) => !item.expired)) {
		if (taken === 5) break;
		const run = await (await api(`actions/runs/${artifact.workflow_run.id}`)).json() as { event: string };
		if (!['push', 'workflow_dispatch'].includes(run.event)) continue;
		const zip = path.join(out, `${artifact.id}.zip`);
		writeFileSync(zip, new Uint8Array(await (await api(`actions/artifacts/${artifact.id}/zip`)).arrayBuffer()));
		execFileSync('unzip', ['-o', '-q', zip, '-d', path.join(out, String(artifact.id))]);
		if (artifact.created_at > newest) newest = artifact.created_at;
		taken++;
	}
	if (newest) writeFileSync(path.join(out, 'newest.txt'), newest);
	console.log(`Read ${taken} earlier ledgers.`);
}

/** Group cells whose keys the ledger lacks into one shard per target. */
function shard(all: readonly CellType[], ledger: LedgerType, fresh: boolean) {
	const stale = all.filter((cell) => fresh || !ledger.cells[cell.key]);
	const targets = [...new Set(stale.map((cell) => cell.target))];
	return targets.map((target) => {
		const cells = stale.filter((cell) => cell.target === target);
		return { target, clients: cells.map((cell) => cell.client).join(','), concurrency: cells[0]!.concurrency };
	});
}

const command = positionals[0];
if (command === 'fetch') {
	await fetchLedgers(values.out ?? '.tmp/interop/ledgers');
} else if (command === 'plan') {
	const all = await cells();
	const ledger = ledgers(values.ledgers);
	const shards = shard(all, ledger, values.fresh);
	const plan: PlanType = { ledger, current: all.map((cell) => cell.key), shards };
	const out = values.out ?? '.tmp/interop/plan.json';
	mkdirSync(path.dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(plan)}\n`);
	const stale = shards.reduce((sum, item) => sum + item.clients.split(',').length, 0);
	console.log(`${all.length} cells, ${stale} to run, in ${shards.length} target shards.`);
	// An artifact lasts 90 days from upload; upload the ledger again once it is a month old, even with nothing to run.
	const newest = values.ledgers && existsSync(path.join(values.ledgers, 'newest.txt'))
		? Date.parse(readFileSync(path.join(values.ledgers, 'newest.txt'), 'utf8'))
		: 0;
	const renew = Date.now() - newest > 30 * 86_400_000;
	output({ interop: String(shards.length > 0), renew: String(renew), shards: JSON.stringify(shards) });
} else if (command === 'images') {
	const cell = (await cells()).find((item) => item.target === values.target);
	if (!cell) throw new TypeError(`Unknown target ${values.target}.`);
	const { digest, local } = await import('../../../tests/interop/targets/images.ts');
	// One line per image: where to pull it from, and the local tag the suite starts it by.
	const pairs = cell.images.map((reference) => `${reference} ${local(reference)}`);
	const key = cell.images.length
		? `interop-images-v1-${createHash('sha256').update(cell.images.map(digest).sort().join('\n')).digest('hex')}`
		: '';
	console.log(pairs.join('\n'));
	output({ key, count: String(pairs.length) });
	if (values.out) {
		mkdirSync(path.dirname(values.out), { recursive: true });
		writeFileSync(values.out, pairs.length ? `${pairs.join('\n')}\n` : '');
	}
} else if (command === 'record') {
	// A run stopped before its report records nothing; its cells run again next time.
	const results = (existsSync(values.results!) ? JSON.parse(readFileSync(values.results!, 'utf8')) : []) as {
		target: string;
		client: string;
		outcomes: { mismatch?: string }[];
	}[];
	const keys = new Map((await cells()).map((cell) => [`${cell.target}\0${cell.client}`, cell.key]));
	const now = new Date().toISOString();
	const passed: Record<string, PassType> = {};
	for (const record of results) {
		if (values.target && record.target !== values.target) continue;
		if (record.outcomes.some((outcome) => outcome.mismatch)) continue;
		const key = keys.get(`${record.target}\0${record.client}`);
		if (!key) continue;
		passed[key] = {
			target: record.target,
			client: record.client,
			sha: process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
			run: process.env.GITHUB_RUN_ID ?? '0',
			at: now,
		};
	}
	const out = values.out ?? `.tmp/interop/passed/${values.target ?? 'all'}.json`;
	mkdirSync(path.dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify({ version: 1, cells: passed })}\n`);
	console.log(`${Object.keys(passed).length} cells passed.`);
} else if (command === 'merge') {
	const plan = JSON.parse(readFileSync(values.base!, 'utf8')) as PlanType;
	const ledger = prune(merge(plan.ledger, ledgers(values.passed)), new Set(plan.current), new Date());
	const out = values.out ?? '.tmp/interop/ledger/ledger.json';
	mkdirSync(path.dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(ledger)}\n`);
	const known = plan.current.filter((key) => ledger.cells[key]).length;
	console.log(
		`Ledger holds ${Object.keys(ledger.cells).length} keys; ${known} of ${plan.current.length} current cells passed.`,
	);
} else if (command === 'explain') {
	const cell = (await cells()).find((item) => item.target === values.target && item.client === values.client);
	if (!cell) throw new TypeError(`No cell ${values.target} × ${values.client}.`);
	console.log([cell.key, '', ...cell.files, '', ...cell.packages, '', ...cell.images].join('\n'));
} else {
	throw new TypeError('Use fetch, plan, images, record, merge or explain.');
}
