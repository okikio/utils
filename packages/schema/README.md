# `@okikio/schema`

Check data before your application acts on it. For a profile form, accept a nonempty name and a whole, nonnegative age. Print the checked profile, then show an actionable response to invalid input.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

A TypeScript type helps while you write code, but it is absent when JavaScript runs. It cannot stop an HTTP client from
sending `age: -1`. A **schema** is executable validation: it inspects that actual value before your save function uses it.
Validation returns checked data or explains which rule failed; it does not repair an invalid profile or save one.

From the experimental workspace checkout, run `mise trust`, `mise install`, and `mise run prepare -- --kind deps`. Save this program as `profile.ts` and run `mise exec -- deno run profile.ts`.

```ts runnable=profile.ts
import * as schema from '@okikio/schema';

const ProfileSchema = schema.object({
	name: schema.string({ minLength: 1 }),
	age: schema.number({ integer: true, minimum: 0 }),
});
// parse() returns checked data or throws, which suits a path that cannot proceed with invalid input.
const profile = await schema.parse(ProfileSchema, { name: 'Ada', age: 36 });
console.log(profile.name, profile.age);
// validate() instead returns issues, so a form can ask the user to correct the input.
const rejected = await schema.validate(ProfileSchema, { name: 'Ada', age: -1 });
console.log(rejected.issues === undefined ? 'accepted' : 'Correct the age before saving');
```

```text output
Ada 36
Correct the age before saving
```

The incoming value may come from a form or `response.json()`; its contents are not trustworthy just because JavaScript produced an object. A schema is the executable rule for the values your application accepts. Here a name cannot be empty and an age must be a nonnegative integer. `parse` returns the checked object or rejects its Promise. `validate` returns either `value` or `issues`, so expected bad input can be shown to a user without catching exceptions. `await` waits for that result before saving anything. Neither function writes to storage.

Native readers parse synchronously. `schema.parse(validator, value)` and `schema.validate(validator, value)` also accept
third-party synchronous or asynchronous Standard Schema validators and always return a Promise. `define()` rejects
Promise-returning callbacks. Use `defineAsync()` when a check needs asynchronous work.

The native builders are enough for this form. Choose the next section by the task you actually have; an ordinary profile does not need a schema vendor or a generated schema document.

