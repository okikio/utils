/** Explicit, validated rewrites of persisted expected failures. @module */
import { create, decode, encode } from './mod.ts';
import type { Data, Definition, Encoded, Occurrence } from './types.ts';

/**
 * One application-owned transition between distinct durable failure identities.
 * Keep the old definition available for as long as stored records can use it.
 * The converter receives validated old data and returns input for the new schema.
 * It must not publish external effects: storage commit and retry belong to the caller.
 */
export interface Migration<From extends Definition, To extends Definition> {
	/** Trusted historical schema used to check the saved payload before conversion. */
	readonly from: From;
	/** Trusted replacement schema. A breaking change must have a new durable ID. */
	readonly to: To;
	/** Pure conversion; asynchronous schema or conversion work is supported. */
	readonly convert: (data: Data<From>, occurrence: Occurrence<From>) => unknown | PromiseLike<unknown>;
}

/**
 * Rewrite one saved failure after checking both historical and current schemas.
 *
 * The message is retained; local causes never enter the returned representation.
 * Unknown IDs, invalid old data, failed conversion, and invalid new data reject.
 * No record is written and no fallback migration is selected automatically.
 * Apply multiple transitions explicitly when an application supports several eras.
 */
export async function migrate<From extends Definition, To extends Definition>(
	value: unknown,
	migration: Migration<From, To>,
): Promise<Encoded> {
	if (migration.from.id === migration.to.id) {
		throw new TypeError('A failure migration requires distinct historical and replacement IDs.');
	}
	const previous = await decode(value, [migration.from]);
	const data = await migration.convert(previous.data, previous);
	const current = await create(migration.to, { data, message: previous.message });
	return await encode(current);
}
