/** Reverse-call authority and joined cancellation are exercised through real sockets. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as effect from '@okikio/capability/effect';
import * as permissions from '@okikio/authz/permission';
import * as resource from '@okikio/capability/resource';
import * as json from '@okikio/streams/json';
import type { ActivityAttemptControl, ActivityAttemptType, EngineProvider } from '@okikio/workflow';
import * as activity from '../mod.ts';
import * as engine from '../engine.ts';
import * as local from '../local.ts';
import * as duplex from './duplex.ts';
import { listen } from '../fixtures/http.ts';

const Engine = engine.define({ id: 'duplex.test' });
const Write = permissions.define({ id: 'duplex.write', target: schema.string() });
const Stored = effect.define({ id: 'duplex.stored', value: codec.identity(schema.string()) });
const Save = activity.define({
	id: 'duplex.save',
	version: '1',
	input: codec.identity(schema.string()),
	result: codec.identity(schema.string()),
	placement: engine.require(Engine),
	requirements: [permissions.require(Write)],
	effects: [Stored],
});
const credentials = { authorization: 'Bearer duplex-test' };
const authenticate = (request: Request) => request.headers.get('authorization') === credentials.authorization;
const authorize = (_request: Request, value: ActivityAttemptType) =>
	value.claimId === 'claim' && value.generation === 1;
const noop: ActivityAttemptControl = { async heartbeat() {} };

/** An actual Scheduler-shaped fence, including the durable origin identity. */
function attempt(ctx: context.Context): ActivityAttemptType {
	return {
		jobId: 'job',
		claimId: 'claim',
		attempt: 1,
		generation: 1,
		activityId: Save.id,
		activityVersion: Save.version,
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
		context: context.snapshot(ctx),
		input: 'saved',
	};
}
/** Deferred ownership transitions keep races deterministic without sleeping. */
function gate() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function client(url: string, options: duplex.Options = {}) {
	return duplex.create({
		engine: Engine,
		activities: [Save],
		url,
		headers: () => credentials,
		allowLoopbackHttp: true,
		...options,
	});
}
function provider(run: EngineProvider['run']): EngineProvider {
	return { activities: [Save], run };
}

/** Raw control messages test replay protection independently of the client implementation. */
function request(value: unknown, operation: string) {
	return new Request('https://example.test/attempt', {
		method: 'POST',
		body: JSON.stringify(value),
		headers: {
			...credentials,
			'content-type': 'application/json',
			'x-okikio-activity-version': '2',
			'x-okikio-activity-operation': operation,
		},
	});
}

