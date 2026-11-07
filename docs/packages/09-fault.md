# Fault

JavaScript can throw an Error, a string, or even an object that refers to itself. A log needs a printable description
without following that reference forever or running code hidden in a property. Fault turns the thrown value into plain
data with size limits. The [package example](../../packages/result/fault/README.md) shows a short report.

A size limit does not remove secrets. An error message or ordinary field can still contain a credential. Decide what
may leave the application before sending diagnostics to another system.

## Expected failures and unexpected diagnostics

A declared business failure and a runtime diagnostic answer different questions:

```text
@okikio/result/failure   expected domain failure with a stable declared ID and schema
@okikio/result/fault     unexpected runtime value prepared for a log or message
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

## Keep diagnostic output bounded

Unexpected failures can contain circular objects as well as errors. This example produces a printable diagnostic without
letting one repeated object or a long message prevent reporting.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`bounded-report.ts` at that root, then run `mise exec -- deno run bounded-report.ts`.

```ts runnable=bounded-report.ts
import { encode } from '@okikio/result/fault';

const report: { message: string; details?: unknown } = { message: 'Provider response was invalid.' };
report.details = report;
const diagnostic = encode(report, {
	maximumDepth: 3,
	maximumEntries: 4,
	maximumStringLength: 64,
});
console.log(JSON.stringify(diagnostic));
```

```text output
{"details":"[circular]","message":"Provider response was invalid."}
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

The paths below are relative to the [package directory](../../packages/result/fault).

1. `mod.ts` contains the complete projection algorithm and operational limits.
2. `types.ts` defines the JSON-safe output and options.
3. `mod.test.ts` stresses cycles, accessors, custom objects, and limits.
4. `types.test.ts` locks the public TypeScript surface.

The [public source](../../packages/result/fault/mod.ts) lists every public function, option and diagnostic type.
