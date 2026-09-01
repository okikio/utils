import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as context from '@okikio/context';
import * as env from '@okikio/env';
import * as permissions from '@okikio/permission';
import * as requirement from '@okikio/requirement';
import * as resource from './mod.ts';

/** Creates one owned deterministic context for resource lifecycle tests. */
function createTestContext(id: string = crypto.randomUUID()): context.Owned {
	return context.create({ id, clock: new context.TestClock() });
}

/** Adds one permission interpreter to a borrowed context without taking ownership. */
function permissionContext(
	ctx: context.Context,
	checker: permissions.PermissionChecker,
): requirement.RequirementContext {
	return requirement.scope(ctx, {
		interpreters: { permission: permissions.interpreter(checker) },
		unknown: 'reject',
	});
}

describe('resource definitions and collections', () => {
	it('deduplicates repeated implementation objects without inventing runtime tuple entries', () => {
		const Store = resource.define<{ readonly ready: true }>()({
			id: 'test.implementation-set-deduplication',
			description: 'Store used to verify implementation-set deduplication.',
		});
		const StoreLive = resource.implement(Store, { create: () => ({ ready: true as const }) });

		const set = resource.implementations(StoreLive, StoreLive);

		expect(set.implementations).toHaveLength(1);
		expect(set.implementations[0]).toBe(StoreLive);
	});

	it('rejects dependency cycles and missing implementations before runtime creation', () => {
		const dependenciesA: Record<string, resource.ResourceDefinition> = Object.create(null);
		const dependenciesB: Record<string, resource.ResourceDefinition> = Object.create(null);
		const A = Object.freeze({ kind: 'resource', id: 'test.a', description: 'A.', dependencies: dependenciesA }) as resource.ResourceDefinition;
		const B = Object.freeze({ kind: 'resource', id: 'test.b', description: 'B.', dependencies: dependenciesB }) as resource.ResourceDefinition;
		dependenciesA.b = B;
		dependenciesB.a = A;

		const cycle = resource.validate([A, B]);
		expect(cycle.valid).toBe(false);
		if (!cycle.valid) expect(cycle.issues.some((issue) => issue.code === 'dependency-cycle')).toBe(true);

		const Database = resource.define<{ readonly connected: true }>()({ id: 'test.database', description: 'Database.' });
		const Repository = resource.define<{ readonly database: { readonly connected: true } }>()({
			id: 'test.repository',
			description: 'Repository.',
			dependencies: { database: Database },
		});
		const RepositoryLive = resource.implement(Repository, {
			create({ dependencies }) { return { database: dependencies.database }; },
		});
		const coverage = resource.validate(resource.implementations(RepositoryLive));
		expect(coverage.valid).toBe(false);
		if (!coverage.valid) expect(coverage.issues.some((issue) => issue.code === 'missing-implementation')).toBe(true);
	});

	it('keeps direct and reachable resource-use requirements separate', () => {
		const FileWrite = permissions.define({ id: 'test.file-write', description: 'Write files.' });
		const MediaUse = permissions.define({ id: 'test.media-use', description: 'Use the media service.' });
		const Storage = resource.define<Readonly<Record<string, never>>>()({
			id: 'test.requirement-storage',
			description: 'Storage.',
			requirements: [permissions.require(FileWrite)],
		});
		const Media = resource.define<Readonly<Record<string, never>>>()({
			id: 'test.requirement-media',
			description: 'Media.',
			dependencies: { storage: Storage },
			requirements: [permissions.require(MediaUse)],
		});

		expect(Media.requirements).toEqual([permissions.require(MediaUse)]);
		expect(resource.reachable(Media)).toEqual([permissions.require(FileWrite), permissions.require(MediaUse)]);
		expect(resource.document(Media)[1]).toMatchObject({
			id: Media.id,
			requirements: [{ family: 'permission', action: 'require', definition: MediaUse.id }],
			reachableRequirements: [
				{ family: 'permission', action: 'require', definition: FileWrite.id },
				{ family: 'permission', action: 'require', definition: MediaUse.id },
			],
		});
	});

	it('checks actor-specific resource authority on every public borrow', async () => {
		await using owner = createTestContext('resource-owner');
		const UseStore = permissions.define({ id: 'test.store-use', description: 'Use the shared store.' });
		const Store = resource.define<{ readonly generation: number }>()({
			id: 'test.shared-store',
			description: 'One cached store shared by several callers.',
			requirements: [permissions.require(UseStore)],
		});
		let creates = 0;
		const StoreLive = resource.implement(Store, { create: () => ({ generation: ++creates }) });
		await using resources = resource.create(resource.implementations(StoreLive), { host: {}, ctx: owner });

		const actors: string[] = [];
		const checker: permissions.PermissionChecker = {
			maximumChecks: 10,
			async check(ctx, requests) {
				actors.push(ctx.id);
				expect(requests.map((entry) => entry.definition)).toEqual([UseStore]);
				return [{ allowed: true }];
			},
		};
		await using alice = createTestContext('alice');
		await using bob = createTestContext('bob');
		const first = await resources.get(permissionContext(alice, checker), Store);
		const second = await resources.get(permissionContext(bob, checker), Store);

		expect(first).toBe(second);
		expect(creates).toBe(1);
		expect(actors).toEqual(['alice', 'bob']);
	});

	it('applies implementation acquisition requirements once for one cached value', async () => {
		await using owner = createTestContext('resource-acquisition-owner');
		const Connect = permissions.define({ id: 'test.store-connect', description: 'Open the store provider.' });
		const Store = resource.define<{ readonly ready: true }>()({ id: 'test.acquired-store', description: 'Acquired store.' });
		let checks = 0;
		let creates = 0;
		const checker: permissions.PermissionChecker = {
			maximumChecks: 10,
			async check(_ctx, requests) {
				checks += requests.length;
				return requests.map(() => ({ allowed: true }));
			},
		};
		const StoreLive = resource.implement(Store, {
			requirements: [permissions.require(Connect)],
			create() { creates++; return { ready: true as const }; },
		});
		await using resources = resource.create(resource.implementations(StoreLive), {
			host: {},
			ctx: owner,
			requirements: { interpreters: { permission: permissions.interpreter(checker) }, unknown: 'reject' },
		});

		await resources.get(owner, Store);
		await resources.get(owner, Store);
		expect(checks).toBe(1);
		expect(creates).toBe(1);
	});

	it('owns resource-local helpers and disposes failed acquisitions immediately', async () => {
		await using ctx = createTestContext();
		const events: string[] = [];
		const Broken = resource.define<Readonly<Record<string, never>>>()({ id: 'test.broken-scope', description: 'Broken resource.' });
		const implementation = resource.implement(Broken, {
			create({ ctx }) {
				ctx.defer(() => void events.push('deferred'));
				ctx.use({ [Symbol.dispose]() { events.push('helper'); } });
				throw new Error('creation failed');
			},
		});
		await using collection = resource.create(resource.implementations(implementation), { host: {}, ctx });
		await expect(collection.get(ctx, Broken)).rejects.toThrow('creation failed');
		expect(events).toEqual(['helper', 'deferred']);
	});

	it('preserves resource creation and cleanup failures with SuppressedError semantics', async () => {
		await using ctx = createTestContext();
		const primary = new Error('creation failed');
		const cleanup = new Error('cleanup failed');
		const Broken = resource.define<Readonly<Record<string, never>>>()({
			id: 'test.suppressed-cleanup',
			description: 'Resource whose creation and cleanup both fail.',
		});
		const implementation = resource.implement(Broken, {
			create({ ctx }) {
				ctx.defer(() => { throw cleanup; });
				throw primary;
			},
		});
		await using collection = resource.create(resource.implementations(implementation), { host: {}, ctx });
		let thrown: unknown;
		try { await collection.get(ctx, Broken); }
		catch (error) { thrown = error; }
		expect(thrown).toBeInstanceOf(SuppressedError);
		if (thrown instanceof SuppressedError) {
			expect(thrown.error).toBe(cleanup);
			expect(thrown.suppressed).toBe(primary);
		}
	});

	it('does not dispose a returned value twice when creation already registered it', async () => {
		const events: string[] = [];
		const Owned = resource.define<AsyncDisposable>()({ id: 'owned-return', description: 'Owned return value.' });
		const OwnedLive = resource.implement(Owned, {
			create({ ctx }) {
				return ctx.use({ async [Symbol.asyncDispose]() { events.push('disposed'); } });
			},
		});
		await using parent = createTestContext('owned-return-parent');
		const resources = resource.create(resource.implementations(OwnedLive), { host: {}, ctx: parent });
		await resources.get(parent, Owned);
		await resources[Symbol.asyncDispose]();
		expect(events).toEqual(['disposed']);
	});

	it('deduplicates concurrent lazy acquisition and retries after failure', async () => {
		await using ctx = createTestContext();
		const ResourceValue = resource.define<{ readonly sequence: number }>()({ id: 'test.value', description: 'Retryable value.' });
		let sequences = 0;
		const implementation = resource.implement(ResourceValue, {
			async create() {
				sequences += 1;
				await Promise.resolve();
				if (sequences === 1) throw new Error('first acquisition failed');
				return { sequence: sequences };
			},
		});
		await using collection = resource.create(resource.implementations(implementation), { host: {}, ctx });
		await expect(collection.get(ctx, ResourceValue)).rejects.toThrow('first acquisition failed');
		const [first, second] = await Promise.all([collection.get(ctx, ResourceValue), collection.get(ctx, ResourceValue)]);
		expect(first).toBe(second);
		expect(first.sequence).toBe(2);
		expect(sequences).toBe(2);
	});

	it('projects environment fields and passes the exact host and collection context', async () => {
		await using ctx = createTestContext();
		const StringSchema: StandardSchemaV1<unknown, string> = Object.freeze({
			'~standard': Object.freeze({
				version: 1 as const,
				vendor: 'test',
				validate(value: unknown) { return typeof value === 'string' ? { value } : { issues: [{ message: 'Expected a string.' }] }; },
			}),
		});
		const environment = env.define({ DATABASE_URL: env.variable(StringSchema, { description: 'Database URL.' }) });
		const requirementDefinition = env.requirement('test.resource-environment', environment, {
			DATABASE_URL: 'Connect to the test database.',
		});
		const Database = resource.define<Readonly<{ readonly url: string; readonly hostName: string; readonly requestId: string }>>()({
			id: 'test.projected-database',
			description: 'Database with projected environment.',
			environment: requirementDefinition,
		});
		const host = Object.freeze({ name: 'test-host' });
		const implementation = resource.implement<typeof Database, resource.ResourceValue<typeof Database>, typeof host>(Database, {
			create({ environment, host: receivedHost, ctx: receivedContext }) {
				return { url: environment.DATABASE_URL!, hostName: receivedHost.name, requestId: receivedContext.id };
			},
		});
		await using collection = resource.create(resource.implementations(implementation), {
			environment: { DATABASE_URL: 'postgres://example', UNUSED: 'not projected' },
			host,
			ctx,
		});
		expect(await collection.get(ctx, Database)).toEqual({
			url: 'postgres://example', hostName: 'test-host', requestId: ctx.id,
		});
	});

	it('disposes acquired resources in reverse dependency order', async () => {
		await using ctx = createTestContext();
		const events: string[] = [];
		const Database = resource.define<AsyncDisposable>()({ id: 'test.database-disposal', description: 'Database.' });
		const Repository = resource.define<AsyncDisposable>()({
			id: 'test.repository-disposal', description: 'Repository.', dependencies: { database: Database },
		});
		const database = resource.implement(Database, {
			create() { return { async [Symbol.asyncDispose]() { events.push('database'); } }; },
		});
		const repository = resource.implement(Repository, {
			create() { return { async [Symbol.asyncDispose]() { events.push('repository'); } }; },
		});
		const collection = resource.create(resource.implementations(database, repository), { host: {}, ctx });
		await collection.get(ctx, Repository);
		await collection[Symbol.asyncDispose]();
		expect(events).toEqual(['repository', 'database']);
		await expect(collection.get(ctx, Database)).rejects.toThrow(resource.CollectionDisposedError);
		await collection[Symbol.asyncDispose]();
	});

	it('cancels in-flight acquisition when the collection is disposed', async () => {
		await using ctx = createTestContext();
		const Slow = resource.define<never>()({ id: 'test.slow', description: 'Slow resource.' });
		const implementation = resource.implement(Slow, {
			create({ ctx }) {
				return new Promise<never>((_resolve, reject) => {
					ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
				});
			},
		});
		const collection = resource.create(resource.implementations(implementation), { host: {}, ctx });
		const acquisition = collection.get(ctx, Slow);
		const disposal = collection[Symbol.asyncDispose]();
		await expect(acquisition).rejects.toThrow(resource.CollectionDisposedError);
		await disposal;
	});

	it('disposes a value that finishes creation after collection disposal begins', async () => {
		await using ctx = createTestContext();
		const events: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>((resolve) => release = resolve);
		const Late = resource.define<AsyncDisposable>()({ id: 'test.late', description: 'Late resource.' });
		const implementation = resource.implement(Late, {
			async create() {
				await gate;
				return { async [Symbol.asyncDispose]() { events.push('late-disposed'); } };
			},
		});
		const collection = resource.create(resource.implementations(implementation), { host: {}, ctx });
		const acquisition = collection.get(ctx, Late);
		const disposal = collection[Symbol.asyncDispose]();
		release();
		await expect(acquisition).rejects.toThrow(resource.CollectionDisposedError);
		await disposal;
		expect(events).toEqual(['late-disposed']);
	});
});
