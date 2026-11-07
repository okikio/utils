# Failure

“File not found” is a reason your application expects and knows how to explain. A **failure definition** gives that
reason a stable ID and rules for its details. An **occurrence** is one actual rejection, such as `file.missing` for
`photo.txt`. This distinction lets a caller recognize the reason even after the explanatory sentence changes.
The [package example](../../packages/result/failure/README.md) also shows encoding a reason for another component.

## Catch a missing file using its definition

This file lookup uses an in-memory Map so it can run anywhere. The branch is the same one you can use around a real file
index or database: handle the expected missing-file reason and rethrow unexpected exceptions.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`missing-file.ts` at that root, then run `mise exec -- deno run missing-file.ts`.

```ts runnable=missing-file.ts
import * as failure from '@okikio/result/failure';
import * as schema from '@okikio/schema';

// Declare the expected reason once; receivers must trust this declaration independently.
const Missing = failure.define({
	id: 'file.missing',
	description: 'The requested file does not exist.',
	data: schema.object({ path: schema.string() }),
});

// The local lookup can raise an occurrence of that declared reason.
const files = new Map<string, string>([['photo.txt', 'saved']]);
async function read(path: string): Promise<string> {
	const text = files.get(path);
	if (text === undefined) throw await failure.create(Missing, { data: { path } });
	return text;
}
try {
	console.log(await read('missing.txt'));
} catch (error) {
	if (!failure.is(error, Missing)) throw error;
	console.log(`Choose another file: ${error.data.path}`);
}
```

```text output
Choose another file: missing.txt
```

The decision uses the exact definition, not a substring in the error message. You can revise the explanation without
breaking the caller's branch. A definition describes an expected outcome; choosing whether to retry or which HTTP status
to send remains the caller's decision.

## Present the same reason at an application entry point

- Wrap an expected occurrence in [Result](../../packages/result/README.md) so a caller handles success and missing asset
  explicitly. Result chooses the branch; Failure gives the reason its stable meaning.
- Present that reason through a declared [HTTP problem](../../packages/http/problem/README.md) in an HTTP API. Keep
  internal causes and secrets out of public responses and encoded failure data.

Do not put secrets in encoded failure data. Unexpected exceptions belong to fault diagnostics; declared failures
describe expected domain outcomes.

Definitions and occurrences freeze their own outer objects, but validated failure `data` is owned by its
schema/producer. The utility does not recursively freeze arbitrary schema output. `encode()` validates the declared
application-to-wire direction before transport. Native identity schemas support that direction directly; transformed
data needs an explicit codec. Freezing an outer wrapper does not establish that its data is durable.

A queue or Worker can encode a failure occurrence and decode it through a trusted failure catalog. An HTTP service can
map the same failure to a declared HTTP problem without adding HTTP fields to the failure definition.

To carry the missing-file reason to another component, create one occurrence, encode it as data, and decode against
that receiver's trusted definitions. Append this to the earlier program; it reuses its exact Missing declaration.

```ts
const occurrence = await failure.create(Missing, { data: { path: 'absent.txt' } });

// Encoding produces transport data, not a transferable JavaScript object identity.
const wire = await failure.encode(occurrence);

// A real receiver imports its own trusted catalog; incoming JSON cannot extend it.
const restored = await failure.decode(wire, [Missing]);
console.log(failure.is(restored, Missing)); // true
```

```text
Trusted definition → one occurrence → encoded wire data → receiver resolves ID in trusted catalog → checked occurrence
```

The receiver catalog is the authority in the last step. Unknown IDs cannot introduce new definitions, and known IDs
still require valid data. Encoding does not choose a transport or make an arbitrary error safe to persist.

## Durable data

Provider errors, sockets, request objects, and other non-durable values must not enter the encoded form.

`decode()` also treats the encoded envelope as data, not behavior. The envelope must be a plain object or null-prototype
record with own enumerable data properties. Accessor-backed fields are rejected without invoking their getters. The
nested `data` value is then validated by the trusted failure definition's Standard Schema.

## Convenience and the manual equivalent

| Convenience                              | Manual equivalent                                                                                                                      | Concrete value                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `failure.define()` + occurrence creation | freeze failure identity, validate structured data, and retain nominal package-created occurrence identity                              | declared failures stay distinguishable from arbitrary errors |
| `encode()` / `decode()`                  | copy stable id/message/data into a cloneable envelope, validate descriptors, then resolve the current definition before reconstruction | safe durable transport without serializing Error instances   |
| `failure.match()`                        | write repeated ID checks and casts for every declared failure branch                                                                   | dispatch by stable failure ID                                |

`@okikio/result/failure` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with a
tagged immutable record plus a map from IDs to definitions.

The utility adds schema validation, trusted catalog decoding, matching, and stable encoded failure transport.

## Composition and decoding helpers

- `failure.catalog()`, `select()`, and `compose()` build exact imported failure universes.
- `isOccurrence()` checks that an unknown `Error` was actually created by this module instance; a lookalike object with
  `definition` and `data` fields is not accepted.
- `isEncoded()` checks the inert durable envelope shape without invoking accessor-backed fields. Use it at generic
  message receivers that do not yet have the trusted catalog required for `decode()`.
- `match()` dispatches one occurrence to handlers keyed by stable failure IDs.
- `UnknownFailureDefinitionError` reports durable encoded failure data whose ID is not in the trusted definition set.

## Source guide

The paths below are relative to the [package directory](../../packages/result/failure).

Start with the package README linked above, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

Read the [public source](../../packages/result/failure/mod.ts) for the complete exported contracts and field
descriptions.
