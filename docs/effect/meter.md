# Record a usage fact through a responsible recipient

A download accepts 2,048 bytes. Recording that usage should identify the measured quantity, its unit, the time, and the
logical download. A supplied recipient accepts responsibility for the record and decides how to store or aggregate it.
The meter keeps that handoff consistent without choosing a billing backend.

Meter supports accounting and audit facts. It is not a runtime metrics exporter. Dropping an operational metric may be
acceptable; dropping a required usage record can change billing or audit outcomes.

## Record the bytes accepted from one download

Define a byte counter, attach a recipient, and record one 2,048-byte download. Both output values are 2048: one comes
from the returned occurrence and the other from the recipient that accepted it. The array is local evidence of
acceptance.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as `example.ts` at the checkout root and use
`mise exec -- deno run example.ts`.

```ts runnable=package-task.ts
import * as context from '@okikio/context';
import * as effect from '@okikio/capability/effect';
import * as meter from '@okikio/capability/effect/meter';
import { MeterReadingSchema } from '@okikio/capability/effect/meter';
import * as schema from '@okikio/schema';
const Bytes = meter.define({ id: 'download.bytes', unit: 'byte', aggregation: 'sum' });
await using owner = context.create({ id: 'download' });
const accepted: number[] = [];
const ctx = effect.scope(owner, {
	effects: [meter.effect(Bytes)],
	emitter: {
		async emit(_ctx, occurrence) {
			accepted.push((await schema.parse(MeterReadingSchema, occurrence.value)).value);
		},
	},
});
const occurrence = await meter.record(ctx, Bytes, 2048, { key: 'download:asset-1' });
console.log((await schema.parse(MeterReadingSchema, occurrence.value)).value);
console.log(accepted.join(','));
```

Expected output:

```text output
2048
2048
```

## Keep measurement separate from billing policy

`@okikio/capability/effect/meter` gives one measurable quantity a stable, import-safe definition. Recording a
measurement is modeled as a required `@okikio/capability/effect` occurrence, so the meter package does not need its own
delivery, retry, or durability system.

Use a meter when application code needs to say **what was measured**. Do not use it for quota admission, billing policy,
aggregation storage, telemetry export, or concurrency limits.

## Declare the quantity and unit

Define a meter without performing I/O:

```ts
import * as meter from '@okikio/capability/effect/meter';

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
import * as context from '@okikio/context';
import * as effect from '@okikio/capability/effect';
import * as meter from '@okikio/capability/effect/meter';
import { MeterReadingSchema } from '@okikio/capability/effect/meter';
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
operations reuse `@okikio/collection/catalog` semantics; they do not start a sink.

```ts
const Meters = meter.catalog('media', {
	DownloadBytes,
	Requests: meter.define({ id: 'request.count', unit: 'request' }),
});

const NetworkMeters = meter.select(Meters, ['DownloadBytes', 'Requests'] as const);
const declared = meter.compose(NetworkMeters);
console.log(declared.map((entry) => entry.id).join(','));
```

## Reading contract

`MeterReadingSchema` is the executable schema for the value emitted by `record()`. Use it when a store needs
to validate the exact measurement envelope without invoking the meter runtime.

## Decide which bookkeeping to keep in your application

| Convenience      | Manual equivalent                                                                                                            | Concrete value                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `meter.define()` | freeze measurement identity/unit/aggregation metadata yourself                                                               | one stable measurement definition                                             |
| `meter.record()` | read the context clock, build the reading envelope, create the declared effect occurrence, and submit it to the effect owner | measurement recording reuses effect acceptance instead of inventing transport |

The manual equivalent is an immutable measurement definition plus a timestamped record that you hand to your own outbox
or callback. `@okikio/capability/effect/meter` standardizes that shape and deliberately reuses
`@okikio/capability/effect` for delivery instead of inventing another transport mechanism.

## Source guide

The paths below are relative to the [package directory](../../packages/capability/effect/meter).

1. `mod.ts` contains the definitions, catalog helpers, effect mapping, and `record()` operation.
2. `schema.ts` contains `MeterReadingSchema` and its validated reading type.
3. `types.ts` contains the public meter definition and catalog contracts.
4. `mod.test.ts` shows validation and effect emission behavior.
5. Read `@okikio/capability/effect` when you need to understand acceptance, durability, or delivery after `record()`.

The README is the primary user documentation.

## Validator independence

`MeterReadingSchema` implements Standard Schema and Standard JSON Schema directly. `@okikio/capability/effect/meter`
therefore does not require Zod to validate or document its stable reading record. Applications can use any Standard
Schema implementation for surrounding domain schemas.
