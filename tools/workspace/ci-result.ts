/** Require observed success for every selected lane without installing application dependencies. @module */

/** GitHub aggregates every matrix child into one job result. */
interface JobResult {
	/** Only success proves that selected work completed. */
	readonly result: string;
	/** The planner exposes explicit booleans for every owned lane. */
	readonly outputs?: Readonly<Record<string, string>>;
}

/** These names match the plan and required workflow jobs, excluding advisory feedback. */
const Lanes = ['source', 'runtimes', 'browser', 'packages', 'postgres', 'containers', 'benchmark', 'docs', 'examples'];

/**
 * A selected stack top must finish its own combined candidate checks.
 * Lower layers skip this aggregate in YAML; they cannot supply a successful
 * aggregate for a failed top. Missing or skipped selected work fails closed.
 */
export function requireSelectedResults(jobs: Readonly<Record<string, JobResult>>): void {
	if (jobs.plan?.result !== 'success' || jobs.plan.outputs?.selected !== 'true') {
		throw new Error('A successful selected plan is required.');
	}
	const deferred: unknown = JSON.parse(jobs.plan.outputs.deferred ?? '[]');
	if (
		!Array.isArray(deferred) ||
		deferred.some((lane) => !['runtimes', 'packages', 'postgres', 'containers', 'docs'].includes(lane))
	) {
		throw new Error('Invalid automatic PR deferrals.');
	}
	for (const lane of Lanes) {
		const selected = jobs.plan.outputs[lane];
		if (selected !== 'true' && selected !== 'false') throw new Error(`Missing ${lane} selection.`);
		if (deferred.includes(lane) && selected !== 'false') throw new Error(`${lane} cannot be selected and deferred.`);
		const result = jobs[lane]?.result;
		if (selected === 'true' ? result !== 'success' : !['success', 'skipped'].includes(result ?? '')) {
			throw new Error(
				`${lane}: expected ${selected === 'true' ? 'success' : 'success or skipped'}, received ${result}.`,
			);
		}
	}
	if (deferred.length) {
		console.log(`Not executed on this automatic PR: ${deferred.join(', ')}. Dispatch CI for complete checks.`);
	}
}

if (import.meta.main) {
	requireSelectedResults(JSON.parse(process.env.RESULTS ?? '{}'));
}
