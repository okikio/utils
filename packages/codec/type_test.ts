import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as codec from './mod.ts';

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

// @ts-expect-error decoded count is a number, not the encoded string representation.
const wrongDecoded: string = decoded.count;
// @ts-expect-error encoded count is a string, not the application number representation.
const wrongEncoded: number = encoded.count;

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
