import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { Context } from '@okikio/context';
import * as permission from './mod.ts';
function baseContext(id: string): Context {
	return Object.freeze({
		id,
		startedAt: Object.freeze({}) as Temporal.Instant,
		signal: new AbortController().signal,
		clock: Object.freeze({ now: () => Object.freeze({}) as Temporal.Instant }),
	});
}

const TargetSchema = Object.freeze({
	'~standard': Object.freeze({
		version: 1 as const,
		vendor: 'utility-test',
		validate(value: unknown) {
			if (typeof value !== 'object' || value === null || typeof (value as { id?: unknown }).id !== 'string') {
				return { issues: [{ message: 'Expected a target id.' }] };
			}
			return { value: Object.freeze({ id: (value as { id: string }).id.toLowerCase() }) };
		},
	}),
});

const WorkspaceAccess = permission.define({ id: 'workspace.access', description: 'Access one workspace.' });
const ReadAsset = permission.define({ id: 'asset.read', description: 'Read one asset.', target: TargetSchema });
const WriteAsset = permission.define({ id: 'asset.write', description: 'Write one asset.', target: TargetSchema });
const WriteFolder = permission.define({ id: 'folder.write', description: 'Write one folder.', target: TargetSchema });
const ReadOrigin = permission.define({ id: 'origin.read', description: 'Read one origin.', target: TargetSchema });
const UseCredential = permission.define({
	id: 'credential.use',
	description: 'Use one credential.',
	target: TargetSchema,
});
const ReplaceAsset = permission.define({
	id: 'asset.replace',
	description: 'Replace one asset.',
	target: TargetSchema,
});

describe('@okikio/permission definitions', () => {
	it('defines stable metadata and reuses one requirement object per definition', () => {
		const definition = permission.define({ id: 'example', description: 'Example.' });
		expect(definition.kind).toBe('permission');
		expect(permission.require(definition)).toBe(permission.require(definition));
		expect(permission.require(definition)).toMatchObject({ family: 'permission', action: 'require', definition });
	});

	it('creates immutable all/any expressions without evaluating them', () => {
		const read = permission.on(ReadAsset, { id: 'A' });
		const write = permission.on(WriteAsset, { id: 'A' });
		const expression = permission.any(permission.all(WorkspaceAccess, read), write);
		expect(expression.kind).toBe('permission-any');
		expect(Object.isFrozen(expression)).toBe(true);
		expect(() => permission.all()).toThrow(TypeError);
		expect(() => permission.any()).toThrow(TypeError);
	});
});

