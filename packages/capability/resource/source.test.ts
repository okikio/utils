import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as context from '@okikio/context';
import * as env from '@okikio/env';
import * as resource from './mod.ts';

/** Creates one owned deterministic context for resource lifecycle tests. */
function createTestContext(id: string = crypto.randomUUID()): context.Owned {
	return context.create({ id, clock: new context.TestClock() });
}

describe('resource configuration and borrowing', () => {
	it('admits only the requested resource fields from a raw source', async () => {
		await using ctx = createTestContext();
		const StringSchema: StandardSchemaV1<unknown, string> = {
			'~standard': {
				version: 1,
				vendor: 'test',
				async validate(value) {
					return typeof value === 'string' ? { value: value.trim() } : { issues: [{ message: 'Expected a string.' }] };
				},
			},
		};
		const configuration = env.define({
			DATABASE_URL: env.variable(StringSchema, { description: 'Store origin.' }),
			PEER_TOKEN: env.secret(StringSchema, { description: 'Private peer token.' }),
		});
		const Store = resource.define<string>()({
			id: 'test.isolated-store',
			description: 'A store independent of the optional peer.',
			environment: env.requirement('test.store-environment', configuration, { DATABASE_URL: 'Connect to storage.' }),
		});
		const Peer = resource.define<string>()({
			id: 'test.isolated-peer',
			description: 'An optional peer.',
			environment: env.requirement('test.peer-environment', configuration, { PEER_TOKEN: 'Authenticate the peer.' }),
		});
		let peerCreates = 0;
		const implementations = resource.implementations(
			resource.implement(Store, { create: ({ environment }) => environment.DATABASE_URL! }),
			resource.implement(Peer, {
				create: ({ environment }) => {
					peerCreates++;
					return environment.PEER_TOKEN!;
				},
			}),
		);
		const source: Record<string, string> = { DATABASE_URL: ' postgres://storage.test ' };
		await using collection = resource.create(implementations, { source, host: {}, ctx });

		expect(await collection.get(ctx, Store)).toBe('postgres://storage.test');
		await expect(collection.get(ctx, Peer)).rejects.toBeInstanceOf(env.EnvironmentError);
		expect(peerCreates).toBe(0);
		expect(await collection.get(ctx, Store)).toBe('postgres://storage.test');

		// A corrected source is admitted on the next attempt, with no second collection.
		source.PEER_TOKEN = ' private-peer-token ';
		expect(await collection.get(ctx, Peer)).toBe('private-peer-token');
		expect(peerCreates).toBe(1);
	});

	it('rejects an ambiguous mix of raw and parsed configuration before acquiring resources', async () => {
		await using ctx = createTestContext();
		expect(() =>
			resource.create(resource.implementations(), {
				source: {},
				environment: {},
				host: {},
				ctx,
			})
		).toThrow(TypeError);
	});

	it('lets one borrower cancel while another shares the same acquisition', async () => {
		await using owner = createTestContext();
		await using first = createTestContext('first-borrower');
		await using second = createTestContext('second-borrower');
		const Store = resource.define<string>()({ id: 'test.borrowed-store', description: 'A shared delayed store.' });
		let acquired!: (value: string) => void;
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		let creates = 0;
		const implementation = resource.implement(Store, {
			create({ ctx }) {
				creates++;
				expect(ctx.signal.aborted).toBe(false);
				started();
				return new Promise<string>((resolve) => {
					acquired = resolve;
				});
			},
		});
		await using collection = resource.create(resource.implementations(implementation), { host: {}, ctx: owner });
		const pending = collection.get(first, Store);
		const other = collection.get(second, Store);
		await ready;
		const reason = new Error('The first caller disconnected.');
		context.cancel(first, reason);
		await expect(pending).rejects.toBe(reason);
		acquired('connected');
		expect(await other).toBe('connected');
		expect(await collection.get(second, Store)).toBe('connected');
		expect(creates).toBe(1);
	});
});
