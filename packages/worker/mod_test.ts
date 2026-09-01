import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as context from '@okikio/context';
import * as worker from './mod.ts';
import type { RawWorker } from './types.ts';

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

class FakeWorker implements RawWorker {
	readonly posted: Array<Readonly<{ readonly message: unknown; readonly transfer?: readonly Transferable[] }>> = [];
	readonly listeners = {
		message: new Set<(event: MessageEvent<unknown>) => void>(),
		error: new Set<(event: ErrorEvent) => void>(),
		messageerror: new Set<(event: MessageEvent<unknown>) => void>(),
	};
	terminated = 0;
	onPost?: (message: unknown) => void;

	postMessage(message: unknown, transfer?: readonly Transferable[]): void {
		this.posted.push(Object.freeze({ message, ...(transfer === undefined ? {} : { transfer }) }));
		this.onPost?.(message);
	}

	terminate(): void {
		this.terminated += 1;
	}

	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	addEventListener(
		type: keyof FakeWorker['listeners'],
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
	): void {
		(this.listeners[type] as Set<typeof listener>).add(listener);
	}

	removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	removeEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(
		type: keyof FakeWorker['listeners'],
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
	): void {
		(this.listeners[type] as Set<typeof listener>).delete(listener);
	}

	message(data: unknown): void {
		for (const listener of this.listeners.message) listener(new MessageEvent('message', { data }));
	}

	error(reason: unknown): void {
		for (const listener of this.listeners.error) {
			listener(new ErrorEvent('error', { error: reason, message: String(reason) }));
		}
	}
}

function open(fake: FakeWorker, ctx: context.Context, requestId = 'request-1') {
	return worker.open(ctx, {
		module: new URL('file:///analysis-thread.ts'),
		id: 'analysis-thread-1',
		requestId: () => requestId,
		protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
		create: () => fake,
		shutdownMs: 10,
	});
}

function requestId(message: unknown): string {
	if (typeof message !== 'object' || message === null || !('id' in message) || typeof message.id !== 'string') {
		throw new TypeError('Expected a request envelope.');
	}
	return message.id;
}

