import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as codec from './mod.ts';

/** Type-only async consumers compile unchanged through both ESM and CommonJS declarations. */
async function codecTypes(): Promise<void> {
	const NumberCodec = codec.define({
		decode: schema<string, number>((value) => Number(value)),
		encode: schema<number, string>((value) => String(value)),
	});
	const StringCodec = codec.define({
		decode: schema<string, string>((value) => value),
		encode: schema<string, string>((value) => value),
	});

	const Definition = codec.object({
		count: NumberCodec,
		name: StringCodec,
		optionalCount: codec.optional(NumberCodec),
	});

	const decoded = await codec.decode(Definition, { count: '3', name: 'widget', optionalCount: undefined });
	const count: number = decoded.count;
	const name: string = decoded.name;
	const optionalCount: number | undefined = decoded.optionalCount;
	void count;
	void name;
	void optionalCount;

	const encoded = await codec.encode(Definition, { count: 3, name: 'widget', optionalCount: undefined });
	const wireCount: string = encoded.count;
	void wireCount;

	// An optional codec must permit omission in all four declared object contracts.
	const omittedInput: codec.DecodeInput<typeof Definition> = { count: '3', name: 'widget' };
	const omittedOutput: codec.Decoded<typeof Definition> = { count: 3, name: 'widget' };
	const omittedEncode: codec.EncodeInput<typeof Definition> = { count: 3, name: 'widget' };
	const omittedEncoded: codec.Encoded<typeof Definition> = { count: '3', name: 'widget' };
	void omittedInput;
	void omittedOutput;
	void omittedEncode;
	void omittedEncoded;

	const External = codec.object({ count: NumberCodec }, {
		decode: { unknownKeys: 'preserve' },
		encode: { unknownKeys: 'reject' },
	});
	const future: unknown = (await codec.decode(External, { count: '2', future: true })).future;
	const exactCount: number = (await codec.decode(External, { count: '2' })).count;
	void future;
	void exactCount;
	// @ts-expect-error A reject encoder must not imply undeclared output keys.
	const removed = (await codec.encode(External, { count: 2 })).future;
	void removed;
	// @ts-expect-error Unknown preserved fields do not weaken known property types.
	const wrongCount: string = (await codec.decode(External, { count: '2' })).count;
	void wrongCount;

	interface Payload {
		readonly id: string;
	}

	/** A codec accepts ordinary interface values without requiring an unknown-key index signature. */
	function interfaceInputs(payload: Payload): void {
		const Default = codec.object({ id: StringCodec });
		const decode: codec.DecodeInput<typeof Default> = payload;
		const encode: codec.EncodeInput<typeof Default> = payload;
		const extra: codec.DecodeInput<typeof Default> = { id: 'a', future: true };
		void decode;
		void encode;
		void extra;
		// @ts-expect-error An extra-key policy cannot weaken a known field.
		const wrong: codec.DecodeInput<typeof Default> = { id: 3, future: true };
		void wrong;
		const Strict = codec.object({ id: StringCodec }, { encode: { unknownKeys: 'reject' } });
		// @ts-expect-error An explicitly rejecting encoder still rejects unknown literal fields.
		const rejected: codec.EncodeInput<typeof Strict> = { id: 'a', future: true };
		void rejected;
		const options: codec.ObjectOptions<'preserve', 'preserve'> = {};
		const Optional = codec.object({ id: StringCodec }, options);
		const decoded: codec.Decoded<typeof Optional> = { id: 'a' };
		const encoded: codec.Encoded<typeof Optional> = { id: 'a' };
		// @ts-expect-error An omitted decoder policy strips, so an optional preserve setting cannot promise extra output.
		const absentDecoded = decoded.future;
		// @ts-expect-error The encoder independently retains its strip fallback.
		const absentEncoded = encoded.future;
		void absentDecoded;
		void absentEncoded;
	}
	void interfaceInputs;

	// @ts-expect-error decoded count is a number, not the encoded string representation.
	const _wrongDecoded: string = decoded.count;
	// @ts-expect-error encoded count is a string, not the application number representation.
	const _wrongEncoded: number = encoded.count;

	function schema<Input, Output>(transform: (value: Input) => Output): StandardSchemaV1<Input, Output> {
		return {
			'~standard': {
				version: 1,
				vendor: 'type-test',
				validate(value: unknown) {
					return { value: transform(value as Input) };
				},
			},
		};
	}
}
void codecTypes;
