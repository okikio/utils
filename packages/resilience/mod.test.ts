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

	it('assigns policies to explicit admission and operation stages', () => {
		expect(resilience.stage(resilience.idempotent())).toBe('admission');
		expect(resilience.stage(resilience.rateLimit({ limit: 10, window: { minutes: 1 } }))).toBe('admission');
		expect(resilience.stage(resilience.bulkhead({ concurrency: 2 }))).toBe('admission');
		expect(resilience.stage(resilience.retry())).toBe('operation');
		expect(resilience.stage(resilience.circuitBreaker())).toBe('operation');
		expect(() => resilience.stage(resilience.timeout({ seconds: 1 }))).toThrow(TypeError);
	});

	it('validates limits and produces deterministic documentation', () => {
		expect(() => resilience.bodyLimit(0)).toThrow(TypeError);
		expect(resilience.document([
			resilience.bodyLimit(1_024),
			resilience.bulkhead({ concurrency: 4, queue: 8 }),
		])).toEqual([
			{ type: 'body-limit', configuration: { bytes: 1_024 } },
			{ type: 'bulkhead', configuration: { concurrency: 4, queue: 8 } },
		]);
	});
});
