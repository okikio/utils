import { minimum, sum } from './arithmetic.ts';
import { create } from './format.ts';

const value: Temporal.Duration = sum(['PT1S'], { mode: 'elapsed', maximumItems: 1 });
const calendar: Temporal.Duration = minimum('P1D', 'PT24H', { mode: 'calendar', relativeTo: '2026-01-01' });
function rejectedPolicies(): void {
	// @ts-expect-error Calendar arithmetic requires an explicit reference.
	minimum('P1D', 'PT24H', { mode: 'calendar' });
	// @ts-expect-error A bounded sum requires an item limit.
	sum(['PT1S'], { mode: 'elapsed' });
	// @ts-expect-error Formatting never silently chooses the ambient locale.
	create({ fallback: 'iso' });
}
void [value, calendar, rejectedPolicies];
