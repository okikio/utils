// @benchmark optional
/**
 * Measure cold native Fetch callers through a trusted TLS nginx edge to a real container.
 * Certificate generation and container startup are outside timing. Each iteration includes
 * caller process startup, TLS connection setup, original authority round trips and joined cleanup.
 * This is not comparable to the warm socket-only benchmark and sets no latency threshold.
 */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '#tools/bench/run.ts';
import { open } from '#fixtures/duplex/proxy.ts';
import { call } from '#fixtures/duplex/caller.ts';
import { until } from '../tests/workflows/fixtures/evidence.ts';

await using edge = await open();
const pid = (await edge.host.metrics()).pid;
let sequence = 0;
/** Exact independent receipts prevent timing a rejected handshake or an incomplete authority exchange. */
async function cycle(calls: number): Promise<number> {
	const id = `tls-bench:${++sequence}`;
	await using caller = call({
		url: `${edge.origin}/attempt`,
		ca: edge.ca,
		token: edge.host.token,
		input: { id, mode: 'authority', cleanup: 'automatic', calls },
	});
	const receipt = (await caller.done).find((value) => value.type === 'result')!;
	strictEqual(receipt.result?.type, 'success', receipt.diagnostic ?? 'TLS activity failed');
	deepStrictEqual(receipt.result?.value, { id, pid });
	deepStrictEqual(receipt.receipts, {
		heartbeats: Array.from({ length: calls }, (_, index) => ({ id, index })),
		permissions: [id],
		effects: [{ id }],
	});
	return calls + 2;
}
/** Include dispatch, observation, explicit cancellation and the provider's real cleanup receipt. */
async function cancel(): Promise<string> {
	const id = `tls-cancel:${++sequence}`;
	await using caller = call({
		url: `${edge.origin}/attempt`,
		ca: edge.ca,
		token: edge.host.token,
		input: { id, mode: 'wait', cleanup: 'automatic' },
	});
	await until(async () => (await edge.host.metrics()).waiting.includes(id), 'TLS benchmark provider waiting', 12000);
	await caller.cancel();
	const result = (await caller.done).find((value) => value.type === 'result')!;
	strictEqual(result.result?.type, 'cancelled', result.diagnostic ?? 'TLS cancellation failed');
	return result.result!.type;
}
for (const calls of [1, 8, 32]) {
	strictEqual(await cycle(calls), calls + 2);
	group(`trusted TLS edge: ${calls} heartbeats + permission + effect`, () => {
		bench('cold native caller, TLS and proxied activity', async () => do_not_optimize(await cycle(calls)));
	});
}
await cancel();
group('trusted TLS edge: cancel and join', () => {
	bench('cold caller, dispatch, cancel and cleanup', async () => do_not_optimize(await cancel()));
});
await run();
const metrics = await edge.host.metrics();
strictEqual(metrics.active.length, 0);
strictEqual(metrics.started.length, metrics.closed.length);
