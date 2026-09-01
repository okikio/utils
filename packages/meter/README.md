`@okikio/meter`
==============

Purpose
-------

`@okikio/meter` gives one measurable quantity a stable, import-safe definition.
Recording a measurement is modeled as a required `@okikio/effect` occurrence, so
the meter package does not need its own delivery, retry, or durability system.

Use a meter when application code needs to say **what was measured**. Do not use
it for quota admission, billing policy, aggregation storage, telemetry export,
or concurrency limits.

Start here
----------

Define a meter without performing I/O:

```ts
import * as meter from '@okikio/meter';

const DownloadBytes = meter.define({
  id: 'download.bytes',
  description: 'Bytes accepted from a source.',
  unit: 'byte',
  aggregation: 'sum',
});
```

`meter.effect(DownloadBytes)` returns the exact required-effect definition for
that measurement. An activity or workflow can declare it before runtime work
starts:

```ts
const Download = activity.define({
  id: 'download',
  // input, output, and other declarations omitted here
  effects: [meter.effect(DownloadBytes)],
});
```

Record a measurement
--------------------

`record()` requires an effect-aware Context and a caller-stable key:

```ts
await meter.record(ctx, DownloadBytes, bytesRead, {
  key: `download:${assetId}:bytes`,
  attributes: {
    format: 'mp4',
    source: 'remote',
  },
});
```

The timestamp comes from `ctx.clock`, not ambient `Date.now()`. The returned
Promise resolves when the current effect owner accepts responsibility for the
measurement. It does **not** mean a downstream warehouse, billing provider, or
telemetry service has already processed it.

Larger composition
------------------

A durable host can connect the same meter to a durable effect outbox without
changing the code that records measurements:

```ts
const RequiredEffects = effect.catalog('download', {
  DownloadBytes: meter.effect(DownloadBytes),
});

const effectCtx = effect.scope(ctx, {
  allowed: RequiredEffects,
  outbox: durableEffectOutbox,
});

await meter.record(effectCtx, DownloadBytes, chunk.byteLength, {
  key: `download:${downloadId}:chunk:${chunkIndex}`,
  attributes: { source: 'origin' },
});
```

The meter still owns only identity and the reading shape. The effect owner owns
acceptance and delivery. A billing package can consume accepted readings later
without making billing a dependency of `@okikio/meter`.

Catalogs
--------

Use `catalog()`, `select()`, and `compose()` when several meters are declared as
one capability surface. These operations reuse `@okikio/catalog` semantics; they
do not start a sink.

```ts
const Meters = meter.catalog('media', {
  DownloadBytes,
  Requests: meter.define({ id: 'request.count', unit: 'request' }),
});

const NetworkMeters = meter.select(Meters, ['DownloadBytes', 'Requests'] as const);
const declared = meter.compose(NetworkMeters);
```

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `meter.define()` | freeze measurement identity/unit/aggregation metadata yourself | one stable measurement definition |
| `meter.record()` | read the context clock, build the reading envelope, create the required effect occurrence, and submit it to the effect owner | measurement recording reuses effect acceptance instead of inventing transport |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


The manual equivalent is an immutable measurement definition plus a timestamped
record that you hand to your own outbox or callback. `@okikio/meter` standardizes
that shape and deliberately reuses `@okikio/effect` for delivery instead of
inventing another transport mechanism.

Reading contract
----------------

`MeterReadingSchema` is the executable schema for the value emitted by
`record()`. It is useful at durable/storage seams that need to validate the exact
measurement envelope without invoking the meter runtime.


Source guide
------------

1. `mod.ts` contains the definitions, catalog helpers, effect mapping, and
   `record()` operation.
2. `types.ts` contains the public definition, reading, and catalog contracts.
3. `mod_test.ts` shows validation and effect emission behavior.
4. Read `@okikio/effect` when you need to understand acceptance, durability, or
   delivery after `record()`.

The README is the primary user documentation.
