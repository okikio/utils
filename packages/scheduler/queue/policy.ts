/** Shared admission and retention policy used by memory and persistent queues. @module */
import type { MemoryQueueOptions, QueueInspectOptions } from './types.ts';
import { elapsed as fixedMilliseconds } from '@okikio/duration';

/** Normalize limits before either implementation acquires or changes state. */
export function policy(
	options: Pick<MemoryQueueOptions, 'capacity' | 'retention'>,
): Readonly<{ capacity: number; retention: Readonly<{ limit: number; milliseconds: number }> }> {
	const capacity = integer(options.capacity ?? 10_000, 'queue capacity');
	const limit = integer(options.retention?.limit ?? 10_000, 'terminal retention limit');
	const milliseconds = elapsed(options.retention?.duration ?? { hours: 24 }, 'terminal retention duration');
	return Object.freeze({ capacity, retention: Object.freeze({ limit, milliseconds }) });
}

/** Convert an elapsed duration without silently applying calendar arithmetic to a lease. */
export function elapsed(
	value: Temporal.Duration | Temporal.DurationLike | string,
	label: string,
	zero = false,
): number {
	const milliseconds = fixedMilliseconds(value);
	if (!Number.isSafeInteger(milliseconds) || milliseconds < (zero ? 0 : 1)) {
		throw new RangeError(`${label} must be ${zero ? 'non-negative' : 'positive'} whole milliseconds.`);
	}
	return milliseconds;
}

/** Keep explicit maintenance bounded even when a queue has accumulated many expired records. */
export function pruneLimit(value = 1000): number {
	if (integer(value, 'prune limit') > 1000) throw new RangeError('Prune limit cannot exceed 1,000.');
	return value;
}

/** Validate counts before a storage constraint or local allocation relies on them. */
function integer(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive safe integer.`);
	return value;
}

/** Validate inspection before provider access. Cursor text is bounded before parsing. */
export function inspection(options: QueueInspectOptions): void {
	if (
		integer(options.limit, 'inspection limit') > 1000 ||
		integer(options.maximumScanned, 'inspection scan limit') > 10000 || options.maximumScanned < options.limit
	) throw new RangeError('Invalid queue inspection limits.');
	if (
		options.state !== undefined && !['queued', 'claimed', 'completed', 'failed', 'cancelled'].includes(options.state)
	) throw new TypeError('Invalid queue inspection state.');
	if (options.cursor !== undefined && (typeof options.cursor !== 'string' || options.cursor.length > 2048)) {
		throw new TypeError('Invalid queue inspection cursor.');
	}
}
/** Bind a finite continuation to the actual provider identity, contract and state filter. No authority is encoded. */
export function cursor(identity: string, state: string | undefined, after: string, through: string): string {
	return JSON.stringify([1, identity, state ?? null, after, through]);
}
/** Reject malformed, mismatched, negative and out-of-order positions without echoing private cursor text. */
export function position(value: string, identity: string, state?: string): readonly [bigint, bigint] {
	let data: unknown;
	try {
		data = JSON.parse(value);
	} catch {
		throw new TypeError('Invalid queue inspection cursor.');
	}
	if (
		!Array.isArray(data) || data.length !== 5 || data[0] !== 1 || data[1] !== identity || data[2] !== (state ?? null) ||
		typeof data[3] !== 'string' || typeof data[4] !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(data[3]) ||
		!/^(0|[1-9][0-9]{0,18})$/.test(data[4])
	) throw new TypeError('Invalid queue inspection cursor.');
	const after = BigInt(data[3]), through = BigInt(data[4]);
	if (after > through || through > 9223372036854775807n) throw new TypeError('Invalid queue inspection cursor.');
	return [after, through];
}
