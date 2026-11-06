import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as resource from './mod.ts';

describe('resource lifetime inspection', () => {
	it('reports configured, acquiring, ready, releasing and fully settled ownership without leaking values', async () => {
		await using ctx = context.create({ id: 'resource-report' });
		const Ready = resource.define<{ secret: string }>()({ id: 'ready', description: 'Test resource.' });
		const acquire = Promise.withResolvers<void>();
		const releasing = Promise.withResolvers<void>();
		const close = Promise.withResolvers<void>();
		let calls = 0;
		const implementation = resource.implement(Ready, {
			async create() {
				calls++;
				await acquire.promise;
				return {
					secret: 'private-value',
					async [Symbol.asyncDispose]() {
						releasing.resolve();
						await close.promise;
					},
				};
			},
		});
		const collection = resource.create(resource.implementations(implementation), { ctx, host: {} });
		expect(resource.inspect(collection, { maximumResources: 0 })).toMatchObject({
			configured: 1,
			capped: true,
			resources: [],
		});
		expect(calls).toBe(0);
		expect(resource.inspect(collection, { maximumResources: 1 }).resources[0]?.state).toBe('configured');
		const first = collection.get(ctx, Ready);
		const second = collection.get(ctx, Ready);
		expect(resource.inspect(collection, { maximumResources: 1 }).resources[0]?.state).toBe('acquiring');
		acquire.resolve();
		expect(await first).toBe(await second);
		expect(calls).toBe(1);
		const report = resource.inspect(collection, { maximumResources: 1 });
		expect(report.resources[0]?.state).toBe('ready');
		expect(JSON.stringify(report).includes('private-value')).toBe(false);
		const disposed = collection[Symbol.asyncDispose]();
		await releasing.promise;
		expect(resource.inspect(collection, { maximumResources: 1 })).toMatchObject({
			state: 'disposing',
			resources: [{ id: 'ready', state: 'releasing' }],
		});
		close.resolve();
		await disposed;
		expect(resource.inspect(collection, { maximumResources: 1 })).toMatchObject({
			state: 'disposed',
			resources: [{ id: 'ready', state: 'closed' }],
		});
	});
	it('removes failed acquisition state for explicit retry without retaining provider errors', async () => {
		await using ctx = context.create({ id: 'failed-resource' });
		const Definition = resource.define<number>()({ id: 'retry', description: 'Test retry.' });
		const failure = new Error('private failure');
		let calls = 0;
		await using collection = resource.create(
			resource.implementations(resource.implement(Definition, {
				create() {
					if (++calls === 1) throw failure;
					return 1;
				},
			})),
			{ ctx, host: {} },
		);
		await expect(collection.get(ctx, Definition)).rejects.toBe(failure);
		expect(resource.inspect(collection, { maximumResources: 1 }).resources[0]?.state).toBe('configured');
		expect(await collection.get(ctx, Definition)).toBe(1);
		expect(() => resource.inspect(collection, { maximumResources: -1 })).toThrow(RangeError);
	});
});
