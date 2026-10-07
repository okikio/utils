import { deepStrictEqual as equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Temporal } from '@okikio/duration/temporal';
import { cursor, durationMilliseconds } from './pagination.ts';

describe('cursor calendar TTL without global Temporal installation', () => {
	it('preserves the exact calendar anchor for day, month, year and submillisecond durations', () => {
		for (
			const value of [{ days: 1 }, { months: 1 }, { years: 1 }, { years: 2, months: 1, days: 2 }, {
				hours: 1,
				milliseconds: 1,
				nanoseconds: 500,
			}, { days: -1 }]
		) {
			const duration = Temporal.Duration.from(value);
			equal(
				durationMilliseconds(duration),
				duration.total({ unit: 'milliseconds', relativeTo: Temporal.PlainDate.from('2000-01-01') }),
			);
		}
	});
	it('retains positive TTL admission and rejects zero/negative duration definitions', () => {
		const ttl = Temporal.Duration.from({ months: 1 });
		equal(cursor({ ttl }).ttl, ttl);
		throws(() => cursor({ ttl: Temporal.Duration.from({ seconds: 0 }) }), /positive/);
		throws(() => cursor({ ttl: Temporal.Duration.from({ seconds: -1 }) }), /positive/);
	});
});
