/** Observational failures must never become execution failures. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as telemetry from './mod.ts';
import * as instrument from './instrument.ts';

describe('portable execution instrumentation', () => {
	it('uses explicit injection and preserves exact results and thrown values', async () => {
		expect(instrument.get()).toBe(instrument.noop);
		const output = instrument.create();
		expect(instrument.get({ instrument: output })).toBe(output);
		const value = {};
		expect(await output.span('fixture.value', {}, async () => value)).toBe(value);
		let calls = 0;
		let caught = false;
		try {
			await output.span('fixture.failure', {}, async () => {
				calls++;
				throw undefined;
			});
		} catch (reason) {
			caught = true;
			expect(reason).toBeUndefined();
		}
		expect(caught).toBe(true);
		expect(calls).toBe(1);
		await output.flush();
	});

	it('reports duration and explicitly handled failures without exporting the reason', async () => {
		const reporter = telemetry.memory();
		let clock = 0;
		const output = instrument.create({ reporter, monotonic: () => clock++ * 7 });
		const result = await output.span('fixture.write', { job_id: 'a', absent: undefined }, async (observation) => {
			observation.fail(new TypeError('private payload'));
			return 'denied';
		});
		await output.flush();
		expect(result).toBe('denied');
		expect(reporter.records.map((entry) => entry.name)).toEqual([
			'fixture.write.started',
			'operation.failed',
			'fixture.write.finished',
		]);
		expect(reporter.records[2]?.fields).toEqual({ job_id: 'a', outcome: 'error', duration_ms: 7 });
		expect(JSON.stringify(reporter.records)).not.toContain('private payload');
		expect(output.capture()).toBeUndefined();
	});

	it('bounds slow and reentrant delivery without delaying work', async () => {
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let reports = 0;
		const output = instrument.create({
			maximumPending: 1,
			reporter: {
				report() {
					reports++;
					output.notice('fixture.reentrant');
					return held;
				},
			},
		});
		output.notice('fixture.held');
		expect(await output.span('fixture.work', {}, async () => 42)).toBe(42);
		expect(reports).toBe(1);
		expect(output.dropped).toBe(3);
		release();
		await output.flush();
	});

	it('contains broken reporters, clocks, fields, and failure observers', async () => {
		const output = instrument.create({
			reporter: {
				async report() {
					throw new Error('reporter');
				},
				async flush() {
					throw new Error('flush');
				},
			},
			onReporterError() {
				throw new Error('observer');
			},
			monotonic() {
				throw new Error('clock');
			},
		});
		const fields = {
			get hostile(): never {
				throw new Error('fields');
			},
		};
		expect(
			await output.span('fixture.work', fields, async (observation) => {
				observation.fail('handled');
				return 42;
			}),
		).toBe(42);
		const original = new Error('business');
		await expect(output.span('fixture.throw', fields, async () => {
			throw original;
		})).rejects.toBe(original);
		await output.flush();
	});
});
