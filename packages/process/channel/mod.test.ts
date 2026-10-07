import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as context from '@okikio/context';
import * as channel from './mod.ts';
import type { ProcessChannelSource } from './types.ts';

/** Create a tiny Standard Schema contract for protocol fixtures. */
function schema<Value>(check: (value: unknown) => value is Value, message: string): StandardSchemaV1<unknown, Value> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1 as const,
			vendor: 'test',
			validate(value: unknown) {
				return check(value) ? { value } : { issues: [{ message }] };
			},
		}),
	});
}

const RequestSchema = schema(
	(value): value is Readonly<{ readonly value: string }> =>
		typeof value === 'object' && value !== null && typeof (value as { value?: unknown }).value === 'string',
	'Expected a request value.',
);
const ResponseSchema = schema(
	(value): value is Readonly<{ readonly upper: string }> =>
		typeof value === 'object' && value !== null && typeof (value as { upper?: unknown }).upper === 'string',
	'Expected an uppercase response.',
);
const NoticeSchema = schema(
	(value): value is Readonly<{ readonly phase: string }> =>
		typeof value === 'object' && value !== null && typeof (value as { phase?: unknown }).phase === 'string',
	'Expected a notice phase.',
);
const CallRequestSchema = schema(
	(value): value is Readonly<{ readonly permission: string }> =>
		typeof value === 'object' && value !== null && typeof (value as { permission?: unknown }).permission === 'string',
	'Expected a permission request.',
);
const CallResponseSchema = schema(
	(value): value is Readonly<{ readonly allowed: boolean }> =>
		typeof value === 'object' && value !== null && typeof (value as { allowed?: unknown }).allowed === 'boolean',
	'Expected a permission decision.',
);

/** Build two connected byte streams and a borrowed fake Process around the parent side. */
function pair() {
	const parentToChild = new TransformStream<Uint8Array, Uint8Array>();
	const childToParent = new TransformStream<Uint8Array, Uint8Array>();
	const process = Object.freeze({
		pid: 42,
		tree: 'direct-child' as const,
		stdin: parentToChild.writable,
		stdout: childToParent.readable,
		events: {} as never,
		wait: async () => ({ code: 0, success: true }),
		signal() {},
		stop: async () => {},
		async [Symbol.asyncDispose]() {},
	}) satisfies ProcessChannelSource;
	return { process, input: parentToChild.readable, output: childToParent.writable };
}

/** Hold one external validator until its test explicitly releases and joins it. */
function validationGate<Value>(base: StandardSchemaV1<unknown, Value>, signal: AbortSignal) {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const completed = Promise.withResolvers<void>();
	let calls = 0;
	const abort = () => {
		release.resolve();
		entered.resolve();
	};
	signal.addEventListener('abort', abort, { once: true });
	const contract: StandardSchemaV1<unknown, Value> = {
		'~standard': {
			version: 1,
			vendor: 'gated-test',
			async validate(value) {
				calls += 1;
				entered.resolve();
				try {
					await release.promise;
					return await base['~standard'].validate(value);
				} finally {
					completed.resolve();
				}
			},
		},
	};
	return {
		contract,
		entered: entered.promise,
		completed: completed.promise,
		release() {
			signal.removeEventListener('abort', abort);
			release.resolve();
		},
		calls: () => calls,
	};
}

/** Observe rejection immediately so cleanup never leaves an unhandled request. */
function outcome<Value>(value: Promise<Value>) {
	return value.then(
		(value) => ({ type: 'success' as const, value }),
		(reason: unknown) => ({ type: 'rejected' as const, reason }),
	);
}

