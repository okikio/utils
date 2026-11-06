import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as endpoint from '@okikio/server/endpoint';
import * as resource from '@okikio/capability/resource';
import * as response from '@okikio/http/response';
import * as service from './mod.ts';

describe('resource outages', () => {
	it('returns safe 503 only for explicit adapter unavailability and retries acquisition', async () => {
		const Store = resource.define<string>()({ id: 'private-store', description: 'A required store.' });
		const Empty = response.noContent();
		const Read = endpoint.get({ id: 'read', path: '/', resources: [Store], responses: [Empty] });
		const Definition = service.define({ id: 'outage', path: '/', endpoints: [Read] });
		const contract = await service.openapi(service.compileDefinition(Definition), { title: 'Outage', version: '1' });
		const responses = contract.paths['/']!.get as { responses: Record<string, { headers?: Record<string, unknown> }> };
		expect(responses.responses['503']).toBeDefined();
		let creates = 0;
		await using runtime = service.create(
			service.compile(service.implement(Definition, {
				endpoints: [endpoint.handler(Read, async ({ resources }) => {
					await resources.get(Store);
					return response.create(Empty, undefined);
				})],
				resources: resource.implementations(resource.implement(Store, {
					create() {
						creates++;
						if (creates === 1) throw new resource.UnavailableError(Store, { cause: new Error('credential-private') });
						if (creates === 2) throw new Error('programming-private');
						return 'connected';
					},
				})),
			})),
			{ host: {} },
		);
		const unavailable = await runtime.fetch(new Request('https://test.invalid/'));
		expect(unavailable.status).toBe(503);
		const body = await unavailable.text();
		expect(body).not.toContain('private');
		expect(body).not.toContain('credential');
		expect((await runtime.fetch(new Request('https://test.invalid/'))).status).toBe(500);
		expect((await runtime.fetch(new Request('https://test.invalid/'))).status).toBe(204);
		expect(creates).toBe(3);
	});
});
