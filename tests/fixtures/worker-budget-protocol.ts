/** Exact binary contract shared by the native public transport benchmark's parent and Worker. */
import * as schema from '@okikio/schema';
import * as protocol from '@okikio/worker/protocol';
export const BytesSchema = schema.guard((value: unknown): value is Uint8Array => value instanceof Uint8Array);
export const Protocol = protocol.define({
	compatibility: { contract: 'bench.worker.bytes', version: 1, features: ['transfer'], required: ['transfer'] },
	request: BytesSchema,
	response: schema.number(),
});