describe('process channel', () => {
	it('reserves duplicate parent IDs before asynchronous validation', { timeout: 10_000 }, async (test) => {
		await using owner = context.create({ id: 'channel-admission-duplicate' });
		const gate = validationGate(RequestSchema, test.signal);
		const transport = pair();
		let runs = 0;
		await using server = channel.serve({
			input: transport.input,
			output: transport.output,
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			run(request) {
				runs += 1;
				return { upper: request.value.toUpperCase() };
			},
		});
		await using client = channel.open(owner, transport.process, {
			protocol: channel.protocol({ request: gate.contract, response: ResponseSchema }),
		});
		const first = outcome(client.request(owner, { value: 'first' }, { id: 'reserved' }));
		try {
			await gate.entered;
			test.signal.throwIfAborted();
			await expect(client.request(owner, { value: 'second' }, { id: 'reserved' })).rejects.toBeInstanceOf(TypeError);
			expect(gate.calls()).toBe(1);
			gate.release();
			expect(await first).toEqual({ type: 'success', value: { upper: 'FIRST' } });
			expect(runs).toBe(1);
		} finally {
			gate.release();
			await first;
			if (gate.calls() > 0) await gate.completed;
			await client.close();
			await server.closed;
		}
	});

	for (const side of ['parent', 'child-request', 'child-response'] as const) {
		for (const action of ['cancel', 'close'] as const) {
			it(
				`${action} settles ${side} validation before the external validator completes`,
				{ timeout: 10_000 },
				async (test) => {
					await using owner = context.create({ id: `channel-validation-${side}-${action}` });
					await using requestCtx = context.child(owner, { id: 'validation-request' });
					const requestGate = validationGate(RequestSchema, test.signal);
					const responseGate = validationGate(ResponseSchema, test.signal);
					const gate = side === 'child-response' ? responseGate : requestGate;
					const transport = pair();
					let runs = 0;
					await using server = channel.serve({
						input: transport.input,
						output: transport.output,
						protocol: channel.protocol({
							request: side === 'child-request' ? requestGate.contract : RequestSchema,
							response: side === 'child-response' ? responseGate.contract : ResponseSchema,
						}),
						run(request) {
							runs += 1;
							return { upper: request.value.toUpperCase() };
						},
					});
					await using client = channel.open(owner, transport.process, {
						protocol: channel.protocol({
							request: side === 'parent' ? requestGate.contract : RequestSchema,
							response: ResponseSchema,
						}),
					});
					const pending = outcome(client.request(requestCtx, { value: 'pending' }, { id: 'validation' }));
					try {
						await gate.entered;
						test.signal.throwIfAborted();
						const reason = `exact-validation-${side}-${action}`;
						if (action === 'cancel') context.cancel(requestCtx, reason);
						else await client.close(reason);
						const result = await pending;
						expect(result.type).toBe('rejected');
						if (result.type !== 'rejected') throw new Error('Validation returned a cancelled result.');
						if (action === 'cancel') {
							expect(result.reason).toBeInstanceOf(context.ContextCancelledError);
							if (!(result.reason instanceof context.ContextCancelledError)) throw result.reason;
							expect(result.reason.reason).toBe(reason);
						} else {
							expect(result.reason).toBeInstanceOf(channel.ChannelClosedError);
							if (!(result.reason instanceof channel.ChannelClosedError)) throw result.reason;
							if (side === 'parent') expect(result.reason.reason).toBe(reason);
						}
						await client.close(reason);
						await server.closed;
						expect(runs).toBe(side === 'child-response' ? 1 : 0);
					} finally {
						requestGate.release();
						responseGate.release();
						await pending;
						if (gate.calls() > 0) await gate.completed;
						await client.close();
						await server.closed;
					}
				},
			);
		}
	}

	it('correlates validated requests and responses', async () => {
		await using ctx = context.create({ id: 'process-channel' });
		const transport = pair();
		await using server = channel.serve({
			input: transport.input,
			output: transport.output,
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			run(request) {
				return { upper: request.value.toUpperCase() };
			},
		});
		void server;
		await using client = channel.open(ctx, transport.process, {
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			requestId: () => 'request-1',
		});

		expect(await client.request(ctx, { value: 'media' })).toEqual({ upper: 'MEDIA' });
		await client.close();
		await server.closed;
	});

	it('keeps notices and reverse calls non-terminal', async () => {
		await using ctx = context.create({ id: 'process-channel-call' });
		const transport = pair();
		const protocol = channel.protocol({
			request: RequestSchema,
			response: ResponseSchema,
			notice: NoticeSchema,
			call: { request: CallRequestSchema, response: CallResponseSchema },
		});
		await using server = channel.serve({
			input: transport.input,
			output: transport.output,
			protocol,
			callId: () => 'permission-1',
			async run(request, _ctx, control) {
				await control.notify({ phase: 'checking' });
				const decision = await control.call({ permission: 'media.read' });
				return { upper: decision.allowed ? request.value.toUpperCase() : 'DENIED' };
			},
		});
		void server;
		const notices: string[] = [];
		await using client = channel.open(ctx, transport.process, {
			protocol,
			requestId: () => 'call-request',
			notice(value) {
				notices.push(value.phase);
			},
			call(request) {
				expect(request.permission).toBe('media.read');
				return { allowed: true };
			},
		});

		expect(await client.request(ctx, { value: 'media' })).toEqual({ upper: 'MEDIA' });
		expect(notices).toEqual(['checking']);
	});

	for (const action of ['cancel', 'close'] as const) {
		it(`${action} settles a pending child reverse call before the parent adapter returns`, async () => {
			await using owner = context.create({ id: `reverse-call-${action}` });
			await using requestCtx = context.child(owner, { id: `reverse-call-${action}:request` });
			const transport = pair();
			const protocol = channel.protocol({
				request: RequestSchema,
				response: ResponseSchema,
				call: { request: CallRequestSchema, response: CallResponseSchema },
			});
			let entered!: () => void;
			const parentEntered = new Promise<void>((resolve) => entered = resolve);
			let rejectCall!: (value: unknown) => void;
			const childRejected = new Promise<unknown>((resolve) => rejectCall = resolve);
			await using server = channel.serve({
				input: transport.input,
				output: transport.output,
				protocol,
				async run(request, _ctx, control) {
					try {
						await control.call({ permission: 'media.read' });
					} catch (reason) {
						rejectCall(reason);
						throw reason;
					}
					return { upper: request.value.toUpperCase() };
				},
			});
			await using client = channel.open(owner, transport.process, {
				protocol,
				async call() {
					entered();
					// The adapter intentionally cannot reply until the child observes cancellation.
					await childRejected;
					return { allowed: true };
				},
			});
			const result = client.request(requestCtx, { value: 'pending' }).then(
				(value) => ({ type: 'success' as const, value }),
				(reason: unknown) => ({ type: 'rejected' as const, reason }),
			);
			await parentEntered;
			const reason = `exact-${action}-reason`;
			let closing: Promise<void> | undefined;
			if (action === 'cancel') context.cancel(requestCtx, reason);
			else closing = client.close(reason);
			const childReason = await childRejected;
			expect(childReason).toBeInstanceOf(context.ContextCancelledError);
			if (!(childReason instanceof context.ContextCancelledError)) throw childReason;
			expect(childReason.reason).toBe(reason);
			await (closing ?? client.close(reason));
			await server.closed;
			const outcome = await result;
			expect(outcome.type).toBe('rejected');
			if (outcome.type !== 'rejected') throw new Error('Cancelled reverse call returned a value.');
			if (action === 'cancel') {
				expect(outcome.reason).toBeInstanceOf(context.ContextCancelledError);
				if (!(outcome.reason instanceof context.ContextCancelledError)) throw outcome.reason;
				expect(outcome.reason.reason).toBe(reason);
			} else expect(outcome.reason).toBeInstanceOf(channel.ChannelClosedError);
		});
	}

	it('pauses only at cooperative checkpoints and cancellation releases them', async () => {
		await using owner = context.create({ id: 'process-channel-pause-owner' });
		const transport = pair();
		let release!: () => void;
		const beforeCheckpoint = new Promise<void>((resolve) => release = resolve);
		await using _server = channel.serve({
			input: transport.input,
			output: transport.output,
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(request, _ctx, control) {
				await beforeCheckpoint;
				await control.checkpoint();
				return { upper: request.value.toUpperCase() };
			},
		});
		await using client = channel.open(owner, transport.process, {
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			requestId: () => 'paused-request',
		});

		const pending = client.request(owner, { value: 'later' });
		await nextTurn();
		await client.pause('paused-request');
		release();
		await nextTurn();
		let settled = false;
		void pending.finally(() => settled = true);
		await nextTurn();
		expect(settled).toBe(false);
		await client.resume('paused-request');
		expect(await pending).toEqual({ upper: 'LATER' });
	});

	it('rejects a frame that exceeds the configured byte limit', async () => {
		await using ctx = context.create({ id: 'process-channel-limit' });
		const transport = pair();
		await using _server = channel.serve({
			input: transport.input,
			output: transport.output,
			maximumFrameBytes: 32,
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			run(request) {
				return { upper: request.value.toUpperCase() };
			},
		});
		await using client = channel.open(ctx, transport.process, {
			maximumFrameBytes: 32,
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			requestId: () => 'large-request',
		});
		await expect(client.request(ctx, { value: 'x'.repeat(100) })).rejects.toBeInstanceOf(channel.ChannelProtocolError);
	});
});

/** Yield to stream reader and protocol microtasks without embedding timing assumptions in tests. */
async function nextTurn(): Promise<void> {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
}
