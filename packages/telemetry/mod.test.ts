import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as telemetry from './mod.ts';

const fixed = () => '2026-09-09T00:00:00.000Z';

describe('@okikio/telemetry', () => {
	it('merges explicit scope fields and projects faults without throwing through reporter failures', async () => {
		const failures: unknown[] = [];
		const scope = telemetry.create({ report() { throw new Error('sink failed'); } }, {
			fields: { request_id: 'request-1' },
			now: fixed,
			onReporterError: (error) => { failures.push(error); },
		});
		const error = new Error('boom');
		const value = await scope.child({ operation_id: 'users.read' }).report({
			name: 'service.request.failed',
			level: 'error',
			message: 'Request failed.',
			fields: { status: 500 },
			error,
		});
		expect(value.at).toBe(fixed());
		expect(value.fields).toEqual({ request_id: 'request-1', operation_id: 'users.read', status: 500 });
		expect(value.error).toBe(error);
		expect(value.fault).toMatchObject({ name: 'Error', message: 'boom' });
		expect(failures).toHaveLength(1);
	});

	it('buffers low-level history per correlation key and flushes it before the failure', async () => {
		const memory = telemetry.memory();
		const buffered = telemetry.buffer(memory, { capacity: 2 });
		const scope = telemetry.create(buffered, { fields: { trace_id: 'trace-1' }, now: fixed });
		await scope.report({ name: 'queue.claim.acquired', level: 'debug' });
		await scope.report({ name: 'worker.request.started', level: 'trace' });
		await scope.report({ name: 'worker.call.started', level: 'debug' });
		expect(memory.records).toHaveLength(0);
		await scope.report({ name: 'worker.request.failed', level: 'error' });
		expect(memory.records.map((event) => event.name)).toEqual([
			'worker.request.started',
			'worker.call.started',
			'worker.request.failed',
		]);
	});

	it('allows successful correlation histories to be discarded without emission', async () => {
		const memory = telemetry.memory();
		const buffered = telemetry.buffer(memory);
		const scope = telemetry.create(buffered, { fields: { request_id: 'request-1' }, now: fixed });
		await scope.report({ name: 'service.request.started', level: 'debug' });
		expect(buffered.keys).toEqual(['request-1']);
		buffered.discard('request-1');
		await buffered.flush();
		expect(memory.records).toEqual([]);
	});

	it('fans out to every reporter before surfacing aggregate delivery failure', async () => {
		const memory = telemetry.memory();
		const output = telemetry.fanout(memory, { report() { throw new Error('expected'); } });
		await expect(output.report(telemetry.event({ name: 'test.event' }, {}, fixed))).rejects.toBeInstanceOf(AggregateError);
		expect(memory.records).toHaveLength(1);
	});

	it('rejects unsafe structured fields without invoking accessors', () => {
		let reads = 0;
		const fields = Object.create(null) as Record<string, telemetry.Value>;
		Object.defineProperty(fields, 'secret', { enumerable: true, get() { reads += 1; return 'secret'; } });
		expect(() => telemetry.event({ name: 'test.event', fields }, {}, fixed)).toThrow('cannot be an accessor');
		expect(reads).toBe(0);
	});

	it('snapshots nested fields so later caller mutation cannot rewrite emitted history', async () => {
		const output = telemetry.memory();
		const nested = { attempts: [1, 2] };
		const scope = telemetry.create(output, { now: fixed });
		await scope.report({ name: 'test.snapshot', fields: { nested } });
		nested.attempts.push(3);
		expect(output.records[0]?.fields).toEqual({ nested: { attempts: [1, 2] } });
	});
});
