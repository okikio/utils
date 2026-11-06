/** Summarize independent process runs without treating batch averages as service tails. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { digest } from '#tools/bench/freeze/provenance.mjs';

/** Read evidence and write derived summaries in ignored experiment output, independent of the caller's location. */
const root = resolve(import.meta.dirname, '../../..');
const directory = resolve(root, '.tmp/artifacts/bench/freeze');
const inventorySha256 = digest(await readFile(resolve(directory, 'inventory.json')));
/** Explicit files allow a local rerun to be summarized without mixing it with archived measurements. */
const requested = process.argv.slice(2);
/** Default discovery accepts completed runtime sample names and excludes summaries or unrelated JSON. */
const paths = requested.length > 0 ? requested.map((path) => resolve(path)) : (await readdir(directory))
	.filter((name) => /^(?:node|deno|bun)-\d+\.json$/.test(name))
	.sort()
	.map((name) => resolve(directory, name));
if (paths.length === 0) {
	throw new Error('No completed benchmark samples found.');
}

/** Interpolate observed batch averages; these are descriptive sample statistics. */
function quantile(values, proportion) {
	if (values.length === 0) throw new Error('Cannot summarize an empty sample.');
	/** Sort a copy so computing a quantile cannot destroy treatment-pair order elsewhere. */
	const ordered = [...values].sort((a, b) => a - b);
	const position = (ordered.length - 1) * proportion;
	const lower = Math.floor(position);
	const weight = position - lower;
	return ordered[lower] * (1 - weight) + ordered[Math.ceil(position)] * weight;
}

/** Keep dispersion visible instead of reporting only the fastest sample. */
function distribution(values) {
	return {
		count: values.length,
		median: quantile(values, 0.5),
		lowerQuartile: quantile(values, 0.25),
		upperQuartile: quantile(values, 0.75),
		minimum: Math.min(...values),
		maximum: Math.max(...values),
	};
}

/** Retain each process separately; independent runs must remain visible in the final dispersion evidence. */
const runs = [];
const receipts = [];
for (const path of paths) {
	const bytes = await readFile(path);
	if (receipts.some((receipt) => receipt.sha256 === digest(bytes))) {
		throw new Error('The same raw report cannot count as two independent processes.');
	}
	const data = JSON.parse(bytes.toString('utf8'));
	if (data.schemaVersion !== 2 || data.provenance?.inventorySha256 !== inventorySha256) {
		throw new Error(
			`${basename(path)} belongs to a different or unrecorded source checkpoint; select current samples explicitly.`,
		);
	}
	if (
		!Number.isSafeInteger(data.pairs) || data.pairs < 6 || data.pairs > 100 ||
		!Array.isArray(data.workloads) || data.workloads.length === 0 || !Array.isArray(data.samples) ||
		data.samples.length !== data.workloads.length * data.pairs * 2
	) {
		throw new Error(`${basename(path)} has incomplete benchmark samples.`);
	}
	const workloads = new Set(data.workloads.map((workload) => workload.name));
	if (workloads.size !== data.workloads.length) throw new Error(`${basename(path)} repeats a workload.`);
	const seen = new Set();
	for (const sample of data.samples) {
		const key = `${sample.workload}/${sample.pair}/${sample.variant}`;
		if (
			seen.has(key) || !workloads.has(sample.workload) || !['frozen', 'plain'].includes(sample.variant) ||
			!Number.isSafeInteger(sample.pair) || sample.pair < 0 || sample.pair >= data.pairs ||
			![0, 1].includes(sample.order) || !Number.isSafeInteger(sample.iterations) || sample.iterations < 1 ||
			![sample.milliseconds, sample.nanosecondsPerOperation, sample.operationsPerSecond].every((value) =>
				Number.isFinite(value) && value > 0
			) ||
			!Number.isFinite(sample.checksum)
		) {
			throw new Error(`${basename(path)} has an invalid or duplicate sample.`);
		}
		seen.add(key);
	}
	if (runs.length && JSON.stringify(data.workloads) !== JSON.stringify(runs[0].workloads)) {
		throw new Error('Selected reports describe different workloads.');
	}
	receipts.push({ path: basename(path), bytes: bytes.length, sha256: digest(bytes), inventorySha256 });
	/** Deno and Bun expose Node compatibility versions, so prefer their native runtime identity. */
	const runtime = data.environment.deno
		? `Deno ${data.environment.deno.deno}`
		: data.environment.bun
		? `Bun ${data.environment.bun}`
		: `Node ${data.environment.node}`;
	runs.push({ path: basename(path), runtime, ...data });
}

