import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as requestContext from '@okikio/context';
import * as requirement from '@okikio/requirement';
import * as resilience from '@okikio/resilience';

import { resilience as resilienceHost, RetryableOperationError, retry as retryHost } from './resilience.ts';
import type { ServiceRequestState, ServiceResilienceHost } from './types.ts';

const owner = requestContext.create({
	id: 'request_test',
	signal: new AbortController().signal,
	clock: { now: () => Temporal.Instant.from('2026-08-02T00:00:00Z') },
});
const ctx = requirement.scope(owner);

const state = {
	request: new Request('https://api.example.invalid/imports'),
	host: {},
	ctx,
	input: {},
	resources: {} as ServiceRequestState['resources'],
	values: {} as ServiceRequestState['values'],
	operation: {} as ServiceRequestState['operation'],
} satisfies ServiceRequestState;

describe('service resilience runtimes', () => {
	it('does not invoke custom Error message accessors while wrapping retryable failures', () => {
		let reads = 0;
		const cause = new Error();
		Object.defineProperty(cause, 'message', {
			configurable: true,
			get() {
				reads++;
				throw new Error('message getter must not run');
			},
		});
		const wrapped = new RetryableOperationError(cause);
		expect(wrapped.message).toBe('Error');
		expect(reads).toBe(0);
	});

	it('retries only explicitly classified failures', async () => {
		let attempts = 0;
		const runtime = retryHost();
		const result = await runtime.run([
			resilience.retry({ maximumAttempts: 3, initialDelay: { milliseconds: 1 }, maximumDelay: { milliseconds: 1 }, jitter: false }),
		], state, () => {
			attempts += 1;
			if (attempts < 3) throw new RetryableOperationError(new Error('temporary'));
			return Promise.resolve(new Response('ok'));
		});
		expect(result).toBeInstanceOf(Response);
		expect(attempts).toBe(3);
	});

	it('does not retry ordinary failures', async () => {
		let attempts = 0;
		const runtime = retryHost();
		await expect(runtime.run([
			resilience.retry({ maximumAttempts: 3, initialDelay: { milliseconds: 1 }, maximumDelay: { milliseconds: 1 }, jitter: false }),
		], state, () => {
			attempts += 1;
			throw new Error('not classified');
		})).rejects.toThrow('not classified');
		expect(attempts).toBe(1);
	});

	it('composes focused runtimes in policy order', async () => {
		const events: string[] = [];
		const runtime = (type: 'idempotency' | 'retry'): ServiceResilienceHost => ({
			supports: (policy) => policy.type === type,
			async run(_policies, _state, next) {
				events.push(`${type}:before`);
				const result = await next();
				events.push(`${type}:after`);
				return result;
			},
		});
		const combined = resilienceHost(runtime('idempotency'), runtime('retry'));
		await combined.run([resilience.idempotent(), resilience.retry()], state, async () => {
			events.push('operation');
			return new Response('ok');
		});
		expect(events).toEqual([
			'idempotency:before',
			'retry:before',
			'operation',
			'retry:after',
			'idempotency:after',
		]);
	});
});
