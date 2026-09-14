import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as telemetry from './mod.ts';
import * as lifecycle from './lifecycle.ts';

const fixed = () => '2026-09-09T00:00:00.000Z';

describe('@okikio/telemetry/lifecycle', () => {
	it('maps queue claim expiry and retry into stable warning records', async () => {
		const output = telemetry.memory();
		const observe = lifecycle.queue(telemetry.create(output, { now: fixed }), { queue_id: 'research' });
		await observe({ type: 'claim-expired', itemId: 'item-1', claimId: 'claim-1' });
		await observe({ type: 'retried', itemId: 'item-1', claimId: 'claim-1', availableAt: '2026-09-09T00:01:00Z' });
		expect(output.records.map((event) => [event.name, event.level])).toEqual([
			['queue.claim.expired', 'warning'],
			['queue.item.retried', 'warning'],
		]);
		expect(output.records[0]?.fields).toMatchObject({ queue_id: 'research', item_id: 'item-1', claim_id: 'claim-1' });
	});

	it('projects arbitrary Worker faults through the bounded fault contract', async () => {
		const output = telemetry.memory();
		const observe = lifecycle.worker(telemetry.create(output, { now: fixed }), { worker_id: 'worker-1' });
		await observe({ type: 'fault', id: 'request-1', reason: new Error('worker boom') });
		expect(output.records[0]).toMatchObject({
			name: 'worker.request.faulted',
			level: 'error',
			fields: { worker_id: 'worker-1', request_id: 'request-1' },
			fault: { name: 'Error', message: 'worker boom' },
		});
	});

	it('distinguishes clean and failed process exits', async () => {
		const output = telemetry.memory();
		const observe = lifecycle.process(telemetry.create(output, { now: fixed }), { process_id: 42 });
		await observe({ type: 'exited', code: 0, success: true });
		await observe({ type: 'exited', code: 1, success: false, signal: 'SIGTERM' });
		expect(output.records.map((event) => [event.level, event.fields.exit_code])).toEqual([
			['info', 0],
			['error', 1],
		]);
	});

	it('maps process-channel calls without observing protocol payloads', async () => {
		const output = telemetry.memory();
		const observe = lifecycle.channel(telemetry.create(output, { now: fixed }), { process_id: 42 });
		await observe({ type: 'call', id: 'request-2', callId: 'call-3' });
		expect(output.records[0]).toMatchObject({
			name: 'process.channel.request.call',
			fields: { process_id: 42, request_id: 'request-2', call_id: 'call-3' },
		});
	});
});
