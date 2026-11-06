import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { create } from './cursor.ts';
import type { Signer } from './cursor.ts';
import type { CursorCodec } from './types.ts';
import { asc } from './sort.ts';
/** The cursor's public application type follows the codec output, never its wire input. */
function types(signer: Signer): void {
	const numeric = codec.define({
		decode: schema.transform(schema.string(), Number),
		encode: schema.transform(schema.number(), String),
	});
	const cursor = create({
		contract: 'v1',
		order: [asc('id', { tiebreaker: true })],
		semantics: 'unique-numeric',
		context: '',
		values: numeric,
	}, {
		keys: [{ id: 'k', signer }],
		activeKey: 'k',
		maximumKeys: 1,
		maximumTokenBytes: 4096,
		expiresIn: 1000,
		now: () => 0,
	});
	const payload: Promise<number> = cursor.decode('opaque');
	const token: Promise<string> = cursor.encode(42);
	const ordinary: CursorCodec<number> = cursor;
	void [payload, token, ordinary];
	// @ts-expect-error Numeric application values are encoded through the explicit numeric-to-string codec.
	cursor.encode('42');
}
void types;
