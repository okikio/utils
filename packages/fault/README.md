`@okikio/fault`
==============

Purpose
-------

`@okikio/fault` turns arbitrary thrown or diagnostic runtime values into bounded,
cloneable, JSON-safe diagnostic data.

It solves a different problem from `@okikio/failure`:

```text
@okikio/failure   expected domain failure with a stable declared ID and schema
@okikio/fault     unexpected/diagnostic runtime value that must cross a safe seam
```

Start here
----------

```ts
import * as fault from '@okikio/fault';

try {
  await provider.call();
} catch (error) {
  const diagnostic = fault.encode(error);
  const message = fault.message(error);
  await channel.send({ type: 'fault', message, diagnostic });
}
```

`message()` is the convenience form when a log, observer, or wrapper `Error` needs one bounded human-readable string. It uses the same safe projection and never calls an arbitrary object's `toString()`.

`encode()` never returns the original `Error`, object, function, symbol, or
`bigint`. It creates a frozen diagnostic projection that can be cloned or encoded
as JSON. Use `fault.isRecord(diagnostic)` when a transport needs the record form
without asserting away arrays or primitive diagnostics.

Why not `JSON.stringify(error)`?
--------------------------------

`JSON.stringify()` is not a safe generic fault projector. Errors often expose
little useful enumerable data, cyclic objects throw, `bigint` throws, and object
getters can execute while serialization inspects properties.

`fault.encode()` instead:

- reads object and array entries through property descriptors;
- never invokes accessor-backed fields intentionally;
- detects circular references;
- bounds nesting depth and entries at each level;
- bounds individual strings;
- converts unsupported runtime values to stable markers;
- treats custom-prototype objects as opaque instead of calling their `toString()`.

A larger host example
---------------------

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

The limits are operational safety controls for diagnostic data. `encode()` and `message()` require an ordinary plain/null-prototype options record; accessor-backed configuration is rejected without executing the getter. They do not turn an unexpected fault into a declared business failure.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `fault.encode()` | walk property descriptors, reject accessors, track cycles in a `WeakSet`, cap depth/breadth/string length, and normalize non-JSON values | bounded diagnostics from arbitrary thrown values |
| `fault.message()` | safely project the fault first, then choose a bounded human-readable message without calling arbitrary `toString()` | error reporting cannot throw while formatting the original fault |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


The manual version is a recursive type switch around primitives, `Error`, arrays,
and plain records, with a `WeakSet` for the current recursion path and explicit
property-descriptor inspection. You also need depth, breadth, and string limits,
plus stable representations for unsupported values.

`fault.encode()` centralizes that repetitive defensive work. It does not hide a
runtime, persist data, retry work, or classify expected application failures.

Source guide
------------

1. `mod.ts` contains the complete projection algorithm and operational limits.
2. `types.ts` defines the JSON-safe output and options.
3. `mod_test.ts` stresses cycles, accessors, custom objects, and limits.
4. `type_test.ts` locks the public TypeScript surface.

The README is the primary user documentation. There is no separate hand-written
API reference to keep in sync.