/** Every treatment pair has equal counts and equal consumed successful output. */
const rows = [];
for (const runtime of new Set(runs.map((run) => run.runtime))) {
	/** Runtime versions are summarized independently instead of presenting a universal engine result. */
	const runtimeRuns = runs.filter((run) => run.runtime === runtime);
	for (const workload of runtimeRuns[0].workloads) {
		/** Preserve absolute timings, paired effects, and process summaries as distinct evidence. */
		const frozen = [],
			plain = [],
			differences = [],
			overheads = [],
			processes = [];
		for (const run of runtimeRuns) {
			/** Per-process collections expose directional reversals that pooled medians can hide. */
			const processDifferences = [], processOverheads = [];
			const samples = run.samples.filter((sample) => sample.workload === workload.name);
			for (let pair = 0; pair < run.pairs; pair++) {
				const first = samples.find((sample) => sample.pair === pair && sample.variant === 'frozen');
				const second = samples.find((sample) => sample.pair === pair && sample.variant === 'plain');
				if (
					!first || !second || first.order === second.order || first.iterations !== second.iterations ||
					first.checksum !== second.checksum
				) {
					throw new Error(
						`Invalid pair: ${run.path}, ${workload.name}, ${pair}`,
					);
				}
				const difference = first.nanosecondsPerOperation -
					second.nanosecondsPerOperation;
				const overhead = (first.nanosecondsPerOperation / second.nanosecondsPerOperation - 1) *
					100;
				frozen.push(first.nanosecondsPerOperation);
				plain.push(second.nanosecondsPerOperation);
				differences.push(difference);
				overheads.push(overhead);
				processDifferences.push(difference);
				processOverheads.push(overhead);
			}
			processes.push({
				file: run.path,
				seed: run.seed,
				pairedNanosecondDifference: distribution(processDifferences),
				pairedPercentOverhead: distribution(processOverheads),
			});
		}
		/** A process-level range prevents many batches in one process from masquerading as many independent runs. */
		const processMedianOverheads = processes.map((process) => process.pairedPercentOverhead.median);
		rows.push({
			runtime,
			workload: workload.name,
			operation: workload.operation,
			actualSource: workload.actualSource,
			independentProcesses: processes.length,
			frozenNanosecondsPerOperation: distribution(frozen),
			plainNanosecondsPerOperation: distribution(plain),
			pairedNanosecondDifference: distribution(differences),
			pairedPercentOverhead: distribution(overheads),
			frozenOperationsPerSecond: distribution(
				frozen.map((value) => 1e9 / value),
			),
			plainOperationsPerSecond: distribution(plain.map((value) => 1e9 / value)),
			processMedianOverheadRange: [
				Math.min(...processMedianOverheads),
				Math.max(...processMedianOverheads),
			],
			/** This triage threshold is not a significance test or approval to change mutation guarantees. */
			allProcessMediansAboveFivePercent: processMedianOverheads.every((value) => value > 5),
			processes,
		});
	}
}

/** Save the interpretation rule together with the numbers so copied statistics retain their limits. */
const report = {
	inventorySha256,
	interpretation:
		'Positive difference means the frozen treatment took longer in this workload. Statistics describe synchronous batch averages, not per-request percentiles or Crawl throughput.',
	decisionRule:
		'Treat a freeze cost as repeatable and worth a source-path investigation when every independent process median exceeds +5%. This is a triage threshold, not a significance test or permission to weaken a public contract.',
	inputFiles: receipts,
	rows,
};
await writeFile(
	resolve(directory, 'summary.json'),
	JSON.stringify(report, null, 2) + '\n',
);

/** Use one precision rule throughout so relative costs are not mistaken for exact constants. */
function number(value) {
	return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}
/** Render median and interquartile range without implying per-request tail-latency percentiles. */
function interval(distribution) {
	return `${number(distribution.median)} [${number(distribution.lowerQuartile)}, ${
		number(distribution.upperQuartile)
	}]`;
}

/** Build the readable table from the same rows written to JSON so the two reports cannot drift. */
const lines = [
	'# Measured freeze costs',
	'',
	'Latency columns show median nanoseconds per operation and the interquartile range of batch averages. Positive paired overhead means the frozen variant took longer. Process range uses each fresh process median. Paired extra nanoseconds are the median within-pair difference; they need not equal the difference between column medians.',
	'',
	'| Runtime | Workload | Plain ns/op [IQR] | Frozen ns/op [IQR] | Paired extra ns | Paired overhead | Process median range |',
	'|---|---|---:|---:|---:|---:|---:|',
];
for (const row of rows) {
	lines.push(
		`| ${row.runtime} | ${row.workload} | ${interval(row.plainNanosecondsPerOperation)} | ${
			interval(row.frozenNanosecondsPerOperation)
		} | ${number(row.pairedNanosecondDifference.median)} | ${number(row.pairedPercentOverhead.median)}% | ${
			number(row.processMedianOverheadRange[0])
		}% to ${number(row.processMedianOverheadRange[1])}% |`,
	);
}
lines.push('', report.interpretation, '', report.decisionRule, '');
await writeFile(resolve(directory, 'RESULTS.md'), lines.join('\n'));
console.log(
	JSON.stringify({
		processes: runs.length,
		rows: rows.length,
		output: resolve(directory, 'summary.json'),
	}),
);
