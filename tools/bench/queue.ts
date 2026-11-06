/** Retain fresh-process queue contention measurements without adding a database requirement to CI. @module */
import { cpus, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { QueueBenchmarkReportType } from '#bench/queue.bench.ts';
import { claimOutput } from '#tools/bench/output.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values, positionals } = parseArgs({
	args: Deno.args,
	allowPositionals: true,
	strict: true,
	options: {
		'source-root': { type: 'string', default: root },
		jobs: { type: 'string', default: '200' },
		concurrency: { type: 'string', default: '8' },
		samples: { type: 'string', default: '3' },
		help: { type: 'boolean' },
	},
});
if (values.help) {
	console.log(
		'Usage: mise run bench -- --operation queue <fresh-output-directory> [--source-root=PATH] [--jobs=200] [--concurrency=8] [--samples=3]',
	);
	console.log(
		'Requires explicit UTILS_TEST_DATABASE_URL for a disposable PostgreSQL database. UTILS_BENCH_NODE optionally selects Node.',
	);
	Deno.exit(0);
}
if (positionals.length !== 1) throw new TypeError('Select exactly one fresh benchmark output directory.');
const jobs = count(values.jobs!, 'jobs', 10_000);
const concurrency = count(values.concurrency!, 'concurrency', Math.min(jobs, 64));
const samples = count(values.samples!, 'samples', 20);
const sourceRoot = await Deno.realPath(values['source-root']!);
const databaseUrl = Deno.env.get('UTILS_TEST_DATABASE_URL');
try {
	const url = new URL(databaseUrl ?? '');
	if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname.length < 2) throw new Error();
} catch {
	throw new TypeError('UTILS_TEST_DATABASE_URL must explicitly select a disposable PostgreSQL database.');
}
const executable = Deno.env.get('UTILS_BENCH_NODE') ?? 'node';
const version = await runtimeVersion(executable);
const output = resolve(positionals[0]!);
await claimOutput(output);
const harnessFiles = [
	'bench/queue.bench.ts',
	'tools/bench/queue.ts',
	'tools/bench/output.ts',
	'tools/workspace/operations.ts',
	'node_modules/postgres/package.json',
];
const metadata = {
	status: 'running' as 'running' | 'pass' | 'fail' | 'invalid',
	createdAt: new Date().toISOString(),
	question: 'What is the cost of terminal-write serialization for finite PostgreSQL queue completion batches?',
	method:
		'Fresh Node processes; fixed job count; prepare and claim before timing; verify every result and cleanup afterward. No adaptive calibration or timing gate.',
	cache:
		'Pool connections and queue admission/claim paths are warm; no complete() warmup. Database and operating-system caches may be warm.',
	gc: 'No forced collection requested by the workload; natural garbage collection remains in timing.',
	sourceRoot,
	configuration: { jobs, concurrency, samples, retention: jobs, processTimeoutMilliseconds: 240_000 },
	runtime: {
		name: 'node',
		executable,
		version,
		flags: [] as string[],
	},
	orchestrator: { name: 'deno', version: Deno.version },
	platform: {
		...Deno.build,
		release: release(),
		cpu: cpus()[0]?.model,
		logicalCpus: cpus().length,
		memoryBytes: totalmem(),
	},
	resourceLimits: await resourceLimits(),
	inputs: await identity(sourceRoot),
	inputsAfter: undefined as Record<string, string> | undefined,
	harness: await hashes(root, harnessFiles),
	harnessAfter: undefined as Record<string, string> | undefined,
	runs: [] as {
		namespace: string;
		report: string;
		stderr: string;
		exitCode: number | null;
		expired: boolean;
		status: 'running' | 'pass' | 'fail';
		cleanup?: QueueBenchmarkReportType['cleanup'];
		wallMilliseconds?: number;
		operationsPerSecond?: number;
		latencyMilliseconds?: { p50: number; p95: number; p99: number; maximum: number };
	}[],
	failure: undefined as string | undefined,
};
await save();
try {
	for (let sample = 0; sample < samples; sample += 1) {
		const namespace = `utils-bench-queue-${crypto.randomUUID()}`;
		const row: (typeof metadata.runs)[number] = {
			namespace,
			report: `${sample}.json`,
			stderr: `${sample}.stderr`,
			exitCode: null,
			expired: false,
			status: 'running',
		};
		metadata.runs.push(row);
		await save();
		const child = new Deno.Command(executable, {
			args: [resolve(root, 'bench/queue.bench.ts'), sourceRoot, String(jobs), String(concurrency), namespace],
			env: { UTILS_TEST_DATABASE_URL: databaseUrl!, NODE_DISABLE_COLORS: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
			stdout: 'piped',
			stderr: 'piped',
		}).spawn();
		const capture = new AbortController();
		const transfers = [
			captureOutput(child.stdout, `${output}/${row.report}`, capture.signal),
			captureOutput(child.stderr, `${output}/${row.stderr}`, capture.signal),
		];
		let kill: ReturnType<typeof setTimeout> | undefined;
		const timeout = setTimeout(() => {
			row.expired = true;
			try {
				child.kill('SIGTERM');
			} catch { /* Process already exited. */ }
			kill = setTimeout(() => {
				try {
					child.kill('SIGKILL');
				} catch { /* Cooperative cleanup already finished. */ }
				capture.abort(new Error('Queue sample output deadline exceeded.'));
			}, 15_000);
		}, metadata.configuration.processTimeoutMilliseconds);
		try {
			const [result] = await Promise.all([child.status, Promise.all(transfers)]);
			row.exitCode = result.code;
			const report = JSON.parse(await Deno.readTextFile(`${output}/${row.report}`)) as QueueBenchmarkReportType;
			row.cleanup = report.cleanup;
			if (!result.success || row.expired) throw new Error('Queue sample failed or exceeded its process deadline.');
			validate(report, namespace);
			row.wallMilliseconds = report.wallMilliseconds!;
			row.operationsPerSecond = jobs * 1000 / report.wallMilliseconds!;
			const durations = report.latencies.map((value) => value.milliseconds).sort((a, b) => a - b);
			row.latencyMilliseconds = {
				p50: quantile(durations, 0.5),
				p95: quantile(durations, 0.95),
				p99: quantile(durations, 0.99),
				maximum: durations.at(-1)!,
			};
			row.status = 'pass';
		} catch (error) {
			row.status = 'fail';
			throw error;
		} finally {
			clearTimeout(timeout);
			clearTimeout(kill);
			try {
				child.kill('SIGKILL');
			} catch { /* The sample already exited. */ }
			capture.abort();
			await Promise.allSettled(transfers);
			row.exitCode ??= (await child.status).code;
			await save();
		}
	}
	metadata.inputsAfter = await identity(sourceRoot);
	metadata.harnessAfter = await hashes(root, harnessFiles);
	if (
		JSON.stringify(metadata.inputs) !== JSON.stringify(metadata.inputsAfter) ||
		JSON.stringify(metadata.harness) !== JSON.stringify(metadata.harnessAfter)
	) {
		metadata.status = 'invalid';
		throw new Error('Selected source or benchmark harness changed during measurement. Discard timings.');
	}
	metadata.status = 'pass';
} catch (error) {
	if (metadata.status !== 'invalid') metadata.status = 'fail';
	metadata.failure = error instanceof Error ? error.message : 'Queue benchmark failed.';
	throw error;
} finally {
	await save();
}
console.log(`Recorded ${samples} verified queue samples in ${output}.`);

/** Keep partial failed output, cap file growth, and cancel inherited pipes at the hard deadline. */
async function captureOutput(stream: ReadableStream<Uint8Array>, path: string, signal: AbortSignal): Promise<void> {
	const file = await Deno.open(path, { createNew: true, write: true });
	let bytes = 0;
	const failures: unknown[] = [];
	try {
		await stream.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					bytes += chunk.byteLength;
					if (bytes > 8_388_608) throw new Error('Queue sample output exceeded 8 MiB.');
					controller.enqueue(chunk);
				},
			}),
		).pipeTo(file.writable, { signal });
	} catch (error) {
		failures.push(error);
	} finally {
		try {
			file.close();
		} catch (error) {
			if (!(error instanceof Deno.errors.BadResource)) failures.push(error);
		}
	}
	if (failures.length > 0) throw new AggregateError(failures, 'Queue sample output transfer failed.');
}

