# `@okikio/schema/codec`

A codec keeps validation and reverse conversion together. For example, an API sends a timestamp string while an
application works with a Date. The decode schema validates the string and produces a Date. The encode schema validates
the Date and produces the canonical string.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `example.ts` and run `mise exec -- deno run example.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable
import * as codec from '@okikio/schema/codec';
import { DateSchema } from '@okikio/schema/time';

// Decode transport text into a Date, then encode the application value back to the declared wire format.
const value = await codec.decode(DateSchema, '2026-01-01T00:00:00.000Z');
console.log(await codec.encode(DateSchema, value));
```

```text output
2026-01-01T00:00:00.000Z
```

## Author the two timestamp directions explicitly

Use the built-in `DateSchema` for its documented UTC wire grammar. To understand what `define` connects, this custom variation requires the application's exact millisecond UTC spelling. The decoder checks that text before constructing a Date; the encoder checks the Date before calling `toISOString`. These two validators are explicit, so the library does not have to guess an inverse.

Save this complete variation as `timestamp-codec.ts` and run `mise exec -- deno run timestamp-codec.ts` after the same checkout setup.

```ts runnable=timestamp-codec.ts
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
const UtcTextSchema = schema.refine(
	schema.string(),
	(text) =>
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) &&
		Number.isFinite(Date.parse(text)) && new Date(text).toISOString() === text,
	'Use a valid millisecond UTC timestamp.',
);
const TimestampCodec = codec.define({
	decode: schema.transform(UtcTextSchema, (text) => new Date(text)),
	encode: schema.transform(
		schema.refine(
			schema.date(),
			(date) => date.getUTCFullYear() >= 0 && date.getUTCFullYear() <= 9999,
			'Use a four-digit UTC year.',
		),
		(date) => date.toISOString(),
	),
});
const record = codec.object({ savedAt: TimestampCodec });
const profile = await codec.decode(record, { savedAt: '2026-01-01T00:00:00.000Z' });
console.log(profile.savedAt instanceof Date);
console.log(JSON.stringify(await codec.encode(record, profile)));
try {
	await codec.decode(record, { savedAt: 'yesterday' });
} catch (error) {
	if (!(error instanceof schema.SchemaValidationError)) throw error;
	console.log(JSON.stringify(error.issues[0]?.path));
}
```

```text output
true
{"savedAt":"2026-01-01T00:00:00.000Z"}
["savedAt"]
```

The object codec adds the `savedAt` property to the issue path, so a form can highlight the actual field. Catch only the expected validation error; an unexpected bug in a conversion remains a thrown error. This custom wire policy is deliberately narrower than every ISO timestamp. It does not replace the built-in time profiles or guarantee JSON safety for arbitrary other application fields.

## Keep each validation direction explicit

Author a codec with `define({ decode, encode })`. Both fields accept Standard Schema validators, including owned
synchronous builders and asynchronous validators. The four type positions are separate: decode input, decoded
application output, encode input, and encoded output. An encoder validates its own direction instead of feeding an
application output back through the decoder.

`object(shape)`, `array(codec)`, `optional(codec)` and `nullable(codec)` compose both directions. Objects own snapshots
of their codec shape and reject non-data properties; validation issues retain complete child paths. Returned composed
containers are frozen at the outer level, while arbitrary child values retain the ownership defined by their schemas.
Optional properties can be omitted in the inferred types and remain absent in parsed objects. Explicit `undefined`
properties remain present.

Object codecs strip undeclared keys by default. Set each direction's policy when provider growth and authored output
need different rules:

```ts runnable=profile-directions.ts
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';

const ProfileCodec = codec.object({
	id: codec.identity(schema.string()),
}, {
	decode: { unknownKeys: 'preserve' },
	encode: { unknownKeys: 'reject' },
});

const profile = await codec.decode(ProfileCodec, { id: 'a', providerVersion: 2 });
// profile.id is string; profile.providerVersion is unknown.
const outbound = await codec.encode(ProfileCodec, { id: profile.id });
console.log(profile.id, profile.providerVersion);
console.log(JSON.stringify(outbound));
```

```text output
a 2
{"id":"a"}
```

The decoder accepts new provider fields while still validating `id`. The encoder checks a deliberately authored outgoing
record. Passing that entire preserved provider record to a rejecting encoder would reject its extra fields; select
outgoing properties explicitly or choose a different encoder policy. Accessors and non-data objects still reject under
every policy.

Inputs accept named TypeScript interfaces without requiring an unknown-key index signature. Known fields keep their
declared types. If a direction or its policy is optional in a configuration type, output inference retains the possible
strip default; only an explicitly present preserve policy promises an unknown-field output index signature.

`Contract` is the shared schema-or-codec type for consumers such as Failure, Effect, Workflow and Storage.
`ContractInput`, `ContractOutput` and `ContractEncoded` preserve their exact directional types. Use
`read(contract, value)` for incoming values and `write(contract, value)` for application-to-wire conversion.
`input(contract)` and `output(contract)` expose those Standard Schema directions when a consumer needs validation
metadata.

Native identity validators can be written directly. Generic Standard Schema validators have no promised inverse, and
arbitrary transformations have no automatically inferred encoder. `write()` rejects them until an explicit codec is
supplied. `identity(schema)` declares that the author intends the validator's output to be accepted unchanged as a
canonical representation. It should not be used merely to silence an unsupported-conversion error.

A codec does not guarantee JSON safety, durability, idempotent side effects or a particular transport. The transport
validates its supported representation and controls its own byte, depth and resource limits.

## Choose adjacent capabilities

Schema validates values; Codec distinguishes application and wire directions. An identity claim must be explicit when no
reverse transformation is available.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.
