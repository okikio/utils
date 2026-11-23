/** Lower stack layers and failed combined candidates must never become passing required checks. */
import { it } from 'node:test';
import { expect } from '@std/expect';
import { requireSelectedResults } from './ci-result.ts';

/** A documentation-only plan deliberately leaves every resource lane unselected. */
function documentation() {
	const lanes = [
		'source',
		'runtimes',
		'browser',
		'packages',
		'postgres',
		'containers',
		'benchmark',
		'docs',
		'examples',
	];
	return {
		plan: {
			result: 'success',
			outputs: { selected: 'true', ...Object.fromEntries(lanes.map((lane) => [lane, String(lane === 'docs')])) },
		},
		...Object.fromEntries(lanes.map((lane) => [lane, { result: lane === 'docs' ? 'success' : 'skipped' }])),
	};
}

it('accepts actual selected success and deliberate unselected skips', () => {
	expect(() => requireSelectedResults(documentation())).not.toThrow();
});

it('rejects failed, cancelled, skipped or missing selected work on the top candidate', () => {
	for (const result of ['failure', 'cancelled', 'skipped', '']) {
		expect(() => requireSelectedResults({ ...documentation(), docs: { result } })).toThrow();
	}
	const missing = Object.fromEntries(Object.entries(documentation()).filter(([name]) => name !== 'docs'));
	expect(() => requireSelectedResults(missing)).toThrow();
});

it('cannot turn a lower layer or an unsuccessful plan into top-candidate success', () => {
	const jobs = documentation();
	expect(() =>
		requireSelectedResults({ ...jobs, plan: { ...jobs.plan, outputs: { ...jobs.plan.outputs, selected: 'false' } } })
	).toThrow();
	expect(() => requireSelectedResults({ ...jobs, plan: { ...jobs.plan, result: 'failure' } })).toThrow();
	expect(() => requireSelectedResults({ ...jobs, plan: { result: 'success' } })).toThrow();
});

/** The two inexpensive pure selections must both be represented by one observed job. */
it('requires the shared benchmark/examples job for either or both selected lanes', () => {
	for (const [benchmark, examples] of [[true, false], [false, true], [true, true]]) {
		const jobs = documentation();
		const plan = {
			...jobs.plan,
			outputs: { ...jobs.plan.outputs, benchmark: String(benchmark), examples: String(examples) },
		};
		const shared = { ...jobs, plan, benchmark: { result: 'success' } };
		expect(() => requireSelectedResults(shared)).not.toThrow();
		for (const result of ['failure', 'cancelled', 'skipped', '']) {
			expect(() => requireSelectedResults({ ...shared, benchmark: { result } })).toThrow();
		}
		const missing = Object.fromEntries(Object.entries(shared).filter(([name]) => name !== 'benchmark'));
		expect(() => requireSelectedResults(missing)).toThrow();
	}
});
