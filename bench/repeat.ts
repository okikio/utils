/** Counterbalance six isolated parity measurements using the canonical report runner. @module */
import { compare, complete } from './compare.ts';
import { validateMitata } from './validate.ts';

const output = Deno.args[0] ?? `.artifacts/comparison/${new Date().toISOString().replaceAll(':', '-')}`;
await Deno.mkdir(output, { recursive: true });
let inputIdentity: string | undefined;
const rows = new Map<string, { utils: number[]; hono: number[] }>();
for (let trial = 0; trial < 6; trial += 1) {
	const directory = `${output}/trial-${trial}`;
	const args = [
		'run',
		'-A',
		new URL('./measure.ts', import.meta.url).href,
		directory,
		'--program=./http-parity.bench.ts',
		...(trial % 2 ? ['--reverse'] : []),
	];
	const result = await new Deno.Command(Deno.execPath(), { args, stdout: 'inherit', stderr: 'inherit' }).spawn().status;
	if (!result.success) throw new Error(`Comparison trial ${trial} failed.`);
	const metadata = JSON.parse(await Deno.readTextFile(`${directory}/meta.json`)) as {
		status: string;
		inputs: Record<string, string>;
	};
	const identity = JSON.stringify(metadata.inputs);
	if (metadata.status !== 'pass' || (inputIdentity !== undefined && inputIdentity !== identity)) {
		throw new Error('Comparison inputs changed between trials. Discard timings.');
	}
	inputIdentity = identity;
	const report: unknown = JSON.parse(await Deno.readTextFile(`${directory}/0.json`));
	validateMitata(report);
	const benchmarks = (report as { benchmarks: { alias: string; runs: { stats: { avg: number } }[] }[] }).benchmarks;
	complete(benchmarks.flatMap((benchmark) => benchmark.runs.map(() => benchmark.alias)));
	const seen = new Set<string>();
	for (const benchmark of benchmarks) {
		for (const run of benchmark.runs) {
			const match = /^(Utils|Hono): (.+)$/u.exec(benchmark.alias);
			if (!match || seen.has(benchmark.alias)) throw new Error('Unexpected or duplicate parity measurement.');
			seen.add(benchmark.alias);
			const workload = match[2]!, row = rows.get(workload) ?? { utils: [], hono: [] };
			rows.set(workload, row);
			const values = match[1] === 'Utils' ? row.utils : row.hono;
			if (values.length !== trial) throw new Error('Parity workload missing from an earlier trial.');
			values.push(run.stats.avg);
		}
	}
}
const comparisons = [...rows].map(([name, row]) => compare(name, row.utils, row.hono));
if (comparisons.length === 0) throw new Error('No parity measurements to compare.');
await Deno.writeTextFile(
	`${output}/comparison.json`,
	`${
		JSON.stringify(
			{
				method:
					'Six fresh processes; alternating registration order; paired log mean-time ratios with 95% t intervals, df=5.',
				limits:
					'Approximate independent log-normal trial model, shared capped host. CI containing one is inconclusive, not equivalence. No timing gate.',
				comparisons,
			},
			null,
			2,
		)
	}\n`,
);
console.log(`Saved paired uncertainty in ${output}/comparison.json.`);
