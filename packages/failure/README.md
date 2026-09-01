`@okikio/failure`
================

Purpose
-------

`@okikio/failure` defines expected reasons that an operation cannot complete as
intended.

A failure definition has a stable ID, a description, and a Standard Schema for
its durable data.  A runtime occurrence keeps the exact definition, validated
data, a message, and an optional in-process cause.

Definitions and occurrences freeze their own outer objects, but validated failure
`data` is owned by its schema/producer. The utility does not recursively freeze
arbitrary schema output. `encode()` revalidates that data before transport instead
of treating outer `Object.freeze()` as a durability guarantee.



Start here
----------

```ts
import * as failure from '@okikio/failure';
import { z } from 'zod';

const MissingFile = failure.define({
  id: 'file.missing',
  description: 'The requested file does not exist.',
  data: z.object({ path: z.string() }),
});

const occurrence = await failure.create(MissingFile, {
  data: { path: '/tmp/input.csv' },
});

const encoded = await failure.encode(occurrence);
```

Only `id`, validated durable data, and the message cross the encoded seam. The
local JavaScript `cause` is intentionally not serialized.

Encode and reconstruct a durable occurrence
-------------------------------------------

```ts
const Failures = failure.catalog('imports', { InvalidFile });
const occurrence = await failure.create(InvalidFile, {
  data: { reason: 'missing-header' },
});

const encoded = await failure.encode(occurrence);
const restored = await failure.decode(encoded, Failures);
```

Encoding deliberately omits process-local causes. Decoding resolves the stable
failure ID through a trusted catalog and validates the durable data again.

How it fits
-----------

Failure is not the same concept as `result` or an HTTP problem.

 -  `@okikio/result` is a success-or-failure container.
 -  `@okikio/failure` gives expected failures stable identity and durable data.
 -  `@okikio/http/problem` describes an RFC 9457 HTTP representation.

A queue or Worker can encode a failure occurrence and decode it through a
trusted failure catalog.  An HTTP service can map the same failure to a declared
HTTP problem without adding HTTP fields to the failure definition.


Durable data
------------

`failure.encode()` validates the data again before serialization.  The encoded
form contains only the stable failure ID, durable data, and message.

The JavaScript `cause` stays local. Provider errors, sockets, request objects,
and other non-durable values must not enter the encoded form.

`decode()` also treats the encoded envelope as data, not behavior. The envelope
must be a plain object or null-prototype record with own enumerable data
properties. Accessor-backed fields are rejected without invoking their getters.
The nested `data` value is then validated by the trusted failure definition's
Standard Schema.

Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`.  Read that guide when the
individual helpers make sense in isolation but their place in a service,
resource graph, runtime host, or workflow is not yet clear.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `failure.define()` + occurrence creation | freeze failure identity, validate structured data, and retain nominal package-created occurrence identity | declared failures stay distinguishable from arbitrary errors |
| `encode()` / `decode()` | copy stable id/message/data into a cloneable envelope, validate descriptors, then resolve the current definition before reconstruction | safe durable transport without serializing Error instances |
| `failure.match()` | write repeated ID checks and casts for every declared failure branch | exhaustive typed failure handling |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/failure` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with a tagged immutable record plus a map from IDs to definitions.

The utility adds schema validation, trusted catalog decoding, matching, and stable encoded failure transport.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Composition and decoding helpers
--------------------------------

- `failure.catalog()`, `select()`, and `compose()` build exact imported failure universes.
- `isOccurrence()` checks that an unknown `Error` was actually created by this module instance; a lookalike object with `definition` and `data` fields is not accepted.
- `isEncoded()` checks the inert durable envelope shape without invoking accessor-backed fields. Use it at generic transport seams that do not yet have the trusted catalog required for `decode()`.
- `match()` dispatches one occurrence to handlers keyed by exact failure definitions.
- `UnknownFailureDefinitionError` reports durable encoded failure data whose ID is not in the trusted definition set.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
