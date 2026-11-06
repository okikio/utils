import * as codecs from '@okikio/schema/codec';
import * as schemaCore from '@okikio/schema';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as context from '@okikio/context';
import * as channel from './mod.ts';
import type { ProcessChannelSource } from './types.ts';

/** Create a tiny Standard Schema contract for protocol fixtures. */
function schema<Value>(check: (value: unknown) => value is Value, message: string): StandardSchemaV1<unknown, Value> {
	return schemaCore.guard(check, message);
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
		contract: codecs.identity(contract),
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
	it('encodes and decodes all five application payloads through explicit codecs', async () => {
		const dates = codecs.define({
			decode: schemaCore.transform(schemaCore.string(), (text) => new Date(text)),
			encode: schemaCore.transform(schemaCore.date(), (date) => date.toISOString()),
		});
		const contract = channel.protocol({
			request: dates,
			response: dates,
			notice: dates,
			call: { request: dates, response: dates },
		});
		const transport = pair();
		await using ctx = context.create({ id: 'process-dates' });
		const date = new Date('2026-01-02T03:04:05Z');
		const notices: Date[] = [];
		await using _server = channel.serve({
			input: transport.input,
			output: transport.output,
			protocol: contract,
			async run(request, _ctx, control) {
				expect(request).toBeInstanceOf(Date);
				await control.notify(request);
				const response = await control.call(request);
				expect(response).toBeInstanceOf(Date);
				return response;
			},
		});
		await using client = channel.open(ctx, transport.process, {
			protocol: contract,
			notice(value) {
				notices.push(value);
			},
			call(value) {
				expect(value).toBeInstanceOf(Date);
				return value;
			},
		});
		const returned: Date = await client.request(ctx, date);
		expect(returned).toEqual(date);
		expect(notices).toEqual([date]);
	});

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
				`${action} ${
					side === 'parent' ? 'cancels local admission' : 'joins remote validation before release'
				} (${side})`,
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
						let settled = false;
						void pending.then(() => {
							settled = true;
						});
						const closing = action === 'close' ? client.close(reason) : undefined;
						if (action === 'cancel') context.cancel(requestCtx, reason);
						if (side !== 'parent') {
							await new Promise<void>((resolve) => setTimeout(resolve, 0));
							expect(settled).toBe(false);
							gate.release();
							await gate.completed;
						}
						const result = await pending;
						await closing;
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
		const entered = Promise.withResolvers<void>();
		let release!: () => void;
		const beforeCheckpoint = new Promise<void>((resolve) => release = resolve);
		await using _server = channel.serve({
			input: transport.input,
			output: transport.output,
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(request, _ctx, control) {
				entered.resolve();
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
		await entered.promise;
		await client.pause('paused-request');
		await nextTurn();
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

	it('rejects malformed UTF-8 without replacing bytes inside a valid JSON string', { timeout: 5_000 }, async () => {
		const transport = pair();
		let calls = 0;
		await using server = channel.serve({
			input: transport.input,
			output: transport.output,
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			run() {
				calls++;
				return { upper: 'unexpected' };
			},
		});
		const reader = transport.process.stdout.getReader();
		const output = reader.read();
		const encoder = new TextEncoder();
		const prefix = encoder.encode(
			'{"type":"request","id":"bad","context":{"id":"bad","startedAt":"2026-01-01T00:00:00Z"},"request":{"value":"',
		);
		const suffix = encoder.encode('"}}\n');
		const bytes = new Uint8Array([...prefix, 0xc3, 0x28, ...suffix]);
		const writer = transport.process.stdin.getWriter();
		try {
			await writer.write(bytes);
		} finally {
			writer.releaseLock();
		}
		await server.closed;
		expect(calls).toBe(0);
		expect(new TextDecoder().decode((await output).value)).toContain('not valid UTF-8 JSON');
		await reader.cancel();
		reader.releaseLock();
	});
});

/** Yield to stream reader and protocol microtasks without embedding timing assumptions in tests. */
async function nextTurn(): Promise<void> {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
}

it(
	'keeps cancelled process requests reserved until child cleanup acknowledges release',
	{ timeout: 5_000 },
	async () => {
		await using owner = context.create({ id: 'process-receipt-owner' });
		await using requestCtx = context.child(owner, { id: 'process-receipt-request' });
		const transport = pair();
		const protocol = channel.protocol({ request: RequestSchema, response: ResponseSchema });
		const started = Promise.withResolvers<void>();
		const cleaning = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		await using _server = channel.serve({
			input: transport.input,
			output: transport.output,
			protocol,
			async run(_request, ctx) {
				ctx.defer(async () => {
					cleaning.resolve();
					await release.promise;
				});
				started.resolve();
				await context.waitFor(ctx, () => () => {});
				return { upper: 'UNREACHABLE' };
			},
		});
		await using client = channel.open(owner, transport.process, { protocol, cancelMs: 4_000 });
		let settled = false;
		const pending = client.request(requestCtx, { value: 'cancel' }).catch((error: unknown) => {
			settled = true;
			throw error;
		});
		void pending.catch(() => {});
		await started.promise;
		context.cancel(requestCtx);
		await cleaning.promise;
		await Promise.resolve();
		expect(settled).toBe(false);
		release.resolve();
		await expect(pending).rejects.toBeInstanceOf(context.ContextCancelledError);
	},
);

it('negotiates real byte-framed streams before encoding and fails closed on missing required features', async () => {
	for (const mismatch of [false, true]) {
		const transport = pair();
		const compatibility = { contract: 'process.negotiation', version: 1, features: ['echo'], required: ['echo'] };
		const contract = channel.protocol({
			request: codecs.identity(RequestSchema),
			response: codecs.identity(ResponseSchema),
			compatibility,
		});
		await using ctx = context.create({ id: 'process-negotiation' });
		await using _server = channel.serve({
			input: transport.input,
			output: transport.output,
			protocol: channel.protocol({
				...contract,
				compatibility: { ...compatibility, features: mismatch ? [] : ['echo'] },
			}),
			maximumRequests: 1,
			run: (value) => ({ upper: value.value.toUpperCase() }),
		});
		await using caller = channel.open(ctx, transport.process, { protocol: contract, maximumRequests: 1 });
		const result = caller.request(ctx, { value: 'hello' });
		await expect(caller.request(ctx, { value: 'excess' })).rejects.toThrow(RangeError);
		if (mismatch) await expect(result).rejects.toThrow();
		else expect(await result).toEqual({ upper: 'HELLO' });
	}
});

it('joins process host finalization once and rejects closed when cleanup throws undefined', async () => {
	for (const failed of [false, true]) {
		const pipes = pair(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		let calls = 0;
		const server = channel.serve({
			input: pipes.input,
			output: pipes.output,
			protocol: channel.protocol({ request: RequestSchema, response: ResponseSchema }),
			run: (request) => ({ upper: request.value }),
			async finalize() {
				calls++;
				entered.resolve();
				await release.promise;
				if (failed) throw undefined;
			},
		});
		const observed = server.closed.then(() => false, () => true);
		const closing = server.close();
		const stopped = closing.then(() => false, () => true);
		await entered.promise;
		const disposed = server[Symbol.asyncDispose]().then(() => false, () => true);
		// A second caller joins the same failing receipt; attach its rejection before releasing the hook.
		const repeated = server.close().then(() => false, () => true);
		release.resolve();
		expect(await stopped).toBe(failed);
		expect(await repeated).toBe(failed);
		expect(await disposed).toBe(failed);
		expect(await observed).toBe(failed);
		expect(calls).toBe(1);
	}
});
