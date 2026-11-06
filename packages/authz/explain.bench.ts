/** Denied-expression cost scales with evidence size; a boolean check returns less information. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as permission from './permission/mod.ts';
import * as context from '@okikio/context';
await using owner = context.create({ id: 'permission-explain', clock: new context.TestClock() });
for (const count of [10, 100, 1000]) {
	const Check = permission.define({ id: `bench.explain.${count}` });
	const scope = permission.scope(owner, {
		permissions: [Check],
		checker: {
			maximumChecks: count,
			async check(_ctx, requests) {
				return requests.map(() => ({ allowed: false, reason: 'policy' }));
			},
		},
	});
	const expression = permission.all(...Array.from({ length: count }, () => Check));
	const limits = { maximumNodes: count + 1, maximumDepth: 2, details: false, maximumDetailCodeUnits: 0 };
	const report = await permission.explain(scope, expression, limits);
	if (report.outcome !== 'denied' || report.children?.length !== count || await permission.check(scope, expression)) {
		throw new Error('Permission explanation disagrees with denial oracle.');
	}
	group(`permission explanation ${count} denied leaves`, () => {
		bench('ordinary check, boolean result', async () => do_not_optimize(await permission.check(scope, expression)));
		bench(
			'bounded redacted explanation',
			async () => do_not_optimize(await permission.explain(scope, expression, limits)),
		);
	});
}
await run();
