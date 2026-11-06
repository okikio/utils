// @benchmark optional
/**
 * Native container HTTP round trips at 1, 8 and 32 original-authority calls.
 * Setup/bundling and Docker startup stay outside timings. These results include
 * the Docker port bridge but exclude TLS, SQL and a business storage workload.
 * Opt in explicitly; the ordinary benchmark inventory must not provision Docker.
 */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as context from '@okikio/context';
import * as duplex from '@okikio/activity/http/duplex';
import { run } from '#tools/bench/run.ts';
import { start } from '#fixtures/duplex/container.ts';
import { attempt, Engine, Work } from '#fixtures/duplex/contracts.ts';

await using host = await start();
await using owner = context.create({ id: 'duplex-container-bench' });
const provider = duplex.create({
	engine: Engine,
	activities: [Work],
	url: host.url,
	allowLoopbackHttp: true,
	headers: () => ({ authorization: `Bearer ${host.token}` }),
	timeoutMs: 15000,
});
const pid = (await host.metrics()).pid;
let next = 0;
/** Independent receipts prove the measured reverse calls reached this original authority. */
async function cycle(calls: number): Promise<number> {
	const id = `bench:${++next}`;
	let heartbeats = 0, permissions = 0, effects = 0;
	const result = await provider.run(owner, attempt(owner, { id, mode: 'authority', cleanup: 'automatic', calls }), {
		async heartbeat(value) {
			const receipt = value as { id: string; index: number };
			strictEqual(receipt.id, id);
			strictEqual(receipt.index, heartbeats++);
		},
		permission: {
			maximumChecks: 8,
			async check(_ctx, requests) {
				strictEqual(requests.length, 1);
				strictEqual(requests[0]!.target, id);
				permissions++;
				return [{ allowed: true }];
			},
		},
		effect: {
			async emit(_ctx, value) {
				strictEqual((value.value as { id: string }).id, id);
				effects++;
			},
		},
	});
	if (result.type === 'lost') throw result.reason;
	strictEqual(result.type, 'success');
	if (result.type === 'success') {
		const value = result.value as { id: string; pid: number };
		strictEqual(value.id, id);
		strictEqual(value.pid, pid);
	}
	strictEqual(heartbeats, calls);
	strictEqual(permissions, 1);
	strictEqual(effects, 1);
	return heartbeats + permissions + effects;
}
for (const calls of [1, 8, 32]) {
	strictEqual(await cycle(calls), calls + 2);
	group(`native container: ${calls} heartbeats + permission + effect`, () => {
		bench('paired HTTP reverse calls and joined activity cleanup', async () => do_not_optimize(await cycle(calls)));
	});
}
await run();