/** A runtime wrapper must not strand the controller before sample deadlines begin. */
async function runtimeVersion(executable: string): Promise<string> {
	const child = new Deno.Command(executable, { args: ['--version'], stdout: 'piped', stderr: 'null' }).spawn();
	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	let expired = false;
	const timeout = setTimeout(() => {
		expired = true;
		try {
			child.kill('SIGKILL');
		} catch { /* The probe already exited. */ }
		void reader.cancel().catch(() => {});
	}, 5000);
	try {
		let text = '';
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
			if (text.length > 4096) throw new Error('Node version response exceeded its bounded output.');
		}
		const status = await child.status;
		if (expired) throw new Error('Node version probe exceeded 5 seconds.');
		const version = (text + decoder.decode()).trim();
		if (!status.success || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
			throw new Error('Selected executable did not report a valid Node version.');
		}
		return version;
	} finally {
		clearTimeout(timeout);
		try {
			child.kill('SIGKILL');
		} catch { /* Join an already exited probe. */ }
		await reader.cancel().catch(() => {});
		reader.releaseLock();
		await child.status;
	}
}

/** Reject incomplete or invalid observations rather than silently retaining a partial successful sample. */
function validate(report: QueueBenchmarkReportType, namespace: string): void {
	if (
		report.status !== 'pass' || report.namespace !== namespace || report.jobs !== jobs ||
		report.concurrency !== concurrency ||
		report.retention !== jobs || report.verified !== jobs || report.retained !== jobs ||
		report.preparedConnections !== concurrency ||
		!report.cleanup.namespaceRemoved || !report.cleanup.poolClosed || report.errors.length !== 0 ||
		!Number.isFinite(report.wallMilliseconds) || report.wallMilliseconds! <= 0 || report.latencies.length !== jobs ||
		report.latencies.some((row, index) =>
			row.index !== index || !Number.isFinite(row.milliseconds) || row.milliseconds < 0
		)
	) throw new Error('Queue sample did not prove complete output, bounded observations and successful cleanup.');
}
/** Finite controls reject misspellings, fractions, zero and unbounded workloads before opening a pool. */
function count(value: string, label: string, maximum: number): number {
	const parsed = Number(value);
	if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
		throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`);
	}
	return parsed;
}
/** Empirical nearest-rank quantiles describe this batch; they are not production tail estimates. */
function quantile(sorted: number[], probability: number): number {
	return sorted[Math.max(0, Math.ceil(sorted.length * probability) - 1)]!;
}
/** Save failed and running states before propagating an error or starting the next process. */
async function save(): Promise<void> {
	await Deno.writeTextFile(`${output}/meta.json`, JSON.stringify(metadata, null, 2) + '\n');
}
/** Hash the selected checkout's production code, manifests and dependency locks without mutating it. */
async function identity(directory: string): Promise<Record<string, string>> {
	const paths = ['deno.jsonc', 'deno.lock', 'package.json', 'pnpm-lock.yaml'];
	async function visit(path: string): Promise<void> {
		for await (const entry of Deno.readDir(resolve(directory, path))) {
			if (
				entry.isSymlink || entry.name.startsWith('.example-') ||
				['node_modules', 'dist', 'fixtures'].includes(entry.name)
			) continue;
			const relative = `${path}/${entry.name}`;
			if (entry.isDirectory) await visit(relative);
			else if (/\.(?:ts|jsonc?)$/u.test(entry.name) && !/\.(?:test|bench)\.ts$/u.test(entry.name)) paths.push(relative);
		}
	}
	await visit('packages');
	return await hashes(directory, paths.sort());
}
/** SHA-256 ties each retained report to actual source bytes and the common measurement harness. */
async function hashes(directory: string, paths: string[]): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const path of paths) {
		const digest = await crypto.subtle.digest('SHA-256', await Deno.readFile(resolve(directory, path)));
		result[path] = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
	}
	return result;
}
/** Container quotas distinguish the available benchmark resources from host hardware totals. */
async function resourceLimits(): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	if (Deno.build.os !== 'linux') return result;
	for (const path of ['cpu.max', 'memory.max', 'cpuset.cpus.effective']) {
		try {
			result[path] = (await Deno.readTextFile(`/sys/fs/cgroup/${path}`)).trim();
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) throw error;
		}
	}
	return result;
}
