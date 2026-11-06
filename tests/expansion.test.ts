// @installed-consumer: Run this public-import scenario against packed artifacts too.
/** Public-import scenarios also execute against physically installed ESM archives. @module */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as result from '@okikio/result';
import * as asyncResult from '@okikio/result/async';
import { once } from '@okikio/dispose/once';
import * as capacity from '@okikio/scheduler/capacity';
import * as iterable from '@okikio/collection/iterable';
import * as arithmetic from '@okikio/duration/arithmetic';
import * as formatting from '@okikio/duration/format';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { InstantSchema } from '@okikio/schema/time';
import * as streams from '@okikio/streams';
import * as context from '@okikio/context';
import * as effect from '@okikio/capability/effect';
import * as meter from '@okikio/capability/effect/meter';
import { entitlement, permission, role } from '@okikio/authz';
import { clipboard, files, gamepad, pointer, text } from '@okikio/input';
import * as supervisor from '@okikio/worker/supervisor';
import type { WorkerTerminationType } from '@okikio/worker/thread';

describe('selected expansion through installed public boundaries', () => {
	it('composes bounded values, admission, timed batches and authoritative meter acceptance', async () => {
		await using owner = context.create({ id: 'expansion' });
		assert.deepEqual(await asyncResult.map(result.ok(2), async (value) => value * 3), result.ok(6));
		assert.deepEqual([...iterable.unique([1, 1, 2], (value) => value, { maximumItems: 3, maximumKeys: 2 })], [1, 2]);
		assert.equal(arithmetic.sum(['PT1S', 'PT2S'], { mode: 'elapsed', maximumItems: 2 }).toString(), 'PT3S');
		assert.ok(formatting.create({ locale: 'en-US', fallback: 'iso' }).format('PT3S').length > 0);
		const LazySchema = schema.lazy(() => schema.string(), { maximumDepth: 2, maximumNodes: 2 });
		assert.equal(LazySchema.parse('valid'), 'valid');
		assert.equal(schema.inspect(LazySchema).output.supported, false);
		assert.equal(
			await codec.encode(InstantSchema, await codec.decode(InstantSchema, '1969-12-31T23:59:59.999999999Z')),
			'1969-12-31T23:59:59.999999999Z',
		);
		const admission = capacity.create({ writers: 1 });
		const lease = capacity.tryAcquire(admission, { writers: 1 });
		assert.notEqual(lease, undefined);
		assert.equal(capacity.inspect(admission, { writers: 1 }, { maximumReasons: 1 }).status, 'unavailable');
		const batches = await Array.fromAsync(
			streams.batch([1, 2], { maximumItems: 2, maximumDelay: 10, clock: owner.clock }),
		);
		assert.deepEqual(batches, [[1, 2]]);
		const Count = meter.define({ id: 'count' });
		const accepted: string[] = [];
		const ctx = effect.scope(owner, {
			effects: [meter.effect(Count)],
			emitter: {
				async emit(_ctx, occurrence) {
					accepted.push(occurrence.key);
				},
			},
		});
		assert.equal(
			(await meter.recordBatch(ctx, Count, [{ key: 'one', value: 1 }], { maximumItems: 1, maximumBytes: 1024 })).status,
			'accepted',
		);
		assert.deepEqual(accepted, ['one']);
		const release = once(() => lease!.release());
		assert.equal(release.close(), release.close());
		await release.close();
	});
	it('keeps role target policy and entitlement faults distinct while projecting Input values', async () => {
		await using owner = context.create({ id: 'tenant' });
		const Read = permission.define({ id: 'read' });
		const Member = role.define({ id: 'member', permissions: [Read] });
		const checker = role.checker([Member], {
			maximumRoles: 1,
			maximumGrants: 1,
			maximumChecks: 1,
			policy: (ctx) => ({ allowed: ctx.id === 'tenant' }),
		});
		assert.deepEqual(await checker.check(owner, [{ definition: Read, target: undefined }]), [{ allowed: true }]);
		const Feature = entitlement.define({ id: 'feature' });
		assert.equal(
			(await entitlement.explain(
				owner,
				{
					async check() {
						return [{ error: undefined }];
					},
				},
				[entitlement.require(Feature)],
				{ maximumChecks: 1, maximumReasonLength: 0 },
			)).status,
			'fault',
		);
		assert.equal(pointer.wheel({ deltaX: 0, deltaY: 1, deltaZ: 0, deltaMode: 1 }, { unit: 'native' }).unit, 'lines');
		assert.equal(
			text.edit({ value: '' }, { start: 0, end: 0 }, '', { composing: false, selection: 'end', maximumLength: 1 })
				.status,
			'unsupported',
		);
		const selected = await Array.fromAsync(
			files.walk([{ name: 'file', kind: 'file' as const }], {
				children: () => [],
				async file() {
					return { name: 'file', type: '', size: 1 };
				},
			}, { maximumDepth: 0, maximumEntries: 1, maximumFiles: 1, maximumBytes: 1 }),
		);
		assert.equal(selected[0]?.path, 'file');
		assert.deepEqual(await clipboard.attempt({}, { maximumItems: 1 }), { status: 'unsupported' });
		assert.equal(
			gamepad.map({ id: 'pad', index: 0, mapping: '', axes: [0.5], buttons: [] }, [{
				name: 'move',
				kind: 'axis',
				index: 0,
			}], { maximumBindings: 1, missing: 'reject' }).move,
			0.5,
		);
	});
	it('joins supervisor termination independently of its Observable status projection', async () => {
		await using owner = context.create({ id: 'supervised' });
		const terminal = Promise.withResolvers<WorkerTerminationType>();
		let calls = 0;
		await using lifecycle = supervisor.create(
			owner,
			() => ({
				closed: terminal.promise,
				async request(_ctx: context.Context, value: number) {
					calls++;
					return value;
				},
				async stop(reason?: unknown) {
					terminal.resolve({ status: 'stopped', forced: false, reason });
				},
			}),
			{ maximumRestarts: 0, maximumRequests: 1, backoff: 0 },
		);
		await lifecycle.ready;
		assert.equal(await lifecycle.request(owner, 3), 3);
		await lifecycle.stop('done');
		assert.equal((await lifecycle.closed).status, 'stopped');
		assert.equal(calls, 1);
	});
});
