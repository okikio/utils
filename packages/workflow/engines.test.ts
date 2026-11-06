/** Durable dispatch borrows providers without taking over their host lifecycle. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as schema from '@okikio/schema';
import * as placement from './placement.ts';
import { bind } from './engines.ts';
import type { InvocationType } from './execution.ts';
import type { ActivityAttemptResultType } from './types.ts';

const Engine = engine.define({ id: 'bound' });
const TextSchema = schema.string();
const Work = activity.define({
	id: 'bound.work',
	version: '1',
	input: TextSchema,
	result: TextSchema,
	placement: engine.require(Engine),
});

describe('durable provider dispatch', () => {
	it('forwards exact physical placement, retains provider capacity and preserves busy/lost codes', async () => {
		await using ctx = context.create({ id: 'bound' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const result = Promise.withResolvers<ActivityAttemptResultType>();
		const seen: string[] = [];
		const location = placement.host({ id: 'executor', generation: 1 }, { pool: 'provider', id: 'host' });
		const binding = bind({
			engine: Engine,
			capacity: 2,
			reserved: 1,
			provider: {
				activities: [Work],
				async run(_ctx, attempt) {
					seen.push(attempt.origin.instructionPath);
					expect(attempt.location).toEqual(location);
					return await result.promise;
				},
			},
		});
		const invoke: InvocationType = {
			location,
			ctx,
			resources,
			engine: Engine,
			input: 'input',
			jobId: crypto.randomUUID(),
			attempt: 1,
			claim: {
				runId: crypto.randomUUID(),
				jobId: crypto.randomUUID(),
				generation: 1,
				epoch: 1,
				sequence: 1,
				hostId: 'host',
				hostGeneration: 1,
			},
			origin: {
				workflowId: 'parent',
				workflowVersion: '1',
				runId: 'saved',
				instructionPath: '2:/branch/0:',
				instructionFingerprint: 'saved',
			},
		};
		expect(binding.available(false)).toBe(true);
		const ordinary = binding.activities[0]!.invoke(invoke);
		expect(binding.available(false)).toBe(false);
		expect(binding.available(true)).toBe(true);
		const cleanup = binding.activities[0]!.invoke(invoke);
		expect(binding.available(true)).toBe(false);
		result.resolve({ type: 'success', value: 'done' });
		expect(await Promise.all([ordinary, cleanup])).toEqual(['done', 'done']);
		expect(seen).toEqual(['2:/branch/0:', '2:/branch/0:']);
		for (const code of ['busy', 'lost'] as const) {
			const unavailable = bind({
				engine: Engine,
				capacity: 1,
				provider: {
					activities: [Work],
					async run() {
						return { type: 'lost', code, reason: new Error(code) };
					},
				},
			});
			await expect(unavailable.activities[0]!.invoke(invoke)).rejects.toMatchObject({ code: `host_${code}` });
		}
		expect(binding.available(false)).toBe(true);
	});
	it('rejects invalid capacity before any dispatch', () => {
		const provider = {
			activities: [Work],
			async run(): Promise<ActivityAttemptResultType> {
				throw new Error('Must not run.');
			},
		};
		expect(() => bind({ engine: Engine, provider, capacity: 2, reserved: 2 })).toThrow(RangeError);
		expect(() => bind({ engine: Engine, provider, capacity: 0 })).toThrow(RangeError);
	});
	it('snapshots the validated capacity and provider instead of retaining mutable assembly options', () => {
		const provider = {
			activities: [Work],
			async run(): Promise<ActivityAttemptResultType> {
				throw new Error('Must not run.');
			},
		};
		const options = { engine: Engine, provider, capacity: 2, reserved: 1 };
		const binding = bind(options);
		options.capacity = 500;
		options.reserved = 0;
		options.provider = { ...provider };
		expect(binding.binding.capacity).toBe(2);
		expect(binding.binding.reserved).toBe(1);
		expect(binding.binding.provider).toBe(provider);
		expect(Object.isFrozen(binding.binding)).toBe(true);
	});
});
