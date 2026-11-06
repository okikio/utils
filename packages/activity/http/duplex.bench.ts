/**
 * Measure real loopback session/control round trips and joined cancellation.
 * Listener setup stays outside timings. No TLS or business storage is measured.
 * The direct-control baseline omits HTTP, serialization and session ownership.
 */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import type { ActivityAttemptType, EngineProvider } from '@okikio/workflow';
import * as activity from '../mod.ts';
import * as engine from '../engine.ts';
import * as duplex from './duplex.ts';
import { listen } from '../fixtures/http.ts';
import { run } from '../fixtures/bench.ts';

const Engine = engine.define({ id: 'duplex.bench' });
const Ping = activity.define({
	id: 'duplex.ping',
	version: '1',
	input: codec.identity(schema.number()),
	result: codec.identity(schema.number()),
	placement: engine.require(Engine),
});
await using owner = context.create({ id: 'duplex-benchmark' });
let counter = 0;
/** Each operation gets a fresh claim; this benchmark never asks a transport to replay a claim. */
function attempt(count: number): ActivityAttemptType {
	return {
		jobId: `job:${++counter}`,
		claimId: `claim:${counter}`,
		attempt: 1,
		generation: 1,
		activityId: Ping.id,
		activityVersion: Ping.version,
		engineId: Engine.id,
		registrationId: 'bench',
		hostId: 'bench',
		admitted: true,
		origin: {
			workflowId: 'bench',
			workflowVersion: '1',
			runId: 'run',
			instructionPath: '0',
			instructionFingerprint: 'bench',
		},
		context: context.snapshot(owner),
		input: count,
	};
}
const provider: EngineProvider = {
	activities: [Ping],
	async run(ctx, value, control) {
		if (value.input === -1) {
			await control.heartbeat();
			if (!ctx.signal.aborted) {
				await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
			}
			return { type: 'cancelled', reason: 'benchmark cancelled' };
		}
		for (let index = 0; index < Number(value.input); index++) await control.heartbeat(index);
		return { type: 'success', value: Number(value.input) };
	},
};
const host = duplex.handler({
	provider,
	activities: [Ping],
	authenticate: (request) => request.headers.get('authorization') === 'Bearer bench',
	authorize: () => true,
});
await using server = await listen(host);
const remote = duplex.create({
	engine: Engine,
	activities: [Ping],
	url: server.url,
	headers: () => ({ authorization: 'Bearer bench' }),
	allowLoopbackHttp: true,
});

/** Count original-authority receipts independently from server output. */
async function cycle(count: number, transported: boolean): Promise<number> {
	let receipts = 0;
	const control = {
		async heartbeat() {
			receipts++;
		},
	};
	const result = await (transported ? remote : provider).run(owner, attempt(count), control);
	if (result.type === 'lost') throw result.reason;
	strictEqual(result.type, 'success');
	if (result.type === 'success') strictEqual(result.value, count);
	strictEqual(receipts, count);
	return receipts;
}
/** The first actual reverse call triggers cancellation; the terminal result proves host cleanup joined. */
async function cancellation(): Promise<string> {
	const controller = new AbortController();
	await using ctx = context.child(owner, { signal: controller.signal });
	const result = await remote.run(ctx, attempt(-1), {
		async heartbeat() {
			controller.abort('stop');
		},
	});
	strictEqual(result.type, 'cancelled');
	return result.type;
}
for (const count of [1, 8]) {
	strictEqual(await cycle(count, true), count);
	strictEqual(await cycle(count, false), count);
	group(`duplex HTTP ${count} acknowledged original-authority calls`, () => {
		bench('real loopback session and reverse replies', async () => do_not_optimize(await cycle(count, true)));
		bench('direct provider control; no HTTP guarantees', async () => do_not_optimize(await cycle(count, false)));
	});
}
strictEqual(await cancellation(), 'cancelled');
group('duplex HTTP joined cancellation', () => {
	bench(
		'real reverse-call trigger, cancel POST and cleanup terminal',
		async () => do_not_optimize(await cancellation()),
	);
});
try {
	await run();
} finally {
	await host.close();
}
