import * as schema from './mod.ts';
import * as codec from './codec/mod.ts';
const BaseSchema = schema.object({ id: schema.string(), count: schema.optional(schema.number()) }, {
	unknownKeys: 'strip',
});
const PickedSchema = schema.pick(BaseSchema, ['id']);
const selected: schema.Output<typeof PickedSchema> = { id: 'asset' };
// @ts-expect-error Selection must not retain the removed field.
const removed: schema.Output<typeof PickedSchema> = { id: 'asset', count: 1 };
const NumberCodec = codec.define({
	decode: schema.transform(schema.string(), Number),
	encode: schema.transform(schema.number(), String),
});
const PairCodec = codec.tuple([NumberCodec, codec.identity(schema.boolean())]);
const wire: codec.DecodeInput<typeof PairCodec> = ['1', true];
const application: codec.Decoded<typeof PairCodec> = [1, true];
// @ts-expect-error Decode input retains the string representation.
const wrong: codec.DecodeInput<typeof PairCodec> = [1, true];
void selected;
void removed;
void wire;
void application;
void wrong;