| Next task | Read next |
| --- | --- |
| Add optional fields and choose what happens to extra keys | [Compose ordinary data](#compose-ordinary-data) |
| Turn stored timestamp text into a Date and back | [Conversion has two directions](#conversion-has-two-directions) |
| Describe a JSON representation for another tool | [Issues and JSON Schema](#issues-and-json-schema) |
| Integrate an existing Ajv or TypeBox validator | [Ajv](#use-generated-schemas-with-ajv) or [TypeBox](#use-typebox-through-an-explicit-adapter) |
| Reject recursive input that exceeds a depth or node budget | [Recursive values and exact time](#read-recursive-values-and-exact-time-formats) |

## Compose ordinary data

```ts
const ProfileSchema = schema.object({
	id: schema.string({ minLength: 1 }),
	age: schema.optional(schema.number({ integer: true, minimum: 0 })),
	roles: schema.array(schema.oneOf(['reader', 'writer'])),
});
type ProfileType = schema.Output<typeof ProfileSchema>;
```

Objects reject undeclared keys by default. Use that policy for authored configuration where a misspelled field should
fail. For external records that can grow independently, `{ unknownKeys: 'preserve' }` retains undeclared fields as
unknown values, while `{ unknownKeys: 'strip' }` accepts them and selects only declared fields. Every policy still
checks required fields and their values. Definitions snapshot their field shapes, so changing the original shape does
not change an existing schema. Parsed object and array containers are fresh. Arbitrary leaves accepted by `unknown()` or
`guard()` remain borrowed.

Ordinary records from another realm, such as a same-origin iframe, use the same data-only contract. Classes, accessor
fields, hidden properties and symbol keys remain rejected. A permissive input accepts ordinary named TypeScript
interfaces as well as literals with extra fields; declared field types stay exact.

Literal policy options retain precise types. If a settings object's `unknownKeys` is optional, inference also retains
the possible default: reject for a new schema, or the base policy for `extend()`. An optional preserve setting cannot
promise preserved output fields when the setting may be absent.

`optional()` accepts undefined; `nullable()` accepts null. An omitted optional property remains omitted, while an
explicit undefined property remains present. `defaults(schema, supply)` calls a factory only for undefined, then
validates the supplied default with the same constraints. A default never bypasses a refinement.

`extend(existingObjectSchema, addedShape)` and `extend(originalShape, addedShape)` both replace overlapping fields with
the added definition. Extension retains an existing object's unknown-key policy unless the third argument replaces it.
Their inferred input and output follow those same rules. A stripping schema accepts extra input keys without claiming
those keys remain in its output. `record(keySchema, valueSchema)` describes a partial dictionary: a finite key set does
not require every possible key to be present.

`pick(ObjectSchema, keys)` and `omit(ObjectSchema, keys)` preserve native field identity, optionality and unknown-key
policy. Foreign schemas are validated through Standard Schema; their internal shapes are not introspected.

Use `tuple()` for exact positions, `union()` for ordered alternatives, and `refine()` for a predicate. `transform()`
changes output and therefore needs an explicit reverse conversion before transport. `guard()` exposes a precise
non-transforming type predicate as an identity validator. `json()` checks the finite JSON data model, rejects getters
and cycles, enforces depth and expanded-node limits, and copies every container.

String length constraints count Unicode code points. An emoji represented by a surrogate pair counts once; a letter plus
a combining mark counts twice. These limits do not count graphemes or UTF-8 bytes. Regex validation retains the authored
flags, owns its own RegExp, and resets its matching position on every read.

## Conversion has two directions

Validation does not imply an inverse. Use `@okikio/schema/codec` when an application value needs a wire representation:

```ts runnable=timestamp-directions.ts
import * as codec from '@okikio/schema/codec';
import { DateSchema } from '@okikio/schema/time';

// The stored text cannot call Date methods until the decoder converts it.
const timestamp = '2026-01-01T00:00:00.000Z';
console.log(timestamp);
const date = await codec.read(DateSchema, timestamp);
console.log(date instanceof Date, date.getUTCFullYear());

// The authored encoder converts the Date back to the saved representation.
console.log(await codec.write(DateSchema, date));
```

```text output
2026-01-01T00:00:00.000Z
true 2026
2026-01-01T00:00:00.000Z
```

`Contract` accepts a Standard Schema or an explicit Codec. `read()` follows the validation/decode direction. `write()`
uses the authored encoder, or an owned validator whose output is known to remain valid unchanged. It rejects generic
validators and transformations without that capability. For an external validator, `codec.identity(schema)` is an
explicit author promise that its output is accepted unchanged. Use `codec.define({ decode, encode })` whenever
representations differ. An identity codec for a string checks and returns a string unchanged; it does not teach the
library how to turn a Date into that string. That conversion needs an encoder.

Timestamp conversion uses the shared local Temporal implementation from `@okikio/duration/temporal`, which selects the
host implementation or the existing fallback without installing a global. `schema/time` accepts four-digit UTC years and
uppercase `T`/`Z`, validates real Gregorian dates, and keeps Date precision. It rejects offsets, local timestamps,
leap-second spellings, invalid Dates and years outside 0000 through 9999. Fractions longer than three digits are
truncated before parsing, including dates before the Unix epoch; encoding emits exactly three fractional digits. The
small lexical guard preserves this wire grammar while Temporal owns calendar validation. Date remains the explicit
application compatibility value, and every decode creates a fresh instance.

`codec.tuple([...])` keeps distinct wire/application types and exact position types, validates one child at a time and
prefixes the first failure with its index. `codec.record(keyCodec, valueCodec, { maximumEntries })` requires a finite
entry bound and rejects transformed key collisions. Both directions produce fresh frozen containers.

`codec.discriminated(key, variants)` reads an own string discriminant and executes exactly one branch. When decoding
changes the discriminant, provide separate `{ decode(value), encode(value) }` selectors that return variant names. No
encoder is trial-executed to discover its branch. Selector and validator defects propagate unchanged.

## Issues and JSON Schema

Invalid native values throw `SchemaValidationError`. Its immutable issue snapshots retain string property names and
numeric array indexes. Parent schemas copy child paths rather than mutating shared issues. Unexpected exceptions from a
custom reader remain exceptions.

### Three separate capabilities

[Standard Typed](https://standardschema.dev/json-schema), [Standard Schema](https://standardschema.dev/schema) and
[Standard JSON Schema](https://standardschema.dev/json-schema) share the `~standard` identity while serving different
callers:

| Capability              | What it supplies                                                 | Owned entrypoint                             |
| ----------------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| Standard Typed V1       | Version, vendor and inferred input/output types                  | `Input<Definition>` and `Output<Definition>` |
| Standard Schema V1      | A sync or async `validate()` result containing output or issues  | `is()`, `validate()` and `parse()`           |
| Standard JSON Schema V1 | Separate `input({ target })` and `output({ target })` converters | `jsonSchema()`                               |

A converter-only object works with `jsonSchema()` and does not pass `is()`. A validator-only object works with `parse()`
and need not offer conversion. Native builders return `JsonReader`, which retains both capabilities in TypeScript;
`define()` and `defineAsync()` expose validation alone. A converter may still throw for a particular direction or
target. `jsonSchema()` forwards the requested target and `libraryOptions` unchanged. `parse()` and `validate()` likewise
pass optional Standard validation options to the vendor.

### Representation and executable checks

`schema.jsonSchema(definition, 'input' | 'output', { target })` defaults to output and draft 2020-12. Native projections
support `draft-07` and `draft-2020-12`, and reject other targets explicitly. Neither validation nor conversion implies
that an arbitrary document can be translated between dialects.

For ordinary native primitives, containers and choices, projection retains the authored JSON constraints. Integer bounds
always stay within JavaScript's safe integer range. Unions use `anyOf` because more than one branch may accept the same
value; `oneOf()` is primitive membership and emits a deduplicated `enum`. Tuples use each draft's positional keywords,
and an empty tuple emits an array with `maxItems: 0`.

Projection never executes a default factory, predicate or transform. A defaulted property is optional on input and
required on output when its child requires a value; no speculative `default` annotation is produced. A stripping object
permits extra input keys and excludes them from output. Preserving objects permit extras in both directions; rejecting
objects exclude them in both.

The generated document describes the JSON representation, so it cannot express JavaScript property descriptors,
prototypes, object identity, cycles, explicit undefined values or parser resource budgets. `unknown()` and `json()`
therefore project the JSON value space without becoming a replacement for their runtime ownership and work rules.
Optional properties model absence in an object; JSON itself has no undefined value.

| Authored behavior                                    | Input conversion                                                                     | Output conversion                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Ordinary native JSON values                          | Original JSON constraints                                                            | Original JSON constraints                      |
| Defaults and unknown-key stripping                   | Describes values before defaults/stripping                                           | Describes values after defaults/stripping      |
| `transform(source, callback)`                        | Source's structural representation before the callback                               | Throws because the new output shape is unknown |
| Numeric or string coercion                           | Throws because text conversion plus result constraints cannot be inferred faithfully | Projects the constrained number or string      |
| Boolean coercion                                     | Exact `true`, `false`, `"true"`, `"false"` membership                                | Boolean                                        |
| `refine()`, `guard()`, `date()` or undefined literal | Throws                                                                               | Throws                                         |
| `define()` / `defineAsync()`                         | No converter                                                                         | No converter                                   |

A transform callback can reject a value accepted by its source. Its input projection does not run or describe that
callback, so structural JSON validity does not prove the transform will succeed. The Date codec's calendar checks are
one example. Use runtime validation when callback success matters, and keep an explicit codec for the inverse.

JSON Schema patterns target Unicode ECMAScript matching. Use a RegExp with `u` for conversion; `g` and `d` are also
accepted because they do not change the owned reader's acceptance when its position resets. Case-insensitive (`i`),
multiline (`m`), dot-all (`s`), sticky (`y`), Unicode-set (`v`) and non-Unicode matching remain usable for validation
but fail conversion. Removing those flags or silently adding `u` would change which strings match. Ajv's default
[`unicodeRegExp: true`](https://ajv.js.org/options.html#unicoderegexp) matches this projection contract.

## Use generated schemas with Ajv

Ajv remains an optional application dependency. Its [default class uses draft 07](https://ajv.js.org/json-schema.html);
use `ajv/dist/2020.js` for draft 2020-12. Select the same target when projecting. A JSON Schema `default` is an
annotation; Ajv only changes data when its [mutation options](https://ajv.js.org/guide/modifying-data.html) are enabled.
The following complete example uses pure validation, then calls the owned reader to apply its default and key policy.

Save this complete variation as `packages/schema/ajv-projection.ts` and run `mise exec -- deno run packages/schema/ajv-projection.ts` from the repository root after the same setup. This location uses Schema’s development import map for the optional vendor; the package does not install that vendor into an external application.

```ts runnable=ajv-projection.ts
import { Ajv } from 'ajv';
import * as schema from '@okikio/schema';

const Settings = schema.object({
	retries: schema.defaults(schema.number({ integer: true, minimum: 0 }), () => 3),
}, { unknownKeys: 'strip' });
const ajv = new Ajv({ strict: true });
const input = ajv.compile(schema.jsonSchema(Settings, 'input', { target: 'draft-07' }));
const output = ajv.compile(schema.jsonSchema(Settings, 'output', { target: 'draft-07' }));
const received = { future: true };
const parsed = Settings.parse(received);
console.log(input(received), output(received), output(parsed), parsed.retries);
```

```text output
true false true 3
```

For external JSON Schema, the application owns its dialect, resource registration and engine options. `$id`, `$defs` and
`$ref` survive JSON serialization; functions, TypeBox codec behavior and other JavaScript effects do not. Compile the
document with its intended engine, then adapt validation with `define()` or Standard Schema directly. An Ajv
`compile<T>()` annotation is the application's type claim about that external document, not type inference from an
arbitrary JSON file.

Save this complete variation as `packages/schema/ajv-reader.ts` and run `mise exec -- deno run packages/schema/ajv-reader.ts` from the repository root after the same setup. This location uses Schema’s development import map for the optional vendor; the package does not install that vendor into an external application.

```ts runnable=ajv-reader.ts
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as schema from '@okikio/schema';

const ajv = new Ajv2020({ strict: true, allErrors: true });
const check = ajv.compile<{ count: number }>({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	properties: { count: { type: 'integer', minimum: 0 } },
	required: ['count'],
	additionalProperties: false,
});
const Count = schema.define((value) => {
	if (check(value)) return value;
	throw new schema.SchemaValidationError((check.errors ?? []).map((error) => ({
		message: error.message ?? 'Invalid count.',
		path: error.instancePath === '' ? [] : error.instancePath.slice(1).split('/')
			.map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~')),
	})));
});
console.log((await schema.parse(Count, { count: 2 })).count);
console.log((await schema.validate(Count, { count: -1 })).issues?.[0]?.path?.join('.'));
```

```text output
2
count
```

The adapter copies errors immediately because Ajv reuses its error state. Pointer segments remain strings, including
numeric-looking property names. A required or additional-property error can also append the property named in Ajv's
`params` when the UI wants the exact absent or extra field. The adapter borrows successful values and supplies no
guessed JSON converter. Retain the original document separately, or author a Standard JSON Schema converter that returns
it only for its declared dialect.

Use `ajv-formats` explicitly when an external document needs formats such as email or date-time; Ajv does not include
them in its core package. [Format validation](https://ajv.js.org/guide/formats) and JSON Schema format annotation are
different commitments. Also keep `useDefaults`, `removeAdditional` and `coerceTypes` disabled for the identity-style
adapter above. Those choices mutate properties, and root scalar coercion cannot replace the caller's value.

For [asynchronous Ajv schemas](https://ajv.js.org/guide/async-validation.html), use `defineAsync()`. Async success
resolves the checked value; an Ajv `ValidationError` becomes issues, while lookup, transport and programming errors
propagate.

Save this complete variation as `packages/schema/ajv-async.ts` and run `mise exec -- deno run packages/schema/ajv-async.ts` from the repository root after the same setup. This location uses Schema’s development import map for the optional vendor; the package does not install that vendor into an external application.

```ts runnable=ajv-async.ts
import { Ajv2020 } from 'ajv/dist/2020.js';
import { ValidationError } from 'ajv';
import * as schema from '@okikio/schema';

const ajv = new Ajv2020({ strict: true });
ajv.addFormat('available-name', {
	async: true,
	validate: async (value: string) => value === 'free',
});
const check = ajv.compile<string>({ $async: true, type: 'string', format: 'available-name' });
const AvailableName = schema.defineAsync(async (value) => {
	try {
		return await check(value);
	} catch (error) {
		if (!(error instanceof ValidationError)) throw error;
		throw new schema.SchemaValidationError(error.errors.map((issue) => ({
			message: issue.message ?? 'Name is unavailable.',
		})));
	}
});
console.log(await schema.parse(AvailableName, 'free'));
```

```text output
free
```

## Use TypeBox through an explicit adapter

The current [`typebox`](https://github.com/sinclairzx81/typebox) package and legacy
[`@sinclair/typebox`](https://github.com/sinclairzx81/sinclair-typebox) are separate package lines. The tested versions
are `typebox@1.4.3` and `@sinclair/typebox@0.34.52`. Neither a raw schema nor a compiled validator implements Standard
Schema automatically in those releases, and neither package exports a Standard adapter. The current repository has an
official [Standard example](https://github.com/sinclairzx81/typebox/tree/main/example/standard); it is an example, not a
published subpath. Use the installed version's API when adapting it.

Current TypeBox uses `Compile()` and an array from `Errors()`. `Check()` validates the encoded representation and leaves
values unchanged. The following adapter keeps that contract and preserves inferred output types.

Save this complete variation as `packages/schema/typebox-current.ts` and run `mise exec -- deno run packages/schema/typebox-current.ts` from the repository root after the same setup. This location uses Schema’s development import map for the optional vendor; the package does not install that vendor into an external application.

```ts runnable=typebox-current.ts
import Type from 'typebox';
import { Compile } from 'typebox/compile';
import * as schema from '@okikio/schema';

const document = Type.Object({ count: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
const check = Compile(document);
const Count = schema.define((value) => {
	if (check.Check(value)) return value;
	throw new schema.SchemaValidationError(
		check.Errors(value).map((error) => ({
			message: error.message,
			path: error.instancePath === '' ? [] : error.instancePath.slice(1).split('/')
				.map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~')),
		})),
	);
});
console.log((await schema.parse(Count, { count: 2 })).count, schema.is(document));
```

```text output
2 false
```

`Parse()`, `Convert()`, `Default()`, `Clean()`, `Decode()` and `Encode()` serve other purposes. In particular, a TypeBox
codec's `Check()` result stays in its encoded type, while `Decode()` produces its decoded application type. If an
adapter invokes decoding, its Standard output type must follow that operation and an output JSON Schema must describe
the new representation. Serializing a TypeBox schema does not transport its JavaScript codec functions.

Legacy TypeBox uses `TypeCompiler.Compile()` and an iterable from `Errors()`. Its tuple document uses draft 07 `items`
arrays; the current package uses the 2020-12 positional vocabulary. Do not send a legacy tuple unchanged to Ajv2020.

Save this complete variation as `packages/schema/typebox-legacy.ts` and run `mise exec -- deno run packages/schema/typebox-legacy.ts` from the repository root after the same setup. This location uses Schema’s development import map for the optional vendor; the package does not install that vendor into an external application.

```ts runnable=typebox-legacy.ts
import { Type } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import * as schema from '@okikio/schema';

const check = TypeCompiler.Compile(Type.Tuple([Type.Number(), Type.Number()]));
const Point = schema.define((value) => {
	if (check.Check(value)) return value;
	throw new schema.SchemaValidationError([...check.Errors(value)].map((error) => ({
		message: error.message,
		path: error.path === '' ? [] : error.path.slice(1).split('/')
			.map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~')),
	})));
});
console.log((await schema.parse(Point, [1, 2])).join(','));
```

```text output
1,2
```

Zod is an optional interoperability adapter under `schema/zod`. Core authoring, validation, codecs and timestamps do not
import it.

The same-source conformance tests compile native documents with strict Ajv in both supported drafts and with the current
TypeBox JSON engine for 2020-12. They also exercise both TypeBox authoring APIs, external reference resources, JSON
serialization, optional formats and asynchronous validation. The README adapters above compile and run through public
exports. These checks cover the stated contracts, not every JSON Schema vocabulary or engine configuration.

## Validate input before another utility acts on it

A form validates an application value; a stored record needs a wire encoding; a tool may need a JSON Schema
representation. Validation, conversion, and representation have different contracts.

Use native builders for ordinary values, Codec for encode/decode directions, and explicit adapters for an existing
validator library. Utilities accept Standard Schema without choosing application business rules.

A schema proves only its declared contract. Do not narrow unconstrained durable data to a known vocabulary without an
explicit classification step.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                       | Use it to                                                                    | Exact contract               |
| ---------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| `@okikio/schema`             | Use the package entry shown in the complete examples above.                  | [Contract](./mod.ts)         |
| `@okikio/schema/types`       | Import public types for this capability; this entry does not start work.     | [Contract](./types.ts)       |
| `@okikio/schema/time`        | Author time-related validation contracts.                                    | [Contract](./time.ts)        |
| `@okikio/schema/zod`         | Adapt Zod schemas explicitly, including supported representation conversion. | [Contract](./zod.ts)         |
| `@okikio/schema/codec`       | Keep application and wire values connected by directional codecs.            | [Contract](./codec/mod.ts)   |
| `@okikio/schema/codec/types` | Import public types for this capability; this entry does not start work.     | [Contract](./codec/types.ts) |

## Bound returned validation diagnostics

`validate(definition, value, { maximumIssues, maximumPathLength })` can cap returned issue evidence and reports
`truncated: true` when it omits issues or path segments. Both provided limits must be positive safe integers. These
controls bound the returned report; they do not interrupt or bound allocations inside a foreign validator. Use
vendor/native input and issue policies where that work must also be bounded.

For native object, array, tuple and record builders, `maximumIssues` and `maximumPathLength` also bound issue
accumulation before copying each child report. Once a known rejection fills `maximumIssues`, later siblings are skipped.
Limits pass explicitly through native optional/default/refinement/transform/coercion wrappers, so reentrant validation
has an independent invocation budget.
Union branches still run until one succeeds: an early invalid branch must not prevent a later valid match. Failed-branch
reports are bounded, and successful-branch evidence does not mark a later sibling's report truncated. Path limits retain
root-most segments before prefix copying. Omitted options retain complete native validation behavior. Custom define()
callbacks and foreign readers remain opaque: their internal work and allocations cannot be interrupted by this budget.
`truncated` can mean that later siblings were not visited, even if they would have been valid; do not infer their
validity from a capped report. This is bounded evidence, not a general execution-time or VM heap quota.

## Read recursive values and exact time formats

`lazy(factory, { maximumDepth, maximumNodes })` supports synchronous recursive readers. Give a recursive reader both
output and input types when they match; `Reader<Value>` alone declares unknown input. The factory resolves on first
validation and is cached after success. Input traversal rejects cycles, enumerable accessors and excess visits before
invoking the factory. Shared references count each visit. Arrays and plain records are traversed; host objects remain
opaque. Each separately supplied recursive root has its own traversal limit. These limits do not bound trusted validator
callbacks or the allocation needed to enumerate keys.

Use `inspect(reader)` to see whether the reader can describe its input and its output as JSON Schema. It calls the
converters the reader declares. It does not validate data or run a factory that creates a schema later. If it cannot
describe a recursive schema, it reports that limit without making up a target for `$ref`.

The `@okikio/schema/time` profiles separate exact instants, calendar durations and fixed elapsed durations.
`InstantSchema` accepts four-digit UTC years, seconds and up to nine fractional digits, and encodes exactly nine digits.
Offsets, leap seconds, expanded years and invalid dates fail. `DurationSchema` retains calendar units. `ElapsedSchema`
rejects years/months and normalizes days as exactly 24 hours into seconds plus nanoseconds. Neither changes the
millisecond `DateSchema`. Their transformed application values have no JSON object projection; inspect the wire
direction explicitly. No profile installs Temporal globals.

## Validate a recursive value and an exact timestamp

The input below has one parent and one child:

```text
parent: value 1
└── child: value 2 (no children)
```

The depth and visit limits bound traversal before recursive validation begins. Visits include traversal through arrays
and records, and a shared reference counts again on each visit; `maximumNodes` is not a count of business branches.
An unexpectedly deep or large input fails instead of requiring unbounded traversal.

Save this complete variation as `recursive-time.ts` and run `mise exec -- deno run recursive-time.ts` after the same checkout setup.

```ts runnable=recursive-time.ts
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { InstantSchema } from '@okikio/schema/time';

// Each branch contains a number and zero or more branches of the same shape.
interface Branch {
	value: number;
	children: Branch[];
}

const TreeSchema: schema.Reader<Branch, Branch> = schema.lazy<Branch>(
	() => schema.object({ value: schema.number(), children: schema.array(TreeSchema) }),
	{ maximumDepth: 16, maximumNodes: 100 },
);

const tree = {
	value: 1,
	children: [
		{ value: 2, children: [] },
	],
};
console.log(TreeSchema.parse(tree).children[0]!.value);

// Exact timestamps are a separate conversion, unrelated to the tree's recursion.
const instant = await codec.decode(InstantSchema, '1969-12-31T23:59:59.999999999Z');
console.log(await codec.encode(InstantSchema, instant));
console.log(schema.inspect(TreeSchema).output.supported);
```

```text output
2
1969-12-31T23:59:59.999999999Z
false
```

## Measure validation and directional conversion

The tuple benchmark measures decode and encode separately for 2 and 16 fields. Its decode reference calls the same
child codec sequentially and freezes the output array, so the comparison retains child validation. It is not an encode
reference.

The invalid-array benchmark checks 100 and 10,000 rows with either complete diagnostics or a cap of two issues and one
path segment. The capped path can skip later siblings; it intentionally returns less evidence. Compare those costs as
a diagnostic policy choice, not as two ways to produce an equivalent full report.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/schema test
deno task --cwd=packages/schema bench:check
deno task --cwd=packages/schema bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.
