/** Standard, bounded progress snapshots. Progress describes work; it never proves completion. @module */
import * as state from '@okikio/context/state';
import * as effect from '@okikio/capability/effect';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';

/** Counters and a short explanation, with optional JSON data owned by the application. */
export interface ProgressType {
	/** Finished units so far. Omit when they cannot be counted; never use this as a completion receipt. */
	readonly completed?: number;
	/** Expected units in the same unit as completed. Omit when the final size is unknown. */
	readonly total?: number;
	/** Label such as files or bytes, so the displayed counts have a concrete meaning. */
	readonly unit?: string;
	/** Short explanation of the current work, such as Reading headers. */
	readonly message?: string;
	/** Optional JSON-compatible display details, bounded by ProgressSchema. Keep secrets out of observations. */
	readonly data?: unknown;
}

/** Validate bounded progress with the same owned schema and JSON rules used by other capabilities. */
const ProgressValue: schema.JsonReader<
	{
		completed?: number | undefined;
		total?: number | undefined;
		unit?: string | undefined;
		message?: string | undefined;
		data?: schema.JsonValue | undefined;
	},
	schema.ObjectInput<
		{
			readonly completed: schema.JsonReader<number | undefined, number | undefined>;
			readonly total: schema.JsonReader<number | undefined, number | undefined>;
			readonly unit: schema.JsonReader<string | undefined, string | undefined>;
			readonly message: schema.JsonReader<string | undefined, string | undefined>;
			readonly data: schema.JsonReader<schema.JsonValue | undefined, schema.JsonValue | undefined>;
		}
	>
> = schema.refine(
	schema.refine(
		schema.object({
			completed: schema.optional(schema.number({ minimum: 0 })),
			total: schema.optional(schema.number({ minimum: 0 })),
			unit: schema.optional(schema.string({ maxLength: 2048 })),
			message: schema.optional(schema.string({ maxLength: 2048 })),
			data: schema.optional(schema.json({ maximumDepth: 64, maximumNodes: 65_536 })),
		}),
		(value) => value.completed === undefined || value.total === undefined || value.completed <= value.total,
		'Progress completed cannot exceed total.',
	),
	(value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536,
	'Progress exceeds 64 KiB.',
);

/** Publish one owned shallow snapshot; nested JSON data has its independently copied representation. */
export const ProgressSchema: schema.JsonReader<
	Readonly<schema.Output<typeof ProgressValue>>,
	schema.Input<typeof ProgressValue>
> = schema.transform(ProgressValue, (value) => Object.freeze(value));

/** Emit without a key. Each execution keeps the latest report and assigns its own revision. */
export const ProgressEffect: effect.EffectDefinition<
	'task.progress',
	codec.Codec<
		schema.Input<typeof ProgressSchema>,
		schema.Output<typeof ProgressSchema>,
		schema.Output<typeof ProgressSchema>,
		schema.Output<typeof ProgressSchema>
	>
> = effect.define({
	id: 'task.progress',
	description: 'Latest progress snapshot for one running operation.',
	value: codec.identity(ProgressSchema),
	delivery: 'latest',
});

/** Weighted observation only. A complete ratio never settles a Task or proves its cleanup succeeded. */
export interface CombinedProgressType {
	/** Fixed number of borrowed readers, bounded at construction. */
	readonly children: number;
	/** Readers with both completed and total counters. Zero-total/zero-completed is known empty work. */
	readonly known: number;
	/** Weighted ratio when every child has known counters; absent for empty or partially unknown groups. */
	readonly ratio: number | undefined;
}

/**
 * Combine explicitly weighted progress readers using Context's owned projection.
 * Unknown counters stay unknown; zero/zero contributes ratio one, not terminal success. Weights are
 * positive finite relative shares, independent of each child's unit or changing total. Ratios use
 * ordinary floating-point arithmetic; this is display data, never accounting or result authority.
 * Dispose the projection to release subscriptions without cancelling or closing borrowed readers.
 */
export function combine(
	readers: readonly state.Reader<ProgressType | undefined>[],
	options:
		& state.Options<CombinedProgressType>
		& Readonly<{
			/** One positive finite relative share per reader. The captured copy cannot be changed after construction. */
			readonly weights: readonly number[];
			/** Maximum retained reader references and owned subscriptions. */
			readonly maximumChildren: number;
		}>,
): state.Projection<CombinedProgressType> {
	if (
		!Number.isSafeInteger(options.maximumChildren) || options.maximumChildren < 0 ||
		readers.length > options.maximumChildren
	) throw new RangeError('Progress readers exceed maximumChildren.');
	if (options.weights.length !== readers.length) throw new TypeError('Progress requires one weight per reader.');
	const weights = [...options.weights];
	if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
		throw new RangeError('Progress weights must be positive finite numbers.');
	}
	// Normalize before summing so several individually finite weights cannot overflow their total.
	let maximum = 0;
	for (const weight of weights) maximum = Math.max(maximum, weight);
	const normalized = weights.map((weight) => weight / maximum);
	const totalWeight = normalized.reduce((total, weight) => total + weight, 0);
	return state.combine(readers, (values): CombinedProgressType => {
		let known = 0;
		let ratio = 0;
		for (let index = 0; index < values.length; index++) {
			const value = values[index];
			if (value === undefined) continue;
			if (
				(value.completed !== undefined && (!Number.isFinite(value.completed) || value.completed < 0)) ||
				(value.total !== undefined && (!Number.isFinite(value.total) || value.total < 0))
			) {
				throw new RangeError('Invalid progress counters.');
			}
			if (value.completed === undefined || value.total === undefined) continue;
			if (
				!Number.isFinite(value.completed) || !Number.isFinite(value.total) || value.completed < 0 || value.total < 0 ||
				value.completed > value.total
			) throw new RangeError('Invalid progress counters.');
			known++;
			ratio += normalized[index]! * (value.total === 0 ? 1 : value.completed / value.total);
		}
		return Object.freeze({
			children: values.length,
			known,
			ratio: values.length > 0 && known === values.length ? Math.min(1, ratio / totalWeight) : undefined,
		});
	}, {
		...options,
		equal: options.equal ??
			((left, right) => left.children === right.children && left.known === right.known && left.ratio === right.ratio),
	});
}
