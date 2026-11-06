import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
/** Local policy checks include validation; the direct predicate is a lower-cost reference without that contract. */
import * as permission from './permission/mod.ts';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
const Read = permission.define({ id: 'bench.read', target: schema.object({ id: schema.number() }) });
await using owner = context.create({ id: 'authz-bench', clock: new context.TestClock() });
const scope = permission.scope(owner, {
	permissions: [Read],
	checker: {
		maximumChecks: 10000,
		async check(_ctx, requests) {
			return requests.map((request) => ({ allowed: permission.matches(request, Read) && request.target.id % 2 === 0 }));
		},
	},
});
for (const count of [1, 32, 256]) {
	const targets = Array.from({ length: count }, (_, id) => ({ id }));
	const expected = Math.ceil(count / 2);
	const checks = async function (verify = false): Promise<number> {
		let accepted = 0;
		const decisions: boolean[] | undefined = verify ? [] : undefined;
		for (const target of targets) {
			const allowed = await permission.check(scope, Read, target);
			if (allowed) accepted++;
			decisions?.push(allowed);
		}
		if (verify) deepStrictEqual(decisions, targets.map((target) => target.id % 2 === 0));
		return accepted;
	};
	strictEqual(await checks(true), expected);
	group(`authorization ${count} alternating accept/deny`, () => {
		bench('validated local permission checks', async () => do_not_optimize(await checks()));
		bench(
			'predicate only: no validation, scope or evidence',
			() => do_not_optimize(targets.filter((target) => target.id % 2 === 0).length),
		);
	});
}
await run();
