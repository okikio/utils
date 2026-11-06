/** HTTP reverse heartbeat replies must reflect real PostgreSQL claim authority, not local liveness. */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import process from 'node:process';
import postgres from 'postgres';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as resource from '@okikio/capability/resource';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as local from '@okikio/activity/local';
import * as duplex from '@okikio/activity/http/duplex';
import * as adapter from '@okikio/storage/queue/postgres';
import type { ActivityAttemptType } from '@okikio/workflow';
import type { QueueClaim } from '@okikio/scheduler/queue';
import { listen } from '../../packages/activity/fixtures/http.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('HTTP control verification requires an explicitly disposable PostgreSQL database.');
const database = postgres(url, { max: 2, onnotice() {} });
const namespaces: string[] = [];
const Engine = engine.define({ id: 'http.sql' });
const Renew = activity.define({
	id: 'http.sql.renew',
	version: '1',
	input: codec.identity(schema.number()),
	result: codec.identity(schema.number()),
	placement: engine.require(Engine),
});

before(async () => {
	await adapter.migrate({ database });
});
after(async () => {
	try {
		for (const namespace of namespaces) {
			await database.begin(async (tx) => {
				await tx`delete from utils_queue.items where namespace=${namespace}`;
				await tx`delete from utils_queue.policies where namespace=${namespace}`;
			});
		}
	} finally {
		await database.end({ timeout: 2 });
	}
});

/** Preserve actual durable queue identity through the transport's complete fenced envelope. */
function attempt(ctx: context.Context, claim: QueueClaim<number>): ActivityAttemptType {
	return {
		jobId: claim.itemId,
		claimId: claim.id,
		attempt: claim.attempt,
		generation: 1,
		activityId: Renew.id,
		activityVersion: Renew.version,
		engineId: Engine.id,
		registrationId: 'http.sql.registration',
		hostId: 'http.sql.host',
		admitted: true,
		origin: {
			workflowId: 'http.sql.workflow',
			workflowVersion: '1',
			runId: 'http.sql.run',
			instructionPath: '0',
			instructionFingerprint: 'http.sql.fingerprint',
		},
		context: context.snapshot(ctx),
		input: claim.value,
	};
}

describe('duplex HTTP durable heartbeat authority', () => {
	for (const expired of [false, true]) {
		it(
			expired
				? 'rejects a heartbeat after the real claim expires'
				: 'acknowledges only after the real claim renewal commits',
			{ timeout: 15000 },
			async () => {
				const namespace = `http-control-${crypto.randomUUID()}`;
				namespaces.push(namespace);
				await using ctx = context.create({ id: namespace });
				await using work = adapter.open({
					database,
					namespace,
					contract: 'number.v1',
					input: schema.number(),
					output: schema.number(),
				});
				const ref = await work.add(ctx, 5);
				let claim = (await work.claim(ctx, { ref, duration: { milliseconds: expired ? 30 : 5000 } }))[0]!;
				const originalDeadline = claim.expiresAt.epochMilliseconds;
				if (expired) await database`select pg_sleep(0.05)`;
				await using resources = resource.create(resource.implementations(), { ctx, host: {} });
				const provider = local.create({
					engine: Engine,
					resources,
					implementations: [activity.implement(Renew, {
						async run(scope) {
							await scope.heartbeat({ stage: 'before-result' });
							return scope.input + 1;
						},
					})],
				});
				const accept = duplex.handler({
					provider,
					activities: [Renew],
					timeoutMs: 5000,
					authenticate: (request) => request.headers.get('authorization') === 'Bearer durable-fixture',
					// This fixture authenticates one exact Scheduler dispatch. Its heartbeat
					// still has to pass PostgreSQL's current, unexpired claim fence.
					authorize: (_request, value) =>
						value.claimId === claim.id && value.jobId === ref.id && value.generation === 1,
				});
				await using _route = {
					async [Symbol.asyncDispose]() {
						await accept.close();
					},
				};
				await using server = await listen(accept);
				const client = duplex.create({
					engine: Engine,
					activities: [Renew],
					url: server.url,
					allowLoopbackHttp: true,
					timeoutMs: 5000,
					headers: () => ({ authorization: 'Bearer durable-fixture' }),
				});
				let renewed = 0, rejected = 0;
				const result = await client.run(ctx, attempt(ctx, claim), {
					async heartbeat(value) {
						expect(value).toEqual({ stage: 'before-result' });
						try {
							claim = await work.renew(ctx, claim, { seconds: 10 });
							renewed++;
						} catch (error) {
							rejected++;
							throw error;
						}
					},
				});
				if (expired) {
					expect(result.type).toBe('fault');
					expect(renewed).toBe(0);
					expect(rejected).toBe(1);
					expect(claim.expiresAt.epochMilliseconds).toBe(originalDeadline);
				} else {
					expect(result).toEqual({ type: 'success', value: 6 });
					expect(renewed).toBe(1);
					expect(rejected).toBe(0);
					expect(claim.expiresAt.epochMilliseconds).toBeGreaterThan(originalDeadline + 4000);
					await work.complete(ctx, claim, 6);
					expect(await work.result(ctx, ref)).toBe(6);
				}
			},
		);
	}
});
