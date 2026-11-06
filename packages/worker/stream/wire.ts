/** Version-one dedicated-port byte streaming. Existing RPC and notices use different envelopes. @module */
import * as schema from '@okikio/schema';

/** Every frame identifies one stream; exact version matching is compatibility, never authentication. */
const identity = {
	/** Fixed family prevents accidental interpretation of existing RPC messages. */
	protocol: schema.literal('okikio.worker.bytes'),
	/** Revision one uses stop-and-wait receive credits and joined terminal receipts. */
	version: schema.literal(1),
	/** Application correlation chosen by the receiver; one dedicated port carries only this ID. */
	id: schema.string({ minLength: 1, maxLength: 128, pattern: /^[A-Za-z0-9_.:-]+$/ }),
};
/** Sequence and byte counters never exceed exact JavaScript integer arithmetic. */
const CountSchema = schema.number({ integer: true, minimum: 0 });
/** Required positive transfer budgets, advertised by both peers and reduced to their minimum. */
const limits = {
	maximumChunkBytes: schema.number({ integer: true, minimum: 1 }),
	maximumChunks: schema.number({ integer: true, minimum: 1 }),
	maximumBytes: schema.number({ integer: true, minimum: 1 }),
};
/** Strict executable envelope definitions own the wire types; arbitrary payload objects are unsupported. */
export const FrameSchema = schema.union([
	schema.object({ ...identity, kind: schema.literal('open'), ...limits }),
	schema.object({ ...identity, kind: schema.literal('ready'), ...limits }),
	schema.object({ ...identity, kind: schema.literal('pull'), sequence: CountSchema }),
	schema.object({
		...identity,
		kind: schema.literal('chunk'),
		sequence: CountSchema,
		bytes: schema.guard<Uint8Array>((value): value is Uint8Array => value instanceof Uint8Array),
	}),
	schema.object({ ...identity, kind: schema.literal('cancel') }),
	schema.object({
		...identity,
		kind: schema.literal('end'),
		sequence: CountSchema,
		status: schema.oneOf(['complete', 'cancelled', 'fault']),
	}),
]);
/** Parsed strict wire union. No application callback or codec runs while inspecting control frames. */
export type FrameType = schema.Output<typeof FrameSchema>;

/** Create family/version/identity fields for one connection without a runtime registry. */
export function header(id: string): Readonly<{ protocol: 'okikio.worker.bytes'; version: 1; id: string }> {
	return { protocol: 'okikio.worker.bytes', version: 1, id };
}
