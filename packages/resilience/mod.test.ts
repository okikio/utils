import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as resilience from './mod.ts';

describe('resilience policies', () => {
	it('deduplicates the same imported policy and rejects conflicting values', () => {
		const timeout = resilience.timeout({ seconds: 5 });
		const repeated = resilience.validate([timeout, timeout]);
		expect(repeated.valid).toBe(true);
		if (repeated.valid) expect(repeated.policies).toEqual([timeout]);

		const conflict = resilience.validate([timeout, resilience.timeout({ seconds: 10 })]);
		expect(conflict.valid).toBe(false);
		if (!conflict.valid) expect(conflict.issues[0]?.code).toBe('conflicting-policy');
	});

	it('bounds caller-controlled idempotency keys in the portable policy', () => {
		expect(resilience.idempotent().maximumKeyBytes).toBe(256);
		expect(resilience.idempotent({ maximumKeyBytes: 64 }).maximumKeyBytes).toBe(64);
		expect(() => resilience.idempotent({ maximumKeyBytes: 0 })).toThrow(TypeError);
	});

	it('rejects retries for unsafe operations without idempotency', () => {
		const invalid = resilience.validate(resilience.retry(), { safety: 'unsafe' });
		expect(invalid.valid).toBe(false);
		if (!invalid.valid) expect(invalid.issues[0]?.code).toBe('unsafe-retry');
		const valid = resilience.validate([resilience.idempotent(), resilience.retry()], { safety: 'unsafe' });
		expect(valid.valid).toBe(true);
	});

	it('computes reusable retry delay without owning timer or entropy behavior', () => {
		const policy = resilience.retry({
			initialDelay: { seconds: 1 },
			maximumDelay: { seconds: 5 },
			multiplier: 2,
			jitter: false,
		});
		expect(resilience.retryDelay(policy, 1).total('milliseconds')).toBe(1_000);
		expect(resilience.retryDelay(policy, 2).total('milliseconds')).toBe(2_000);
		expect(resilience.retryDelay(policy, 4).total('milliseconds')).toBe(5_000);

		const jittered = resilience.retry({
			initialDelay: { seconds: 1 },
			maximumDelay: { seconds: 5 },
			multiplier: 2,
			jitter: true,
		});
		expect(resilience.retryDelay(jittered, 2, { jitter: 0 }).total('milliseconds')).toBe(1_000);
		expect(resilience.retryDelay(jittered, 2, { jitter: 1 }).total('milliseconds')).toBe(3_000);
		expect(() => resilience.retryDelay(jittered, 2)).toThrow(TypeError);
		expect(() => resilience.retryDelay(policy, 0)).toThrow(TypeError);
	});

	it('classifies runtime ownership and lifecycle stage independently', () => {
		const policies = [
			[resilience.bodyLimit(1_024), 'server', 'request'],
			[resilience.timeout({ seconds: 1 }), 'server', 'request'],
			[resilience.idempotent(), 'adapter', 'admission'],
			[resilience.rateLimit({ limit: 10, window: { minutes: 1 } }), 'adapter', 'admission'],
			[resilience.bulkhead({ concurrency: 2 }), 'adapter', 'admission'],
			[resilience.retry(), 'adapter', 'operation'],
			[resilience.circuitBreaker(), 'adapter', 'operation'],
		] as const;

		for (const [policy, owner, stage] of policies) {
			expect(resilience.owner(policy)).toBe(owner);
			expect(resilience.stage(policy)).toBe(stage);
		}
	});

	it('validates limits and produces deterministic documentation', () => {
		expect(() => resilience.bodyLimit(0)).toThrow(TypeError);
		expect(resilience.document([
			resilience.bodyLimit(1_024),
			resilience.bulkhead({ concurrency: 4, queue: 8 }),
		])).toEqual([
			{ type: 'body-limit', owner: 'server', stage: 'request', configuration: { bytes: 1_024 } },
			{ type: 'bulkhead', owner: 'adapter', stage: 'admission', configuration: { concurrency: 4, queue: 8 } },
		]);
	});
});
