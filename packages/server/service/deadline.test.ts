// @installed-consumer: Check request deadlines and input cleanup through the published service export.
import { describe, it } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { ContextCancelledError, ContextDeadlineExceededError } from '@okikio/context';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as resource from '@okikio/capability/resource';
import * as resilience from '@okikio/capability/resilience';
import * as service from '@okikio/server/service';

describe('request body deadlines', () => {
	it('cancels a stalled source at the owned deadline before the handler runs', { timeout: 10_000 }, async () => {
		const Empty = response.noContent();
		const Upload = endpoint.post({
			id: 'upload',
			path: '/',
			resiliency: [resilience.timeout({ seconds: 1 }), resilience.bodyLimit(16)],
			responses: [Empty],
		});
		const cancelled = Promise.withResolvers<unknown>();
		let calls = 0;
		let cancellations = 0;
		const body = new ReadableStream<Uint8Array>({
			cancel(reason) {
				cancellations++;
				cancelled.resolve(reason);
			},
		});
		await using runtime = service.create(
			service.compile(service.implement(service.define({ id: 'deadline', path: '/', endpoints: [Upload] }), {
				resources: resource.implementations(),
				endpoints: [endpoint.handler(Upload, () => {
					calls++;
					return response.create(Empty, undefined);
				})],
			})),
			{ host: {} },
		);
		const result = await runtime.fetch(
			new Request('https://test.invalid/', { method: 'POST', body, duplex: 'half' } as RequestInit),
		);
		strictEqual(result.status, 504);
		strictEqual(calls, 0);
		await result.arrayBuffer();
		ok((await cancelled.promise) instanceof ContextDeadlineExceededError);
		strictEqual(cancellations, 1);
		strictEqual(body.locked, false);
	});

	it('cancels an unread input when its response completes', { timeout: 10_000 }, async () => {
		const Empty = response.noContent();
		const Upload = endpoint.post({ id: 'unread-upload', path: '/', responses: [Empty] });
		const cancelled = Promise.withResolvers<unknown>();
		const body = new ReadableStream<Uint8Array>({
			cancel(reason) {
				cancelled.resolve(reason);
			},
		});
		await using runtime = service.create(
			service.compile(service.implement(service.define({ id: 'unread-input', path: '/', endpoints: [Upload] }), {
				endpoints: [endpoint.handler(Upload, () => response.create(Empty, undefined))],
			})),
			{ host: {} },
		);
		const result = await runtime.fetch(
			new Request('https://test.invalid/', { method: 'POST', body, duplex: 'half' } as RequestInit),
		);
		strictEqual(result.status, 204);
		await result.arrayBuffer();
		ok((await cancelled.promise) instanceof ContextCancelledError);
		strictEqual(body.locked, false);
	});

	it('cancels an unread input when its caller aborts before dispatch', { timeout: 10_000 }, async () => {
		const Empty = response.noContent();
		const Upload = endpoint.post({ id: 'cancelled-upload', path: '/', responses: [Empty] });
		const cancelled = Promise.withResolvers<unknown>();
		const body = new ReadableStream<Uint8Array>({
			cancel(reason) {
				cancelled.resolve(reason);
			},
		});
		let calls = 0;
		await using runtime = service.create(
			service.compile(service.implement(service.define({ id: 'cancelled-input', path: '/', endpoints: [Upload] }), {
				endpoints: [endpoint.handler(Upload, () => {
					calls++;
					return response.create(Empty, undefined);
				})],
			})),
			{ host: {} },
		);
		const controller = new AbortController();
		const reason = new Error('caller stopped this upload');
		controller.abort(reason);
		const request = new Request('https://test.invalid/', {
			method: 'POST',
			body,
			signal: controller.signal,
			duplex: 'half',
		} as RequestInit);
		await rejects(async () => runtime.fetch(request), (error: unknown) => error === reason);
		strictEqual(calls, 0);
		strictEqual(await cancelled.promise, reason);
		strictEqual(body.locked, false);
	});

	it('preserves existing byte bodies and request modes when applying the owned signal', async () => {
		const Empty = response.noContent();
		const Upload = endpoint.post({ id: 'upload-mode', path: '/', responses: [Empty] });
		const observed: { mode: RequestMode; body: string }[] = [];
		await using runtime = service.create(
			service.compile(service.implement(service.define({ id: 'request-mode', path: '/', endpoints: [Upload] }), {
				resources: resource.implementations(),
				endpoints: [endpoint.handler(Upload, async ({ request }) => {
					observed.push({ mode: request.mode, body: await request.text() });
					return response.create(Empty, undefined);
				})],
			})),
			{ host: {} },
		);
		for (const mode of ['cors', 'same-origin', 'no-cors'] as const) {
			const result = await runtime.fetch(new Request('https://test.invalid/', { method: 'POST', body: 'abc', mode }));
			strictEqual(result.status, 204);
			await result.arrayBuffer();
		}
		deepStrictEqual(observed, [
			{ mode: 'cors', body: 'abc' },
			{ mode: 'same-origin', body: 'abc' },
			{ mode: 'no-cors', body: 'abc' },
		]);
	});
});
