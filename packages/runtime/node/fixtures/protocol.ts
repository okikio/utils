/** Protocol shared by the native Node thread checks consumer and its worker module. */
import * as schema from '@okikio/schema';
import * as worker from '@okikio/worker/thread';
import * as codec from '@okikio/schema/codec';

/** Shared memory lets the parent observe cleanup before the request settles. */
export interface Request {
	readonly mode: 'echo' | 'wait' | 'crash' | 'transfer' | 'stubborn';
	readonly value: number;
	readonly flag?: SharedArrayBuffer;
	readonly bytes?: ArrayBuffer;
}

const RequestSchema = schema.define((value: unknown): Request => {
	if (typeof value !== 'object' || value === null) return schema.reject('Expected a request record.');
	const record = value as Record<string, unknown>;
	if (
		!['echo', 'wait', 'crash', 'transfer', 'stubborn'].includes(String(record.mode)) || typeof record.value !== 'number'
	) return schema.reject('Invalid request.');
	if (record.flag !== undefined && !(record.flag instanceof SharedArrayBuffer)) {
		return schema.reject('Expected a shared cleanup flag.');
	}
	if (record.bytes !== undefined && !(record.bytes instanceof ArrayBuffer)) {
		return schema.reject('Expected transferable bytes.');
	}
	return record as unknown as Request;
});
const ResponseSchema = schema.define((value: unknown): number | ArrayBuffer => {
	if (typeof value !== 'number' && !(value instanceof ArrayBuffer)) return schema.reject('Expected a number or bytes.');
	return value;
});
const NumberSchema = schema.define((value: unknown): number => {
	if (typeof value !== 'number') return schema.reject('Expected a number.');
	return value;
});
export const Protocol = worker.protocol({
	compatibility: {
		contract: 'native.runtime.thread',
		version: 1,
		features: ['notice', 'reverse-call', 'transfer'],
		required: ['notice', 'reverse-call', 'transfer'],
	},
	request: codec.identity(RequestSchema),
	response: codec.identity(ResponseSchema),
	notice: codec.identity(NumberSchema),
	call: { request: codec.identity(NumberSchema), response: codec.identity(NumberSchema) },
});
