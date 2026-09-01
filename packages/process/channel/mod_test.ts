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

describe('process channel', () => {
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
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
