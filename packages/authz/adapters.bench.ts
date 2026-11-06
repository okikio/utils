/** Static grant indexing and bounded explanation cost retain application policy calls. @module */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as context from '@okikio/context';
import { entitlement, permission, role } from './mod.ts';

await using owner = context.create({ id: 'adapters', clock: new context.TestClock() });
for (const count of [10, 1000]) {
	const grants = Array.from({ length: count }, (_, index) => permission.define({ id: `read.${index}` }));
	const Member = role.define({ id: 'member', permissions: grants });
	const checker = role.checker([Member], {
		maximumRoles: 1,
		maximumGrants: count,
		maximumChecks: 1,
		policy: (_ctx, request) => ({ allowed: request.target === undefined }),
	});
	const request = { definition: grants[count - 1]!, target: undefined };
	const answer = (await checker.check(owner, [request]))[0]!;
	strictEqual('allowed' in answer && answer.allowed, true);
	group(`static role ${count} exact grants`, () => {
		bench('reused grant index and target policy', async () => do_not_optimize(await checker.check(owner, [request])));
		bench(
			'authored linear lookup and target policy; no contract checks',
			() => do_not_optimize(Member.permissions.includes(request.definition) && request.target === undefined),
		);
	});
	const definitions = Array.from({ length: count }, (_, index) => entitlement.define({ id: `feature.${index}` }));
	const requirements = definitions.map(entitlement.require);
	const provider = {
		maximumChecks: count,
		async check() {
			return definitions.map(() => ({ allowed: false as const, reason: 'plan excludes feature' }));
		},
	};
	const options = { maximumChecks: count, maximumReasonLength: 16, details: true };
	strictEqual((await entitlement.explain(owner, provider, requirements, options)).status, 'denied');
	group(`entitlement ${count} ordered denials`, () => {
		bench(
			'bounded immutable explanation',
			async () => do_not_optimize(await entitlement.explain(owner, provider, requirements, options)),
		);
		bench('provider answers alone; no validation or report', async () => do_not_optimize(await provider.check()));
	});
}
await run();