describe('Worker handle', () => {
	it('validates requests and correlated responses', async () => {
		await using ctx = context.create({ id: 'worker-result' });
		const fake = new FakeWorker();
		fake.onPost = (message) => {
			if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'request') return;
			queueMicrotask(() => fake.message({ type: 'result', id: requestId(message), response: { upper: 'VALUE' } }));
		};
		await using handle = open(fake, ctx);
		expect(await handle.request(ctx, { value: 'value' })).toEqual({ upper: 'VALUE' });
		await expect(handle.request(ctx, { value: 42 } as never)).rejects.toThrow();
	});

	it('returns expected encoded failures without invalidating the Worker', async () => {
		await using ctx = context.create({ id: 'worker-failure' });
		const fake = new FakeWorker();
		let count = 0;
		fake.onPost = (message) => {
			if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'request') return;
			const id = requestId(message);
			queueMicrotask(() => {
				if (count++ === 0) {
					fake.message({
						type: 'failure',
						id,
						failure: { id: 'analysis.rejected', data: { reason: 'invalid' }, message: 'Analysis was rejected.' },
					});
				} else fake.message({ type: 'result', id, response: { upper: 'RECOVERED' } });
			});
		};
		await using handle = open(fake, ctx, 'failure-request');
		await expect(handle.request(ctx, { value: 'bad' })).rejects.toBeInstanceOf(worker.WorkerFailureError);
		expect(await handle.request(ctx, { value: 'good' }, { id: 'recovery-request' })).toEqual({ upper: 'RECOVERED' });
	});

	it('propagates cancellation, sends a cancel envelope, and ignores the late response', async () => {
		await using ownerCtx = context.create({ id: 'worker-owner' });
		const controller = new AbortController();
		await using requestCtx = context.create({ id: 'worker-cancel', signal: controller.signal });
		const fake = new FakeWorker();
		await using handle = open(fake, ownerCtx, 'cancelled-request');
		const pending = handle.request(requestCtx, { value: 'slow' });
		await nextTurn();
		controller.abort('caller stopped waiting');
		await expect(pending).rejects.toBeInstanceOf(context.ContextCancelledError);
		expect(
			fake.posted.some(({ message }) =>
				typeof message === 'object' && message !== null && 'type' in message && message.type === 'cancel'
			),
		).toBe(true);
		fake.message({ type: 'result', id: 'cancelled-request', response: { upper: 'TOO LATE' } });

		fake.onPost = (message) => {
			if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'request') {
				queueMicrotask(() => fake.message({ type: 'result', id: requestId(message), response: { upper: 'NEXT' } }));
			}
		};
		expect(await handle.request(ownerCtx, { value: 'next' }, { id: 'next-request' })).toEqual({ upper: 'NEXT' });
	});

	it('invalidates immediately when a response uses an unknown request ID', async () => {
		await using ctx = context.create({ id: 'worker-protocol' });
		const fake = new FakeWorker();
		await using handle = open(fake, ctx, 'known-request');
		const pending = handle.request(ctx, { value: 'pending' });
		await nextTurn();
		fake.message({ type: 'result', id: 'unknown-request', response: { upper: 'INVALID' } });
		await expect(pending).rejects.toBeInstanceOf(worker.WorkerStoppedError);
		expect(fake.terminated).toBe(1);
		await expect(handle.request(ctx, { value: 'after-fault' }, { id: 'after-fault' })).rejects.toBeInstanceOf(
			worker.WorkerStoppedError,
		);
	});

	it('rejects invalid response data and settles every pending request', async () => {
		await using ctx = context.create({ id: 'worker-invalid-response' });
		const fake = new FakeWorker();
		await using handle = open(fake, ctx, 'invalid-response');
		const pending = handle.request(ctx, { value: 'pending' });
		await nextTurn();
		fake.message({ type: 'result', id: 'invalid-response', response: { upper: 42 } });
		await expect(pending).rejects.toBeInstanceOf(worker.WorkerStoppedError);
		expect(fake.terminated).toBe(1);
	});

	it('uses cooperative shutdown when acknowledged and makes repeated stops harmless', async () => {
		await using ctx = context.create({ id: 'worker-stop' });
		const fake = new FakeWorker();
		fake.onPost = (message) => {
			if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown') {
				queueMicrotask(() => fake.message({ type: 'stopped' }));
			}
		};
		const handle = open(fake, ctx);
		await Promise.all([handle.stop('shutdown'), handle.stop('shutdown'), handle[Symbol.asyncDispose]()]);
		expect(fake.terminated).toBe(1);
	});
});

class FakeWorkerScope implements worker.RawWorkerScope {
	readonly posted: Array<Readonly<{ readonly message: unknown; readonly transfer?: readonly Transferable[] }>> = [];
	readonly listeners = {
		message: new Set<(event: MessageEvent<unknown>) => void>(),
		messageerror: new Set<(event: MessageEvent<unknown>) => void>(),
	};

	postMessage(message: unknown, transfer?: readonly Transferable[]): void {
		this.posted.push(Object.freeze({ message, ...(transfer === undefined ? {} : { transfer }) }));
	}

	addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent<unknown>) => void): void {
		this.listeners[type].add(listener);
	}

	removeEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent<unknown>) => void): void {
		this.listeners[type].delete(listener);
	}

	message(data: unknown): void {
		for (const listener of this.listeners.message) listener(new MessageEvent('message', { data }));
	}
}

