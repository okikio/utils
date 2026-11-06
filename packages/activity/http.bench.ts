/**
 * Measure unary handler authentication, bounded JSON and Context ownership costs.
 * These timings exclude sockets/TLS; the neighboring tests prove real HTTP I/O.
 * Direct provider calls intentionally omit those transport guarantees.
 */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import type { ActivityAttemptType, EngineProvider } from '@okikio/workflow';
import * as activity from './mod.ts';
import * as engine from './engine.ts';
import * as http from './http.ts';
import { run } from './fixtures/bench.ts';

const Engine = engine.define({ id: 'bench.http' });
const Add = activity.define({
	id: 'bench.http.add',
	version: '1',
	input: codec.identity(schema.number()),
	result: codec.identity(schema.number()),
	placement: engine.require(Engine),
});
await using owner = context.create({ id: 'http-benchmark' });
const control = {
	async heartbeat(): Promise<void> {
		throw new Error('No remote authority in this benchmark.');
	},
};
const attempt: ActivityAttemptType = {
	jobId: 'job',
	claimId: 'claim',
	attempt: 1,
	generation: 1,
	activityId: Add.id,
	activityVersion: Add.version,
	engineId: Engine.id,
	registrationId: 'registration',
	hostId: 'host',
	admitted: true,
	origin: {
		workflowId: 'workflow',
		workflowVersion: '1',
		runId: 'run',
		instructionPath: '0',
		instructionFingerprint: 'fingerprint',
	},
	context: context.snapshot(owner),
	input: 4,
};
const provider: EngineProvider = {
	activities: [Add],
	async run(_ctx, value) {
		return { type: 'success', value: Number(value.input) + 1 };
	},
};
const handle = http.handler({
	provider,
	activities: [Add],
	authenticate: (request) => request.headers.get('authorization') === 'Bearer benchmark',
	authorize: (_request, value) => value.claimId === 'claim',
});
const body = JSON.stringify(attempt);

/** Rebuild consumed Requests while retaining the same caller-owned fenced attempt. */
async function cycle(count: number, transported: boolean): Promise<number> {
	let sum = 0;
	for (let index = 0; index < count; index++) {
		if (transported) {
			const response = await handle(
				new Request('https://example.test/activity', {
					method: 'POST',
					body,
					headers: {
						authorization: 'Bearer benchmark',
						'content-type': 'application/json',
						'x-okikio-activity-version': '1',
					},
				}),
			);
			if (response.status !== 200) throw new Error(`Unexpected status ${response.status}.`);
			const value = await response.json() as { type: string; value: number };
			if (value.type !== 'success') throw new Error('Expected terminal success.');
			sum += value.value;
		} else {
			const value = await provider.run(owner, attempt, control);
			if (value.type !== 'success') throw new Error('Expected terminal success.');
			sum += Number(value.value);
		}
	}
	return sum;
}

for (const count of [1, 32]) {
	// An independent arithmetic oracle runs in --check mode as well as timing mode.
	strictEqual(await cycle(count, true), count * 5);
	strictEqual(await cycle(count, false), count * 5);
	group(`HTTP activity handler ${count} sequential attempts (no sockets)`, () => {
		bench(
			'authenticated handler with JSON and Context disposal',
			async () => do_not_optimize(await cycle(count, true)),
		);
		bench('direct provider without transport guarantees', async () => do_not_optimize(await cycle(count, false)));
	});
}
await run();
