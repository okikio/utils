import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { ContextDeadlineExceededError } from '@okikio/context';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as resource from '@okikio/capability/resource';
import * as resilience from '@okikio/capability/resilience';
import * as service from './mod.ts';

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
		const body = new ReadableStream<Uint8Array>({
			cancel(reason) {
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
		expect(result.status).toBe(504);
		expect(calls).toBe(0);
		await result.arrayBuffer();
		expect(await cancelled.promise).toBeInstanceOf(ContextDeadlineExceededError);
		expect(body.locked).toBe(false);
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
			expect(result.status).toBe(204);
			await result.arrayBuffer();
		}
		expect(observed).toEqual([
			{ mode: 'cors', body: 'abc' },
			{ mode: 'same-origin', body: 'abc' },
			{ mode: 'no-cors', body: 'abc' },
		]);
	});
});