async function nextTurn(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('Worker server', () => {
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
		await nextTurn();
		expect(scope.posted).toEqual([{
			message: { type: 'result', id: 'request-1', response: { upper: 'VALUE' } },
			transfer: [transferred],
		}]);
	});

	it('turns request cleanup rejection into a protocol fault instead of an unhandled message rejection', async () => {
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

		await server.closed;

		expect(scope.posted[0]?.message).toEqual({ type: 'result', id: 'cleanup-failure', response: { upper: 'VALUE' } });
		expect(scope.posted.some(({ message }) =>
			typeof message === 'object' && message !== null && 'type' in message && message.type === 'fault'
		)).toBe(true);
	});

	it('encodes expected failures and keeps serving later requests', async () => {
		const FailureData = schema(
			(value): value is Readonly<{ readonly reason: string }> =>
				typeof value === 'object' && value !== null &&
				typeof (value as { reason?: unknown }).reason === 'string',
			'Expected failure data.',
		);
		const Rejected = (await import('@okikio/failure')).define({
			id: 'analysis.rejected',
			description: 'Analysis was rejected.',
			data: FailureData,
		});
		const failureCore = await import('@okikio/failure');
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
		await nextTurn();
		scope.message({ type: 'request', id: 'good', context: requestContext, request: { value: 'good' } });
		await nextTurn();
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
		await using server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(_request, ctx) {
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
		await nextTurn();
		scope.message({ type: 'shutdown', reason: 'host shutdown' });
		await server.closed;
		expect(cancelled).toBe(true);
		expect(scope.posted).toEqual([{ message: { type: 'stopped' } }]);
	});
});

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
			requestId: () => 'notice-request',
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema, notice: NoticeSchema }),
			create: () => fake,
			notice(notice) {
				notices.push(notice.phase);
			},
		});

		expect(await handle.request(ctx, { value: 'value' })).toEqual({ upper: 'DONE' });
		await nextTurn();
		expect(notices).toEqual(['capturing']);
	});

	it('answers reverse calls without turning them into terminal request results', async () => {
		await using ctx = context.create({ id: 'worker-call' });
		const fake = new FakeWorker();
		fake.onPost = (message) => {
			if (typeof message !== 'object' || message === null || !('type' in message)) return;
			if (message.type === 'request') {
				queueMicrotask(() => fake.message({
					type: 'call',
					id: requestId(message),
					callId: 'permission-1',
					request: { permission: 'media.read' },
				}));
				return;
			}
			if (message.type === 'call-result' && 'id' in message && typeof message.id === 'string') {
				queueMicrotask(() => fake.message({ type: 'result', id: message.id, response: { upper: 'AUTHORIZED' } }));
			}
		};
		await using handle = worker.open(ctx, {
			module: new URL('file:///call-worker.ts'),
			id: 'call-worker',
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
		expect(fake.posted.some(({ message }) =>
			typeof message === 'object' && message !== null && 'type' in message && message.type === 'call-result'
		)).toBe(true);
	});

	it('blocks only cooperative checkpoints and resumes the same active request', async () => {
		const scope = new FakeWorkerScope();
		let releaseBeforeCheckpoint!: () => void;
		const beforeCheckpoint = new Promise<void>((resolve) => releaseBeforeCheckpoint = resolve);
		await using _server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(request, _ctx, control) {
				await beforeCheckpoint;
				await control.checkpoint();
				return { upper: request.value.toUpperCase() };
			},
		});
		const requestContext = { id: 'worker-pause', startedAt: '2026-08-05T00:00:00Z' };
		scope.message({ type: 'request', id: 'paused', context: requestContext, request: { value: 'later' } });
		await nextTurn();
		scope.message({ type: 'pause', id: 'paused' });
		releaseBeforeCheckpoint();
		await nextTurn();
		expect(scope.posted).toEqual([]);
		scope.message({ type: 'resume', id: 'paused' });
		await nextTurn();
		expect(scope.posted).toEqual([{ message: { type: 'result', id: 'paused', response: { upper: 'LATER' } } }]);
	});

	it('cancellation releases a paused checkpoint and suppresses a late terminal result', async () => {
		const scope = new FakeWorkerScope();
		let releaseBeforeCheckpoint!: () => void;
		const beforeCheckpoint = new Promise<void>((resolve) => releaseBeforeCheckpoint = resolve);
		await using _server = worker.serve({
			scope,
			protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			async run(_request, _ctx, control) {
				await beforeCheckpoint;
				await control.checkpoint();
				return { upper: 'LATE' };
			},
		});
		const requestContext = { id: 'worker-pause-cancel', startedAt: '2026-08-05T00:00:00Z' };
		scope.message({ type: 'request', id: 'cancelled-pause', context: requestContext, request: { value: 'later' } });
		await nextTurn();
		scope.message({ type: 'pause', id: 'cancelled-pause' });
		releaseBeforeCheckpoint();
		await nextTurn();
		scope.message({ type: 'cancel', id: 'cancelled-pause', reason: 'stop' });
		await nextTurn();
		expect(scope.posted).toEqual([]);
	});
});
