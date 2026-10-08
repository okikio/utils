# `@okikio/fault`

A provider throws an unexpected error and you need a useful support report. Serializing the raw error often produces
`{}`, while walking an arbitrary thrown object can encounter cycles or executable getters. `fault` creates bounded plain
diagnostic data instead of handing the live object to the next component.

| Value in the demo          | Diagnostic projection | What remains local    |
| -------------------------- | --------------------- | --------------------- |
| `TypeError` with a message | Name and message      | The live Error object |
| `includeStack: false`      | No stack field        | Stack trace           |

Read this table as a diagnostic copy, not as recovery from the error. It shows the small example only; depth, entry and
string limits govern larger inputs. Projection is not secret redaction.

The [full API reference](API.md) lists projection options and diagnostic value types.

## Run a complete example

```ts runnable
import * as fault from '@okikio/fault';
const error = new TypeError('Provider returned an invalid value.');
console.log(JSON.stringify(fault.encode(error, { includeStack: false })));
```

Expected output:

```text output
{"name":"TypeError","message":"Provider returned an invalid value."}
```

The input is a `TypeError`; the output is a JSON object containing its name and message. Change the error's message to
change the diagnostic text. Turning stack inclusion on can add a runtime-dependent stack trace, so its exact text is not
a stable application contract.

## Build a support response from an ordinary exception

You can keep using `try` and `catch`. Project the caught value only at the boundary where it becomes a diagnostic. This
local response example shows that boundary without running a server.

```ts runnable=support-response.ts
import { encode, message } from '@okikio/fault';

try {
	JSON.parse('{broken');
} catch {
	const error = new Error('The settings file is not valid JSON.', { cause: 'invalid-json' });
	const response = Response.json({ problem: encode(error, { includeStack: false }) }, { status: 400 });
	console.log(response.status);
	console.log(message(error));
	console.log(await response.text());
}
```

```text output
400
The settings file is not valid JSON.
{"problem":{"name":"Error","message":"The settings file is not valid JSON.","cause":"invalid-json"}}
```

| Call or option             | Contract                                                                | Consequence                                                                                        |
| -------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `encode(value, options?)`  | Unknown value → JSON-safe `FaultValue`                                  | Produces primitives or frozen diagnostic containers; never returns the original object.            |
| `FaultValue`               | String, finite number, boolean, null, or arrays/records of those values | Unsupported or truncated values become readable markers.                                           |
| Limits                     | `maximumDepth`, `maximumEntries`, `maximumStringLength`                 | Bound nesting, entries per container and each string. They are not a total serialized byte budget. |
| `message(value, options?)` | Unknown value → bounded string                                          | Uses the safe projection with stack inclusion off, not arbitrary `toString()` methods.             |

Under the hood, projection follows own property descriptors. Data properties are copied; accessors become `[accessor]`
instead of being called. A set tracks the current object path to mark cycles, and limits stop deeper or larger
traversal. Errors get a specific name/message/cause projection because those useful fields are often non-enumerable.

This is diagnostic copying, not error recovery or secret removal. The response above uses an application-owned safe
message and cause. Do not publish raw provider errors just because they are now serializable. Proxy traps can still
execute during inspection; this is not a sandbox for hostile JavaScript objects.

## Build on the example

- Project an unexpected exception before adding it to [Telemetry](../telemetry/README.md) or a
  [Worker](../worker/README.md) diagnostic message. The destination still needs its own exposure and redaction policy.
- Use [Failure](../failure/README.md) for a declared business reason such as a missing file. Use Fault for unexpected
  runtime diagnostics; these two values answer different questions.

## Expected failures and unexpected diagnostics

A declared business failure and a runtime diagnostic answer different questions:

```text
@okikio/failure   expected domain failure with a stable declared ID and schema
@okikio/fault     unexpected/diagnostic runtime value that must cross a safe seam
```

Use `fault.isRecord(diagnostic)` when a transport needs the record form without asserting away arrays or primitive
diagnostics.

## Why not `JSON.stringify(error)`?

`JSON.stringify()` is not a safe generic fault projector. Errors often expose little useful enumerable data, cyclic
objects throw, `bigint` throws, and object getters can execute while serialization inspects properties.

`fault.encode()` instead:

- reads object and array entries through property descriptors;
- never invokes accessor-backed fields intentionally;
- detects circular references;
- bounds nesting depth and entries at each level;
- bounds individual strings;
- converts unsupported runtime values to stable markers;
- treats custom-prototype objects as opaque instead of calling their `toString()`.

## A larger host example

```ts
const diagnostic = fault.encode(error, {
	maximumDepth: 5,
	maximumEntries: 24,
	maximumStringLength: 2_048,
	includeStack: false,
});

await queue.fail(ctx, claim, {
	id: 'worker.fault',
	message: 'Worker execution faulted.',
	data: diagnostic,
});
```

The limits are operational safety controls for diagnostic data. `encode()` and `message()` require an ordinary
plain/null-prototype options record; accessor-backed configuration is rejected without executing the getter. They do not
turn an unexpected fault into a declared business failure.

## Convenience and the manual equivalent

| Convenience       | Manual equivalent                                                                                                                        | Concrete value                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `fault.encode()`  | walk property descriptors, reject accessors, track cycles in a `WeakSet`, cap depth/breadth/string length, and normalize non-JSON values | bounded diagnostics from arbitrary thrown values                 |
| `fault.message()` | safely project the fault first, then choose a bounded human-readable message without calling arbitrary `toString()`                      | error reporting cannot throw while formatting the original fault |

The manual version is a recursive type switch around primitives, `Error`, arrays, and plain records, with a `WeakSet`
for the current recursion path and explicit property-descriptor inspection. You also need depth, breadth, and string
limits, plus stable representations for unsupported values.

`fault.encode()` centralizes that repetitive defensive work. It does not hide a runtime, persist data, retry work, or
classify expected application failures.

## Source guide

1. `mod.ts` contains the complete projection algorithm and operational limits.
2. `types.ts` defines the JSON-safe output and options.
3. `mod.test.ts` stresses cycles, accessors, custom objects, and limits.
4. `type.test.ts` locks the public TypeScript surface.

The [generated API reference](API.md) lists every public function, option and diagnostic type.
