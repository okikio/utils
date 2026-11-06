import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as failure from './mod.ts';
import { migrate } from './migrate.ts';

const Previous = failure.define({
	id: 'asset.missing.v1',
	description: 'Asset is missing.',
	data: schema.object({ path: schema.string() }),
});
const Current = failure.define({
	id: 'asset.missing.v2',
	description: 'Asset is missing.',
	data: schema.object({ id: schema.string() }),
});

describe('persisted failure migration', () => {
	it('checks both schemas and retains the saved explanation without local causes', async () => {
		const saved = await failure.encode(
			await failure.create(Previous, {
				data: { path: 'asset-7' },
				message: 'Archived asset is missing.',
				cause: new Error('local secret'),
			}),
		);
		const rewritten = await migrate(saved, {
			from: Previous,
			to: Current,
			convert: async ({ path }) => ({ id: path }),
		});

		expect(rewritten).toEqual({ id: Current.id, data: { id: 'asset-7' }, message: saved.message });
		expect((await failure.decode(rewritten, [Current])).definition).toBe(Current);
		expect(saved.id).toBe(Previous.id);
	});

	it('rejects unknown identities and invalid history before invoking conversion', async () => {
		let calls = 0;
		const transition = {
			from: Previous,
			to: Current,
			convert: () => {
				calls++;
				return { id: 'unexpected' };
			},
		};
		await expect(migrate({ id: 'untrusted', data: {}, message: 'Missing' }, transition)).rejects.toThrow();
		await expect(migrate({ id: Previous.id, data: { path: 1 }, message: 'Missing' }, transition)).rejects.toThrow();
		expect(calls).toBe(0);
	});

	it('rejects invalid target data, converter exceptions, and ambiguous same-ID changes', async () => {
		const saved = { id: Previous.id, data: { path: 'asset-7' }, message: 'Missing' };
		await expect(migrate(saved, { from: Previous, to: Current, convert: () => ({ id: 7 }) })).rejects.toThrow();
		const reason = new Error('conversion failed');
		await expect(migrate(saved, {
			from: Previous,
			to: Current,
			convert: () => {
				throw reason;
			},
		})).rejects.toBe(reason);
		await expect(migrate(saved, { from: Previous, to: Previous, convert: (data) => data })).rejects.toThrow('distinct');
	});
});
