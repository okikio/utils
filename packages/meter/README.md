# `@okikio/meter`

Record a validated usage fact through the same authoritative effect owner as the operation. Incrementing an in-memory
counter cannot prove a billing or audit sink accepted the measurement.

## Run a complete example

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as effect from '@okikio/effect';
import * as meter from '@okikio/meter';
import { MeterReadingSchema } from '@okikio/meter';
import * as schema from '@okikio/schema';
const Bytes = meter.define({ id: 'download.bytes', unit: 'byte', aggregation: 'sum' });
await using owner = context.create({ id: 'download' });
const ctx = effect.scope(owner, {
	effects: [meter.effect(Bytes)],
	emitter: { async emit() {} },
});
const occurrence = await meter.record(ctx, Bytes, 2048, { key: 'download:asset-1' });
console.log((await schema.parse(MeterReadingSchema, occurrence.value)).value);
```

Expected output:

```text output
2048
```

## Build on the example

Define a measurement once, record it with a stable idempotency key, then attach attributes for later aggregation. A real
owner may persist the occurrence to a ledger or outbox. The example owner accepts in memory only; it is not a billing
backend. Meter definitions describe units and aggregation, while application policy decides pricing and entitlement.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/meter` gives one measurable quantity a stable, import-safe definition. Recording a measurement is modeled as a
required `@okikio/effect` occurrence, so the meter package does not need its own delivery, retry, or durability system.

Use a meter when application code needs to say **what was measured**. Do not use it for quota admission, billing policy,
aggregation storage, telemetry export, or concurrency limits.

## Start here

Define a meter without performing I/O:

```ts
import * as meter from '@okikio/meter';
import { MeterReadingSchema } from '@okikio/meter';
import * as schema from '@okikio/schema';

const DownloadBytes = meter.define({
	id: 'download.bytes',
	description: 'Bytes accepted from a source.',
	unit: 'byte',
	aggregation: 'sum',
});
```

`meter.effect(DownloadBytes)` returns the exact declared effect definition for that measurement. An activity or workflow
can declare it before runtime work starts:

```ts
const Download = activity.define({
	id: 'download',
	// input, output, and other declarations omitted here
	effects: [meter.effect(DownloadBytes)],
});
```

## Record a measurement

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

The timestamp comes from `ctx.clock`, not ambient `Date.now()`. The returned Promise resolves when the current effect
owner accepts responsibility for the measurement. It does **not** mean a downstream warehouse, billing provider, or
telemetry service has already processed it.

## Accept readings in an explicit sink

The recording operation returns `Promise<EffectOccurrence>`. The sink receives the validated occurrence and decides when
to acknowledge it. Here the application keeps accepted keys and readings in a Map. Repeating a key replaces the same
local entry; it does not add a second reading.

```ts runnable=accepted-readings.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as effect from '@okikio/effect';
import * as meter from '@okikio/meter';
import { MeterReadingSchema } from '@okikio/meter';
import * as schema from '@okikio/schema';

const Bytes = meter.define({ id: 'download.bytes', unit: 'byte', aggregation: 'sum' });
const accepted = new Map<string, number>();
await using owner = context.create({ id: 'download' });
const ctx = effect.scope(owner, {
	effects: [meter.effect(Bytes)],
	emitter: {
		async emit(_ctx, occurrence) {
			const reading = await schema.parse(MeterReadingSchema, occurrence.value);
			accepted.set(occurrence.key, reading.value);
		},
	},
});
await meter.record(ctx, Bytes, 2048, { key: 'asset-1:bytes' });
await meter.record(ctx, Bytes, 2048, { key: 'asset-1:bytes' });
console.log(accepted.size, accepted.get('asset-1:bytes'));
```

Expected output:

```text output
1 2048
```

The meter owns identity and reading validation. The emitter owns acceptance. If the emitter throws, `record()` rejects;
the caller must decide whether to retry. A durable emitter must commit its key and reading atomically before resolving.
The Map above loses its contents when the process exits and establishes no billing or warehouse delivery guarantee.
Disposing the context releases its registered cleanup; it cannot roll back a fact already accepted by an external sink.

## Catalogs

Use `catalog()`, `select()`, and `compose()` when several meters are declared as one capability surface. These
operations reuse `@okikio/catalog` semantics; they do not start a sink.

```ts
const Meters = meter.catalog('media', {
	DownloadBytes,
	Requests: meter.define({ id: 'request.count', unit: 'request' }),
});

const NetworkMeters = meter.select(Meters, ['DownloadBytes', 'Requests'] as const);
const declared = meter.compose(NetworkMeters);
```

## Convenience and the manual equivalent

| Convenience      | Manual equivalent                                                                                                            | Concrete value                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `meter.define()` | freeze measurement identity/unit/aggregation metadata yourself                                                               | one stable measurement definition                                             |
| `meter.record()` | read the context clock, build the reading envelope, create the declared effect occurrence, and submit it to the effect owner | measurement recording reuses effect acceptance instead of inventing transport |

The manual equivalent is an immutable measurement definition plus a timestamped record that you hand to your own outbox
or callback. `@okikio/meter` standardizes that shape and deliberately reuses `@okikio/effect` for delivery instead of
inventing another transport mechanism.

## Reading contract

`MeterReadingSchema` is the executable schema for the value emitted by `record()`. It is useful at durable/storage seams
that need to validate the exact measurement envelope without invoking the meter runtime.

## Source guide

1. `mod.ts` contains the definitions, catalog helpers, effect mapping, and `record()` operation.
2. `schema.ts` contains `MeterReadingSchema` and its validated reading type.
3. `types.ts` contains the public meter definition and catalog contracts.
4. `mod.test.ts` shows validation and effect emission behavior.
5. Read `@okikio/effect` when you need to understand acceptance, durability, or delivery after `record()`.

The README is the primary user documentation.

## Validator independence

`MeterReadingSchema` implements Standard Schema and Standard JSON Schema directly. `@okikio/meter` therefore does not
require Zod to validate or document its stable reading record. Applications can use any Standard Schema implementation
for surrounding domain schemas.
