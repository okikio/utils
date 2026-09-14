import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as telemetry from './mod.ts';
import * as logtape from './logtape.ts';

const fixed = () => '2026-09-09T00:00:00.000Z';

describe('@okikio/telemetry/logtape', () => {
	it('maps stable telemetry severity and fields into a configured logger surface', async () => {
		const records: unknown[] = [];
		const logger = {
			trace: (...args: unknown[]) => records.push(['trace', ...args]),
			debug: (...args: unknown[]) => records.push(['debug', ...args]),
			info: (...args: unknown[]) => records.push(['info', ...args]),
			warn: (...args: unknown[]) => records.push(['warn', ...args]),
			error: (...args: unknown[]) => records.push(['error', ...args]),
			fatal: (...args: unknown[]) => records.push(['fatal', ...args]),
		};
		await telemetry.create(logtape.reporter(logger), { now: fixed, fields: { request_id: 'request-1' } }).report({
			name: 'service.request.failed',
			level: 'error',
			message: 'Request failed.',
		});
		expect(records[0]).toEqual([
			'error',
			'Request failed.',
			{ event: 'service.request.failed', telemetry_at: fixed(), request_id: 'request-1' },
		]);
	});

	it('uses implicit context only when the host explicitly supplies a context bridge', () => {
		const observed: unknown[] = [];
		const result = logtape.run({
			withContext(fields, callback) {
				observed.push(fields);
				return callback();
			},
		}, { trace_id: 'trace-1' }, () => 42);
		expect(result).toBe(42);
		expect(observed).toEqual([{ trace_id: 'trace-1' }]);
	});
});
