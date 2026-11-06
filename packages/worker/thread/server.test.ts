import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as context from '@okikio/context';
import * as worker from './mod.ts';
import { FakeWorkerScope, RequestSchema, ResponseSchema, schema } from './fixtures/protocol.ts';

describe('Worker server', () => {
	it('publishes shutdown before an active request abort observer can reenter it', async () => {
		const scope = new FakeWorkerScope();
		const started = Promise.withResolvers<void>();
		let nested: Promise<void> | undefined;
		const server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(request, ctx) {
				ctx.signal.addEventListener('abort', () => {
					nested = server.stop('request observer');
				}, { once: true });
				started.resolve();
				await context.waitFor(ctx, () => () => {});
				return { upper: request.value.toUpperCase() };
			},
		});
		scope.message({
			type: 'request',
			id: 'reentrant-request',
			context: { id: 'reentrant-request', startedAt: '2026-01-01T00:00:00Z' },
			request: { value: 'held' },
		});
		await started.promise;
		const stopping = server.stop('owner');
		expect(nested).toBe(stopping);
		expect(server[Symbol.asyncDispose]()).toBe(stopping);
		await stopping;
		await server.closed;
		expect(scope.listeners.message.size + scope.listeners.messageerror.size).toBe(0);
	});
	it('restores context, validates the result, and preserves transfer ownership', async () => {
		const scope = new FakeWorkerScope();
		const transferred = new ArrayBuffer(8);
		await using _server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			run(request, ctx) {
				expect(ctx.id).toBe('worker-server-request');
				return worker.reply({ upper: request.value.toUpperCase() }, [transferred]);
			},
		});
		scope.message({
			type: 'request',
			id: 'request-1',
			context: {
				id: 'worker-server-request',
				startedAt: '2026-08-05T00:00:00Z',
			},
			request: { value: 'value' },
		});
		await scope.waitForPosts(1);
		expect(scope.posted).toEqual([{
			message: { type: 'result', id: 'request-1', response: { upper: 'VALUE' } },
			transfer: [transferred],
		}]);
	});

	it('reports cleanup rejection as the sole terminal fault without publishing success', async () => {
		const scope = new FakeWorkerScope();
		const server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			run(request, ctx) {
				ctx.defer(() => {
					throw new Error('request cleanup failed');
				});
				return { upper: request.value.toUpperCase() };
			},
		});
		scope.message({
			type: 'request',
			id: 'cleanup-failure',
			context: { id: 'worker-cleanup-failure', startedAt: '2026-08-05T00:00:00Z' },
			request: { value: 'value' },
		});

		await scope.waitForPosts(1);
		await server.stop();
		expect(scope.posted.length).toBe(1);
		expect(
			scope.posted.some(({ message }) =>
				typeof message === 'object' && message !== null && 'type' in message && message.type === 'fault'
			),
		).toBe(true);
	});

	it('encodes expected failures and keeps serving later requests', async () => {
		const FailureData = schema(
			(value): value is Readonly<{ readonly reason: string }> =>
				typeof value === 'object' && value !== null &&
				typeof (value as { reason?: unknown }).reason === 'string',
			'Expected failure data.',
		);
		const Rejected = (await import('@okikio/result/failure')).define({
			id: 'analysis.rejected',
			description: 'Analysis was rejected.',
			data: (await import('@okikio/schema/codec')).identity(FailureData),
		});
		const failureCore = await import('@okikio/result/failure');
		const scope = new FakeWorkerScope();
		await using _server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(request) {
				if (request.value === 'bad') throw await failureCore.create(Rejected, { data: { reason: 'invalid' } });
				return { upper: request.value.toUpperCase() };
			},
		});
		const requestContext = { id: 'worker-failure', startedAt: '2026-08-05T00:00:00Z' };
		scope.message({ type: 'request', id: 'bad', context: requestContext, request: { value: 'bad' } });
		await scope.waitForPosts(1);
		scope.message({ type: 'request', id: 'good', context: requestContext, request: { value: 'good' } });
		await scope.waitForPosts(2);
		expect(scope.posted[0]?.message).toEqual({
			type: 'failure',
			id: 'bad',
			failure: { id: 'analysis.rejected', data: { reason: 'invalid' }, message: 'Analysis was rejected.' },
		});
		expect(scope.posted[1]?.message).toEqual({ type: 'result', id: 'good', response: { upper: 'GOOD' } });
	});

	it('cancels active work and acknowledges cooperative shutdown after cleanup', async () => {
		const scope = new FakeWorkerScope();
		let cancelled = false;
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => markStarted = resolve);
		await using server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(_request, ctx) {
				markStarted();
				await new Promise<void>((resolve) => {
					const stop = () => {
						cancelled = true;
						resolve();
					};
					ctx.signal.addEventListener('abort', stop, { once: true });
				});
				return { upper: 'LATE' };
			},
		});
		scope.message({
			type: 'request',
			id: 'slow',
			context: { id: 'worker-slow', startedAt: '2026-08-05T00:00:00Z' },
			request: { value: 'slow' },
		});
		await started;
		scope.message({ type: 'shutdown', reason: 'host shutdown' });
		await server.closed;
		expect(cancelled).toBe(true);
		expect(scope.posted.at(-1)?.message).toEqual({ type: 'stopped' });
		expect(scope.posted.some(({ message }) => (message as { type: string }).type === 'cancelled')).toBe(true);
	});
});
