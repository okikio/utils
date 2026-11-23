/** The request and response that cross between a hash pool and its workers. @module */
import * as schema from '@okikio/schema';
import * as worker from '@okikio/worker/thread';
import type { FamilyType } from '../../_wasm/registry.ts';

/** The families a pool can run, in the order the worker loads them. */
export const families: readonly FamilyType[] = Object.freeze([
	'sha2',
	'sha3',
	'blake',
	'legacy',
	'national',
	'contest',
	'fsb',
	'mac',
	'fast',
	'checksum',
]);

const bytes = schema.guard(
	(value: unknown): value is Uint8Array => value instanceof Uint8Array,
	'Expected a Uint8Array.',
);

/**
 * One batch: hash every input with the same algorithm and options. Input `i` is `data[offsets[2i], offsets[2i+1])`,
 * so thousands of inputs cross the boundary as two objects.
 */
export interface BatchType {
	readonly family: string;
	readonly name: string;
	readonly data: Uint8Array;
	readonly offsets: Uint32Array;
	readonly key?: Uint8Array | undefined;
	readonly length?: number | undefined;
	/** For one BLAKE3 subtree: its offset and mode, as `tree.ts` encodes them. The batch then has one input. */
	readonly subtree?: Uint8Array | undefined;
}

/** The digests of one batch, in input order, end to end in one buffer. Every digest of a batch has the same size. */
export interface DigestsType {
	readonly digests: Uint8Array;
}

/** Validated on both sides of the worker boundary. */
export const protocol: worker.WorkerProtocol<BatchType, DigestsType> = worker.protocol({
	request: schema.object({
		family: schema.string(),
		name: schema.string(),
		data: bytes,
		offsets: schema.guard(
			(value: unknown): value is Uint32Array => value instanceof Uint32Array && value.length % 2 === 0,
			'Expected a Uint32Array of start and end offsets.',
		),
		key: schema.optional(bytes),
		length: schema.optional(schema.number({ integer: true, minimum: 0 })),
		subtree: schema.optional(bytes),
	}),
	response: schema.object({ digests: bytes }),
});
