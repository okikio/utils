import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as context from '@okikio/context';
import * as worker from './mod.ts';
import { FakeWorker, FakeWorkerScope, RequestSchema, ResponseSchema } from './fixtures/protocol.ts';

describe('request cleanup receipts', () => {
	for (const cancel of [false, true]) {
		it(
			`${cancel ? 'cancellation' : 'success'} retains the request until remote cleanup completes`,
			{ timeout: 5_000 },
			async () => {
				await using owner = context.create({ id: 'receipt-owner' });
				await using requestCtx = context.child(owner, { id: 'receipt-request' });
				const raw = new FakeWorker();
				const scope = new FakeWorkerScope();
				raw.onPost = (message) => queueMicrotask(() => scope.message(message));
				scope.postMessage = (message) => queueMicrotask(() => raw.message(message));
				const started = Promise.withResolvers<void>();
				const cleaning = Promise.withResolvers<void>();
				const release = Promise.withResolvers<void>();
				await using _server = worker.serve({
					scope,
					protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
					async run(request, ctx) {
						ctx.defer(async () => {
							cleaning.resolve();
							await release.promise;
						});
						started.resolve();
						if (cancel) await context.waitFor(ctx, () => () => {});
						return { upper: request.value.toUpperCase() };
					},
				});
				await using handle = worker.open(owner, {
					module: new URL('file:///receipt-thread.ts'),
					create: () => raw,
					protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
					cancelMs: 4_000,
				});
				// Release remote cleanup before the handle or server waits for its receipt.
				using _release = { [Symbol.dispose]: () => release.resolve() };
				let settled = false;
				const pending = handle.request(requestCtx, { value: 'joined' }).then(
					(value) => {
						settled = true;
						return value;
					},
					(error: unknown) => {
						settled = true;
						throw error;
					},
				);
				void pending.catch(() => {});
				await started.promise;
				if (cancel) context.cancel(requestCtx, 'cancel-owned-work');
				await cleaning.promise;
				await Promise.resolve();
				expect(settled).toBe(false);
				release.resolve();
				if (cancel) await expect(pending).rejects.toBeInstanceOf(context.ContextCancelledError);
				else expect(await pending).toEqual({ upper: 'JOINED' });
				expect(raw.terminated).toBe(0);
			},
		);
	}

	it(
		'joins asynchronous native termination before releasing an uncooperative request',
		{ timeout: 5_000 },
		async () => {
			await using owner = context.create({ id: 'retirement-owner' });
			await using requestCtx = context.child(owner, { id: 'retirement-request' });
			const raw = new FakeWorker();
			const retiring = Promise.withResolvers<void>();
			const stopped = Promise.withResolvers<void>();
			raw.terminate = async () => {
				retiring.resolve();
				await stopped.promise;
			};
			await using handle = worker.open(owner, {
				module: new URL('file:///retirement-thread.ts'),
				create: () => raw,
				cancelMs: 0,
				protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
			});
			// The termination gate must open before handle disposal joins native shutdown.
			using _release = { [Symbol.dispose]: () => stopped.resolve() };
			let settled = false;
			const pending = handle.request(requestCtx, { value: 'stuck' }).catch((error: unknown) => {
				settled = true;
				throw error;
			});
			void pending.catch(() => {});
			await raw.waitForPosts(1);
			context.cancel(requestCtx);
			await retiring.promise;
			expect(settled).toBe(false);
			stopped.resolve();
			await expect(pending).rejects.toBeInstanceOf(worker.WorkerStoppedError);
		},
	);
});