describe('@okikio/permission runtime checks', () => {
	it('validates targets and evaluates a composite expression with one provider call', async () => {
		const base = baseContext('permission-composite');
		let calls = 0;
		let received: readonly permission.PermissionRequest[] = [];
		const ctx = permission.scope(base, {
			permissions: [WorkspaceAccess, ReadAsset, WriteAsset],
			checker: {
				maximumChecks: 20,
				async check(_ctx, requests) {
					calls++;
					received = requests;
					return requests.map((request) => Object.freeze({
						allowed: request.definition !== WriteAsset,
					}));
				},
			},
		});

		const allowed = await permission.check(
			ctx,
			permission.all(
				WorkspaceAccess,
				permission.any(
					permission.on(ReadAsset, { id: 'ASSET-1' }),
					permission.on(WriteAsset, { id: 'ASSET-1' }),
				),
			),
		);

		expect(allowed).toBe(true);
		expect(calls).toBe(1);
		expect(received).toHaveLength(3);
		expect(received[1]?.target).toEqual({ id: 'asset-1' });
	});

	it('supports direct check and assert calls with schema-inferred targets', async () => {
		const base = baseContext('permission-direct');
		const ctx = permission.scope(base, {
			permissions: [ReadAsset, WriteAsset],
			checker: {
				maximumChecks: 10,
				async check(_ctx, requests) {
					return requests.map((request) => ({ allowed: request.definition === ReadAsset }));
				},
			},
		});

		expect(await permission.check(ctx, ReadAsset, { id: 'ASSET-2' })).toBe(true);
		expect(await permission.check(ctx, WriteAsset, { id: 'ASSET-2' })).toBe(false);
		await expect(permission.assert(ctx, ReadAsset, { id: 'ASSET-2' })).resolves.toBeUndefined();
		await expect(permission.assert(ctx, WriteAsset, { id: 'ASSET-2' })).rejects.toMatchObject({
			name: 'PermissionDeniedError',
			denied: [WriteAsset],
		});
	});

	it('evaluates a realistic media import permission set in one logical provider call', async () => {
		const base = baseContext('permission-media-import');
		let calls = 0;
		let count = 0;
		const ctx = permission.scope(base, {
			permissions: [WorkspaceAccess, WriteFolder, ReadOrigin, UseCredential, ReplaceAsset],
			checker: {
				maximumChecks: 100,
				async check(_ctx, requests) {
					calls++;
					count = requests.length;
					return requests.map(() => ({ allowed: true }));
				},
			},
		});

		const access = permission.all(
			WorkspaceAccess,
			permission.on(WriteFolder, { id: 'downloads' }),
			...Array.from({ length: 6 }, (_, index) => permission.on(ReadOrigin, { id: `origin-${index}` })),
			...Array.from({ length: 3 }, (_, index) => permission.on(UseCredential, { id: `credential-${index}` })),
			...Array.from({ length: 9 }, (_, index) => permission.on(ReplaceAsset, { id: `asset-${index}` })),
		);

		await expect(permission.assert(ctx, access)).resolves.toBeUndefined();
		expect(calls).toBe(1);
		expect(count).toBe(20);
	});

	it('batches leaves from several composite expressions in one provider call', async () => {
		const base = baseContext('permission-composite-batch');
		let calls = 0;
		const ctx = permission.scope(base, {
			permissions: [WorkspaceAccess, ReadAsset, WriteAsset],
			checker: {
				maximumChecks: 20,
				async check(_ctx, requests) {
					calls++;
					return requests.map((request) => ({ allowed: request.definition !== WriteAsset }));
				},
			},
		});

		const decisions = await permission.batch(ctx, [
			permission.all(
				permission.on(ReadAsset, { id: 'ASSET-1' }),
				WorkspaceAccess,
			),
			permission.any(
				permission.on(WriteAsset, { id: 'ASSET-2' }),
				permission.on(ReadAsset, { id: 'ASSET-2' }),
			),
		]);

		expect(calls).toBe(1);
		expect(decisions).toEqual([true, true]);
	});

	it('evaluates hundreds of independent checks in one logical batch', async () => {
		const base = baseContext('permission-bulk');
		let calls = 0;
		const ctx = permission.scope(base, {
			permissions: [ReadAsset],
			checker: {
				maximumChecks: 1_000,
				async check(_ctx, requests) {
					calls++;
					return requests.map((request) => ({
						allowed: Number((request.target as { id: string }).id.split('-').at(-1)) % 2 === 0,
					}));
				},
			},
		});
		const checks = Array.from({ length: 200 }, (_, index) => permission.on(ReadAsset, { id: `ASSET-${index}` }));
		const decisions = await permission.batch(ctx, checks);

		expect(calls).toBe(1);
		expect(decisions).toHaveLength(200);
		expect(decisions[0]).toBe(true);
		expect(decisions[1]).toBe(false);
		expect(decisions[198]).toBe(true);
		expect(decisions[199]).toBe(false);
	});

	it('supports a realistic 1,000-object authorization batch without serial provider calls', async () => {
		const base = baseContext('permission-thousand');
		let calls = 0;
		const ctx = permission.scope(base, {
			permissions: [ReadAsset],
			checker: {
				maximumChecks: 1_000,
				async check(_ctx, requests) {
					calls++;
					return requests.map(() => ({ allowed: true }));
				},
			},
		});
		const checks = Array.from({ length: 1_000 }, (_, index) =>
			permission.on(ReadAsset, { id: `asset-${index}` })
		);

		const decisions = await permission.batch(ctx, checks);
		expect(calls).toBe(1);
		expect(decisions).toHaveLength(1_000);
		expect(decisions.every(Boolean)).toBe(true);
	});

	it('fails before provider work for undeclared permissions and invalid targets', async () => {
		const base = baseContext('permission-guard');
		let calls = 0;
		const checker: permission.PermissionChecker = {
			maximumChecks: 10,
			async check(_ctx, requests) {
				calls++;
				return requests.map(() => ({ allowed: true }));
			},
		};
		const ctx = permission.scope(base, { permissions: [ReadAsset], checker });

		await expect(permission.check(ctx, WriteAsset, { id: 'asset-1' })).rejects.toBeInstanceOf(
			permission.UndeclaredPermissionError,
		);
		await expect(permission.check(ctx, ReadAsset, { id: 42 } as never)).rejects.toThrow();
		expect(calls).toBe(0);
	});

	it('enforces the explicit logical batch limit', async () => {
		const base = baseContext('permission-limit');
		const ctx = permission.scope(base, {
			permissions: [ReadAsset],
			checker: {
				maximumChecks: 2,
				async check(_ctx, requests) {
					return requests.map(() => ({ allowed: true }));
				},
			},
		});
		await expect(permission.batch(ctx, [
			permission.on(ReadAsset, { id: '1' }),
			permission.on(ReadAsset, { id: '2' }),
			permission.on(ReadAsset, { id: '3' }),
		])).rejects.toMatchObject({ name: 'PermissionCheckLimitError', count: 3, maximum: 2 });
	});

	it('combines per-check provider errors without weakening explicit allow or deny branches', async () => {
		const base = baseContext('permission-partial-errors');
		const providerError = new Error('one policy shard unavailable');
		const ctx = permission.scope(base, {
			permissions: [WorkspaceAccess, ReadAsset],
			checker: {
				maximumChecks: 4,
				async check(_ctx, requests) {
					return requests.map((request) => request.definition === WorkspaceAccess
						? { error: providerError }
						: { allowed: (request.target as { id: string }).id !== 'deny' });
				},
			},
		});

		expect(await permission.check(ctx, permission.any(
			WorkspaceAccess,
			permission.on(ReadAsset, { id: 'allow' }),
		))).toBe(true);
		expect(await permission.check(ctx, permission.all(
			WorkspaceAccess,
			permission.on(ReadAsset, { id: 'deny' }),
		))).toBe(false);
		await expect(permission.assert(ctx, permission.any(
			WorkspaceAccess,
			permission.on(ReadAsset, { id: 'allow' }),
		))).resolves.toBeUndefined();
		await expect(permission.assert(ctx, permission.all(
			WorkspaceAccess,
			permission.on(ReadAsset, { id: 'deny' }),
		))).rejects.toMatchObject({
			name: 'PermissionDeniedError',
			denied: [ReadAsset],
		});
		await expect(permission.check(ctx, permission.any(
			WorkspaceAccess,
			permission.on(ReadAsset, { id: 'deny' }),
		))).rejects.toMatchObject({
			name: 'PermissionEvaluationError',
			definition: WorkspaceAccess,
			cause: providerError,
		});
	});

	it('does not convert provider faults or malformed results into denials', async () => {
		const base = baseContext('permission-fault');
		const failure = new Error('authorization provider unavailable');
		const faulted = permission.scope(base, {
			permissions: [WorkspaceAccess],
			checker: {
				maximumChecks: 1,
				async check() {
					throw failure;
				},
			},
		});
		await expect(permission.check(faulted, WorkspaceAccess)).rejects.toBe(failure);

		const malformed = permission.scope(base, {
			permissions: [WorkspaceAccess],
			checker: {
				maximumChecks: 1,
				async check() {
					return [];
				},
			},
		});
		await expect(permission.check(malformed, WorkspaceAccess)).rejects.toBeInstanceOf(permission.PermissionDecisionError);
	});

	it('does not call the evaluator after execution cancellation', async () => {
		const controller = new AbortController();
		controller.abort('request closed');
		const base = Object.freeze({ ...baseContext('permission-cancelled'), signal: controller.signal });
		let calls = 0;
		const ctx = permission.scope(base, {
			permissions: [WorkspaceAccess],
			checker: {
				maximumChecks: 1,
				async check() {
					calls++;
					return [{ allowed: true }];
				},
			},
		});

		await expect(permission.check(ctx, WorkspaceAccess)).rejects.toMatchObject({ name: 'ContextCancelledError' });
		expect(calls).toBe(0);
	});

	it('fails closed when no evaluator is configured', async () => {
		const base = baseContext('permission-unconfigured');
		const ctx = permission.scope(base, { permissions: [WorkspaceAccess] });
		await expect(permission.check(ctx, WorkspaceAccess)).rejects.toBeInstanceOf(permission.MissingPermissionCheckerError);
	});
});
