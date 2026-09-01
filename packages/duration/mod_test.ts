import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as duration from './mod.ts';

describe('@okikio/duration', () => {
	it('converts fixed-unit durations to milliseconds', () => {
		expect(duration.milliseconds({ seconds: 2, milliseconds: 250 })).toBe(2_250);
	});

	it('uses one deterministic calendar anchor for calendar units', () => {
		expect(duration.milliseconds({ months: 1 })).toBe(31 * 24 * 60 * 60 * 1_000);
		expect(duration.compare({ months: 1 }, { days: 31 })).toBe(0);
	});

	it('preserves ordering for negative and positive durations', () => {
		expect(duration.compare({ milliseconds: -1 }, { milliseconds: 0 })).toBeLessThan(0);
		expect(duration.compare({ seconds: 1 }, { milliseconds: 999 })).toBeGreaterThan(0);
	});
});
