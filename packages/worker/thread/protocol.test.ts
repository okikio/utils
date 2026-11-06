import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as context from '@okikio/context';
import * as worker from './mod.ts';
import {
	CallRequestSchema,
	CallResponseSchema,
	FakeWorker,
	FakeWorkerScope,
	NoticeSchema,
	requestId,
	RequestSchema,
	ResponseSchema,
} from './fixtures/protocol.ts';

describe('Worker intermediate protocol', () => {
	it('delivers notices without settling the owning request', async () => {
		await using ctx = context.create({ id: 'worker-notice' });
		const fake = new FakeWorker();
		const notices: string[] = [];
		fake.onPost = (message) => {
			if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'request') return;
			const id = requestId(message);
			queueMicrotask(() => fake.message({ type: 'notice', id, notice: { phase: 'capturing' } }));
			queueMicrotask(() => fake.message({ type: 'result', id, response: { upper: 'DONE' } }));
		};
		await using handle = worker.open(ctx, {
			module: new URL('file:///notice-worker.ts'),
			id: 'notice-worker',
			shutdownMs: 0,
			requestId: () => 'notice-request',
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema, notice: NoticeSchema }),
			create: () => fake,
			notice(notice) {
				notices.push(notice.phase);
			},
		});

		expect(await handle.request(ctx, { value: 'value' })).toEqual({ upper: 'DONE' });
		expect(notices).toEqual(['capturing']);
	});

	it('answers reverse calls without turning them into terminal request results', async () => {
		await using ctx = context.create({ id: 'worker-call' });
		const fake = new FakeWorker();
		fake.onPost = (message) => {
			if (typeof message !== 'object' || message === null || !('type' in message)) return;
			if (message.type === 'request') {
				queueMicrotask(() =>
					fake.message({
						type: 'call',
						id: requestId(message),
						callId: 'permission-1',
						request: { permission: 'media.read' },
					})
				);
				return;
			}
			if (message.type === 'call-result' && 'id' in message && typeof message.id === 'string') {
				queueMicrotask(() => fake.message({ type: 'result', id: message.id, response: { upper: 'AUTHORIZED' } }));
			}
		};
		await using handle = worker.open(ctx, {
			module: new URL('file:///call-worker.ts'),
			id: 'call-worker',
			shutdownMs: 0,
			requestId: () => 'call-request',
			protocol: worker.protocol({
				request: RequestSchema,
				response: ResponseSchema,
				call: { request: CallRequestSchema, response: CallResponseSchema },
			}),
			create: () => fake,
			call(request) {
				expect(request.permission).toBe('media.read');
				return { allowed: true };
			},
		});

		expect(await handle.request(ctx, { value: 'value' })).toEqual({ upper: 'AUTHORIZED' });
		expect(
			fake.posted.some(({ message }) =>
				typeof message === 'object' && message !== null && 'type' in message && message.type === 'call-result'
			),
		).toBe(true);
	});

	it('blocks only cooperative checkpoints and resumes the same active request', async () => {
		const scope = new FakeWorkerScope();
		let releaseBeforeCheckpoint!: () => void;
		const beforeCheckpoint = new Promise<void>((resolve) => releaseBeforeCheckpoint = resolve);
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => markStarted = resolve);
		let markCheckpoint!: () => void;
		const checkpoint = new Promise<void>((resolve) => markCheckpoint = resolve);
		await using _server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(request, _ctx, control) {
				markStarted();
				await beforeCheckpoint;
				const paused = control.checkpoint();
				markCheckpoint();
				await paused;
				return { upper: request.value.toUpperCase() };
			},
		});
		// Let server disposal reach its cancellation checkpoint after an early assertion failure.
		using _release = { [Symbol.dispose]: () => releaseBeforeCheckpoint() };
		const requestContext = { id: 'worker-pause', startedAt: '2026-08-05T00:00:00Z' };
		scope.message({ type: 'request', id: 'paused', context: requestContext, request: { value: 'later' } });
		await started;
		scope.message({ type: 'pause', id: 'paused' });
		releaseBeforeCheckpoint();
		await checkpoint;
		expect(scope.posted).toEqual([]);
		scope.message({ type: 'resume', id: 'paused' });
		await scope.waitForPosts(1);
		expect(scope.posted).toEqual([{ message: { type: 'result', id: 'paused', response: { upper: 'LATER' } } }]);
	});

	it('cancellation releases a paused checkpoint and suppresses a late terminal result', async () => {
		const scope = new FakeWorkerScope();
		let releaseBeforeCheckpoint!: () => void;
		const beforeCheckpoint = new Promise<void>((resolve) => releaseBeforeCheckpoint = resolve);
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => markStarted = resolve);
		let markCheckpoint!: () => void;
		const checkpoint = new Promise<void>((resolve) => markCheckpoint = resolve);
		let markReleased!: () => void;
		const released = new Promise<void>((resolve) => markReleased = resolve);
		await using _server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(_request, _ctx, control) {
				markStarted();
				await beforeCheckpoint;
				const paused = control.checkpoint();
				markCheckpoint();
				try {
					await paused;
				} finally {
					markReleased();
				}
				return { upper: 'LATE' };
			},
		});
		using _release = { [Symbol.dispose]: () => releaseBeforeCheckpoint() };
		const requestContext = { id: 'worker-pause-cancel', startedAt: '2026-08-05T00:00:00Z' };
		scope.message({ type: 'request', id: 'cancelled-pause', context: requestContext, request: { value: 'later' } });
		await started;
		scope.message({ type: 'pause', id: 'cancelled-pause' });
		releaseBeforeCheckpoint();
		await checkpoint;
		scope.message({ type: 'cancel', id: 'cancelled-pause', reason: 'stop' });
		await released;
		expect(scope.posted).toEqual([]);
	});
});
