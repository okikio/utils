/** Read-only evidence and explicit application remain distinct measured contracts. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as context from '@okikio/context';
import * as requirement from '@okikio/capability/requirement';
import * as resilience from '@okikio/capability/resilience';
await using owner = context.create({ id: 'policy-benchmark' });
const ctx = requirement.scope(owner, { interpreters: { feature: { async apply() {} } } });
for (const count of [1, 100, 1000]) {
	const entries = Array.from(
		{ length: count },
		(_, index) =>
			requirement.define({ family: 'feature', action: 'require', definition: { kind: 'feature', id: String(index) } }),
	);
	const report = await requirement.explain(ctx, entries, { maximumRequirements: count, mode: 'inspect' });
	if (report.length !== 1 || report[0]!.requirements.length !== count || report[0]!.outcome !== 'configured') {
		throw new Error('Requirement explanation oracle failed.');
	}
	group(`requirement evidence ${count} declarations, one configured family`, () => {
		bench(
			'inspect without evaluator',
			async () =>
				do_not_optimize(await requirement.explain(ctx, entries, { maximumRequirements: count, mode: 'inspect' })),
		);
		bench(
			'explicit apply-mode explanation',
			async () =>
				do_not_optimize(await requirement.explain(ctx, entries, { maximumRequirements: count, mode: 'apply' })),
		);
		bench(
			'ordinary apply reference without report',
			async () => do_not_optimize(await requirement.apply(ctx, entries)),
		);
	});
}
const policies = [resilience.timeout({ seconds: 1 }), resilience.retry({ jitter: false })];
const claims = [{ type: 'timeout', owner: 'server', id: 'request' }, {
	type: 'retry',
	owner: 'adapter',
	id: 'provider',
}] as const;
const evidence = resilience.inspect(policies, claims, { maximumPolicies: 2, maximumOwners: 2, safety: 'safe' });
if (!evidence.valid || evidence.policies.some((policy) => policy.outcome !== 'claimed')) {
	throw new Error('Enforcement evidence oracle failed.');
}
group('declared resilience versus deployment ownership', () => {
	bench(
		'validation and owner-claim comparison',
		() =>
			do_not_optimize(resilience.inspect(policies, claims, { maximumPolicies: 2, maximumOwners: 2, safety: 'safe' })),
	);
	bench(
		'existing validation reference without owner claims',
		() => do_not_optimize(resilience.validate(policies, { safety: 'safe' })),
	);
});
await run();