describe('duplex HTTP activity authority', () => {
	it('awaits the original heartbeat and delegates permission/effect to caller authority', async () => {
		const entered = gate();
		const renewed = gate();
		const heartbeats: unknown[] = [];
		const targets: unknown[] = [];
		const effects: unknown[] = [];
		let localPermission = 0;
		await using ctx = context.create({ id: 'duplex-authority' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const live = activity.implement(Save, {
			async run(ctx) {
				await ctx.heartbeat('renew');
				await permissions.assert(ctx, Write, ctx.input);
				await effect.emit(ctx, Stored, ctx.input, { key: 'saved-once' });
				return ctx.input;
			},
		});
		const localProvider = local.create({
			engine: Engine,
			implementations: [live],
			resources,
			permission: {
				maximumChecks: 10,
				async check(_ctx, requests) {
					localPermission++;
					return requests.map(() => ({ allowed: false }));
				},
			},
		});
		const host = duplex.handler({ provider: localProvider, activities: [Save], authenticate, authorize });
		await using server = await listen(host);
		const control: ActivityAttemptControl = {
			async heartbeat(value) {
				heartbeats.push(value);
				entered.resolve();
				await renewed.promise;
			},
			permission: {
				maximumChecks: 10,
				async check(_ctx, requests) {
					targets.push(...requests.map((value) => value.target));
					return requests.map(() => ({ allowed: true }));
				},
			},
			effect: {
				async emit(_ctx, value) {
					effects.push(value.value);
				},
			},
		};
		const pending = client(server.url).run(ctx, attempt(ctx), control);
		await entered.promise;
		expect(targets).toEqual([]);
		renewed.resolve();
		expect(await pending).toEqual({ type: 'success', value: 'saved' });
		expect(heartbeats).toEqual(['renew']);
		expect(targets).toEqual(['saved']);
		expect(effects).toEqual(['saved']);
		expect(localPermission).toBe(0);
		await host.close();
	});

	it('waits for provider cleanup before cancellation becomes terminal', async () => {
		const entered = gate();
		const stopped = gate();
		const cleanup = gate();
		const controller = new AbortController();
		await using ctx = context.create({ id: 'duplex-cancel', signal: controller.signal });
		const host = duplex.handler({
			provider: provider(async (host) => {
				entered.resolve();
				await new Promise<void>((resolve) => host.signal.addEventListener('abort', () => resolve(), { once: true }));
				stopped.resolve();
				await cleanup.promise;
				return { type: 'cancelled', reason: 'done' };
			}),
			activities: [Save],
			authenticate,
			authorize,
		});
		await using server = await listen(host);
		let returned = false;
		const pending = client(server.url).run(ctx, attempt(ctx), noop).then((value) => {
			returned = true;
			return value;
		});
		await entered.promise;
		controller.abort('stop');
		await stopped.promise;
		expect(returned).toBe(false);
		cleanup.resolve();
		expect((await pending).type).toBe('cancelled');
		await host.close();
	});

	for (const failure of ['returned fault', 'thrown fault', 'local activity cleanup'] as const) {
		it(`does not report successful cancellation after ${failure} fails`, async () => {
			const entered = gate();
			const stopped = new AbortController();
			const cleanupFailure = new Error('The resource could not close.');
			await using ctx = context.create({ id: `duplex-cleanup-${failure}`, signal: stopped.signal });
			await using resources = resource.create(resource.implementations(), { ctx, host: {} });
			const live = activity.implement(Save, {
				async run(scope) {
					scope.defer(() => {
						throw cleanupFailure;
					});
					entered.resolve();
					await new Promise<void>((resolve) => scope.signal.addEventListener('abort', () => resolve(), { once: true }));
					throw scope.signal.reason;
				},
			});
			const selected = failure === 'local activity cleanup'
				? local.create({ engine: Engine, implementations: [live], resources })
				: provider(async (scope) => {
					entered.resolve();
					await new Promise<void>((resolve) => scope.signal.addEventListener('abort', () => resolve(), { once: true }));
					if (failure === 'thrown fault') throw cleanupFailure;
					return { type: 'fault', fault: cleanupFailure };
				});
			const host = duplex.handler({ provider: selected, activities: [Save], authenticate, authorize });
			await using server = await listen(host);
			const pending = client(server.url).run(ctx, attempt(ctx), noop);
			await entered.promise;
			stopped.abort('stop');
			expect((await pending).type).toBe('lost');
			await host.close();
		});
	}

	for (
		const scenario of [
			{
				name: 'accepts a stale reply only after explicit cancellation and joined terminal cleanup',
				status: undefined,
				terminal: 'cancelled',
				expected: 'cancelled',
			},
			{
				name: 'keeps reply status 403 uncertain after acknowledged cancellation',
				status: 403,
				terminal: 'cancelled',
				expected: 'lost',
			},
			{
				name: 'keeps reply status 500 uncertain after acknowledged cancellation',
				status: 500,
				terminal: 'cancelled',
				expected: 'lost',
			},
			{
				name: 'does not discharge a cancelled stale reply with a successful terminal',
				status: undefined,
				terminal: 'success',
				expected: 'lost',
			},
			{
				name: 'does not discharge a cancelled stale reply when its terminal is missing',
				status: undefined,
				terminal: 'missing',
				expected: 'lost',
			},
		]
	) {
		it(
			scenario.name,
			async () => {
				const replyEntered = gate();
				const releaseReply = gate();
				const cancelAccepted = gate();
				const replyObserved = gate();
				const stopped = new AbortController();
				await using ctx = context.create({
					id: `duplex-reply-cancel-${scenario.terminal}-${scenario.status ?? 409}`,
					signal: stopped.signal,
				});
				const host = duplex.handler({
					provider: provider(async (_ctx, _attempt, control) => {
						await control.heartbeat('in-flight');
						return { type: 'success', value: 'saved' };
					}),
					activities: [Save],
					authenticate,
					authorize: async (request, value) => {
						if (request.headers.get('x-okikio-activity-operation') === 'reply') {
							replyEntered.resolve();
							await releaseReply.promise;
						}
						return authorize(request, value);
					},
				});
				let observedReply: number | undefined;
				await using server = await listen(async (request) => {
					const result = await host(request);
					const operation = request.headers.get('x-okikio-activity-operation');
					if (operation === 'cancel' && result.ok) cancelAccepted.resolve();
					if (operation === 'reply') {
						observedReply = result.status;
						replyObserved.resolve();
						if (scenario.status) return new Response(null, { status: scenario.status });
					}
					if (operation === 'start' && scenario.terminal !== 'cancelled') {
						// Deliberately corrupt only the terminal evidence. The real host still joins its cleanup.
						const frames = json.lines(result.body!, { maximumBytes: 10000, maximumLineBytes: 3000, maximumItems: 4 });
						const body = new ReadableStream<Uint8Array>({
							async start(controller) {
								try {
									for await (const value of frames) {
										const frame = value as Record<string, unknown>;
										if (frame.type === 'terminal') {
											if (scenario.terminal === 'missing') continue;
											controller.enqueue(json.encode({ ...frame, result: { type: 'success', value: 'saved' } }));
										} else controller.enqueue(json.encode(frame));
									}
									controller.close();
								} catch (error) {
									controller.error(error);
								}
							},
						});
						return new Response(body, { status: result.status, headers: result.headers });
					}
					return result;
				});
				let finished = false;
				const pending = client(server.url).run(ctx, attempt(ctx), noop).then((result) => {
					finished = true;
					return result;
				});
				try {
					await replyEntered.promise;
					stopped.abort('cancel while reply authorizes');
					await cancelAccepted.promise;
					// This joins actual session retirement while its independent reply POST remains blocked.
					await host.close();
					if (scenario.terminal !== 'missing') expect(finished).toBe(false);
				} finally {
					releaseReply.resolve();
				}
				expect((await pending).type).toBe(scenario.expected);
				await replyObserved.promise;
				expect(observedReply).toBe(409);
			},
		);
	}

	it('keeps a stale reply uncertain when no explicit cancellation was requested', async () => {
		await using ctx = context.create({ id: 'duplex-reply-stale' });
		const host = duplex.handler({
			provider: provider(async (_ctx, _attempt, control) => {
				await control.heartbeat();
				return { type: 'success', value: 'saved' };
			}),
			activities: [Save],
			authenticate,
			authorize,
		});
		await using server = await listen((request) =>
			request.headers.get('x-okikio-activity-operation') === 'reply'
				? Promise.resolve(new Response(null, { status: 409 }))
				: host(request)
		);
		expect((await client(server.url).run(ctx, attempt(ctx), noop)).type).toBe('lost');
		await host.close();
	});

	it('aborts and joins a physically disconnected response', async () => {
		const entered = gate();
		const cleaned = gate();
		await using ctx = context.create({ id: 'duplex-disconnect' });
		const host = duplex.handler({
			provider: provider(async (host) => {
				entered.resolve();
				await new Promise<void>((resolve) => host.signal.addEventListener('abort', () => resolve(), { once: true }));
				cleaned.resolve();
				return { type: 'cancelled', reason: 'disconnected' };
			}),
			activities: [Save],
			authenticate,
			authorize,
			cleanupMs: 50,
		});
		await using server = await listen(host);
		const response = await fetch(server.url, request(attempt(ctx), 'start'));
		const reader = response.body!.getReader();
		await reader.read();
		await entered.promise;
		await reader.cancel();
		await cleaned.promise;
		await host.close();
	});

	it('expires an unanswered original heartbeat and releases joined host work', async () => {
		await using ctx = context.create({ id: 'duplex-timeout' });
		const waiting = gate();
		const host = duplex.handler({
			provider: provider(async (_ctx, _attempt, control) => {
				await control.heartbeat();
				return { type: 'success', value: 'saved' };
			}),
			activities: [Save],
			authenticate,
			authorize,
			timeoutMs: 100,
		});
		await using server = await listen(host);
		const result = await client(server.url, { timeoutMs: 1000 }).run(ctx, attempt(ctx), {
			async heartbeat() {
				await waiting.promise;
			},
		});
		expect(result.type).toBe('lost');
		waiting.resolve();
		await host.close();
	});

	it('rejects stale, cross-attempt, duplicate, wrong-type and unauthorized replies', async () => {
		await using ctx = context.create({ id: 'duplex-fences' });
		let authorizeControls = true;
		const host = duplex.handler({
			provider: provider(async (_ctx, _attempt, control) => {
				await control.heartbeat();
				return { type: 'success', value: 'saved' };
			}),
			activities: [Save],
			authenticate,
			authorize: (request, attempt) =>
				authorize(request, attempt) &&
				(request.headers.get('x-okikio-activity-operation') === 'start' || authorizeControls),
		});
		const response = await host(request(attempt(ctx), 'start'));
		const frames = json.lines(response.body!, { maximumBytes: 10000, maximumLineBytes: 3000, maximumItems: 4 })
			[Symbol.asyncIterator]();
		const hello = (await frames.next()).value as Record<string, unknown>;
		const call = (await frames.next()).value as Record<string, unknown>;
		const reply = {
			type: 'reply',
			session: hello.session,
			claimId: hello.claimId,
			generation: hello.generation,
			callId: call.callId,
			reply: { type: 'heartbeat', accepted: true },
		};
		expect((await host(request({ ...reply, generation: 2 }, 'reply'))).status).toBe(409);
		expect((await host(request({ ...reply, claimId: 'other' }, 'reply'))).status).toBe(409);
		expect((await host(request({ ...reply, reply: { type: 'effect', accepted: true } }, 'reply'))).status).toBe(400);
		authorizeControls = false;
		expect((await host(request(reply, 'reply'))).status).toBe(403);
		authorizeControls = true;
		expect((await host(request(reply, 'reply'))).status).toBe(204);
		expect((await host(request(reply, 'reply'))).status).toBe(409);
		expect((await frames.next()).value).toMatchObject({ type: 'terminal' });
		await frames.next();
		await host.close();
		expect((await host(request(reply, 'reply'))).status).toBe(503);
	});

	it('holds terminal success behind a fire-and-forget authority call', async () => {
		const entered = gate();
		const released = gate();
		await using ctx = context.create({ id: 'duplex-terminal-barrier' });
		const host = duplex.handler({
			provider: provider(async (_ctx, _attempt, control) => {
				void control.heartbeat('started');
				return { type: 'success', value: 'saved' };
			}),
			activities: [Save],
			authenticate,
			authorize,
		});
		await using server = await listen(host);
		let finished = false;
		const pending = client(server.url).run(ctx, attempt(ctx), {
			async heartbeat() {
				entered.resolve();
				await released.promise;
			},
		}).then((value) => {
			finished = true;
			return value;
		});
		await entered.promise;
		expect(finished).toBe(false);
		released.resolve();
		expect(await pending).toEqual({ type: 'success', value: 'saved' });
		await host.close();
	});

	it('reports a detached authority call that rejects with undefined as a fault', async () => {
		await using ctx = context.create({ id: 'duplex-undefined-control-failure' });
		const host = duplex.handler({
			provider: provider(async (_ctx, _attempt, control) => {
				// Serialization can reject before the reverse call reaches the caller.
				void control.heartbeat({
					toJSON() {
						throw undefined;
					},
				});
				return { type: 'success', value: 'saved' };
			}),
			activities: [Save],
			authenticate,
			authorize,
		});
		await using server = await listen(host);
		try {
			const result = await client(server.url).run(ctx, attempt(ctx), noop);
			expect(result.type).toBe('fault');
			expect(ctx.signal.aborted).toBe(false);
		} finally {
			await host.close();
		}
	});

	it('retains admission after caller cleanup timeout until provider cleanup actually joins', async () => {
		const entered = gate();
		const stopped = gate();
		const cleanup = gate();
		const controller = new AbortController();
		await using ctx = context.create({ id: 'duplex-slow-cleanup', signal: controller.signal });
		const host = duplex.handler({
			provider: provider(async (host) => {
				entered.resolve();
				await new Promise<void>((resolve) => host.signal.addEventListener('abort', () => resolve(), { once: true }));
				stopped.resolve();
				await cleanup.promise;
				return { type: 'cancelled', reason: 'done' };
			}),
			activities: [Save],
			authenticate,
			authorize,
			concurrency: 1,
			cleanupMs: 25,
		});
		await using server = await listen(host);
		const pending = client(server.url, { cleanupMs: 25 }).run(ctx, attempt(ctx), noop);
		await entered.promise;
		controller.abort();
		await stopped.promise;
		expect((await pending).type).toBe('lost');
		await using next = context.create({ id: 'duplex-next' });
		const response = await fetch(server.url, request(attempt(next), 'start'));
		expect(response.status).toBe(503);
		cleanup.resolve();
		await host.close();
	});

	it('retires an unread response after its finite deadline without starting provider work', async () => {
		let called = false;
		await using ctx = context.create({ id: 'duplex-backpressure' });
		const host = duplex.handler({
			provider: provider(async () => {
				called = true;
				return { type: 'success', value: 'saved' };
			}),
			activities: [Save],
			authenticate,
			authorize,
			timeoutMs: 10,
			cleanupMs: 10,
		});
		const response = await host(request(attempt(ctx), 'start'));
		// Native TransformStream backpressure blocks hello until demand; closing forces finite cancellation.
		await host.close();
		expect(called).toBe(false);
		await response.body?.cancel().catch(() => undefined);
	});

	it('does not publish a session when close wins an asynchronous authorization race', async () => {
		const entered = gate();
		const release = gate();
		let called = false;
		await using ctx = context.create({ id: 'duplex-close-race' });
		const host = duplex.handler({
			provider: provider(async () => {
				called = true;
				return { type: 'success', value: 'saved' };
			}),
			activities: [Save],
			authenticate,
			authorize: async () => {
				entered.resolve();
				await release.promise;
				return true;
			},
		});
		const pending = host(request(attempt(ctx), 'start'));
		await entered.promise;
		await host.close();
		release.resolve();
		expect((await pending).status).toBe(503);
		expect(called).toBe(false);
	});

	it('does not start provider work if disconnect wins asynchronous authorization', async () => {
		const entered = gate();
		const release = gate();
		let called = false;
		const cancelled = new AbortController();
		await using ctx = context.create({ id: 'duplex-auth-disconnect' });
		const host = duplex.handler({
			provider: provider(async () => {
				called = true;
				return { type: 'success', value: 'saved' };
			}),
			activities: [Save],
			authenticate,
			authorize: async () => {
				entered.resolve();
				await release.promise;
				return true;
			},
		});
		const initial = request(attempt(ctx), 'start');
		const pending = host(new Request(initial, { signal: cancelled.signal }));
		await entered.promise;
		cancelled.abort();
		release.resolve();
		expect((await pending).status).toBe(408);
		expect(called).toBe(false);
		await host.close();
	});

	it('bounds total reverse calls and fails instead of running an unbounded loop', async () => {
		await using ctx = context.create({ id: 'duplex-limit' });
		const host = duplex.handler({
			provider: provider(async (_ctx, _attempt, control) => {
				await control.heartbeat();
				await control.heartbeat();
				return { type: 'success', value: 'saved' };
			}),
			activities: [Save],
			authenticate,
			authorize,
			maximumCalls: 1,
		});
		await using server = await listen(host);
		expect((await client(server.url).run(ctx, attempt(ctx), noop)).type).toBe('fault');
		await host.close();
	});
});
