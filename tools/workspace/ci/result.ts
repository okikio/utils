/** Require observed success for every selected lane without installing application dependencies. @module */

/** GitHub aggregates every matrix child into one job result. */
interface JobResult {
	/** Only success proves that selected work completed. */
	readonly result: string;
	/** The planner exposes explicit booleans for every owned lane. */
	readonly outputs?: Readonly<Record<string, string>>;
}

/** These selection names remain independent even when two lanes share a hosted job. */
const Lanes = [
	'source',
	'runtimes',
	'browser',
	'packages',
	'postgres',
	'containers',
	'interop',
	'benchmark',
	'docs',
	'examples',
];

/**
 * A selected stack top must finish its own combined candidate checks.
 * Lower layers skip this aggregate in YAML; they cannot supply a successful
 * aggregate for a failed top. Missing or skipped selected work fails closed.
 */
export function requireSelectedResults(jobs: Readonly<Record<string, JobResult>>): void {
	if (jobs.plan?.result !== 'success' || jobs.plan.outputs?.selected !== 'true') {
		throw new Error('A successful selected plan is required.');
	}
	for (const lane of Lanes) {
		const selected = jobs.plan.outputs[lane];
		if (selected !== 'true' && selected !== 'false') throw new Error(`Missing ${lane} selection.`);
		if (lane === 'interop' && selected === 'true') {
			requireInterop(jobs);
			continue;
		}
		// The benchmark job executes both pure lanes. One failed step fails the shared job.
		const job = lane === 'examples' ? 'benchmark' : lane;
		const result = jobs[job]?.result;
		if (selected === 'true' ? result !== 'success' : !['success', 'skipped'].includes(result ?? '')) {
			throw new Error(
				`${lane}: expected ${selected === 'true' ? 'success' : 'success or skipped'}, received ${result}.`,
			);
		}
	}
}

/**
 * The interoperability plan runs a job per target only for cells no earlier run passed. When every cell passed before,
 * the shard job is deliberately skipped; otherwise it must succeed.
 */
function requireInterop(jobs: Readonly<Record<string, JobResult>>): void {
	const plan = jobs['interop-plan'];
	if (plan?.result !== 'success') throw new Error(`interop: expected a successful plan, received ${plan?.result}.`);
	const run = plan.outputs?.run;
	if (run !== 'true' && run !== 'false') throw new Error('interop: the plan did not say whether to run.');
	const expected = run === 'true' ? 'success' : 'skipped';
	const result = jobs.interop?.result;
	if (result !== expected) throw new Error(`interop: expected ${expected}, received ${result}.`);
}

if (import.meta.main) {
	requireSelectedResults(JSON.parse(process.env.RESULTS ?? '{}'));
}
