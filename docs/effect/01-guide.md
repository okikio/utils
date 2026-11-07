# Give a business announcement an explicit recipient

Suppose saving a photo must also leave a record for an audit. Your save function needs to know whether another part
of the program accepted that record. `effect.emit()` checks the announcement and waits for the recipient to accept it.

The recipient decides what acceptance means. A demo can append to an array. A service that must survive a restart
can save a message in a database table for later delivery. That table is an **outbox**. Saving a message there proves
the handoff, but it does not prove that the audit system has received the message yet. A diagnostic log alone proves
neither.

| Term | Value in this example | Responsibility |
| --- | --- | --- |
| Definition | Saved | Name asset.saved and validate its payload shape |
| Occurrence | Asset asset-1 with key save:asset-1 | Identify this logical announcement across retries |
| Emitter | The configured emit callback | Accept the checked occurrence or reject the handoff |
| Recipient | The local accepted array through that callback | Retain the key in memory; supply no restart durability |

The producer validates the occurrence first, then awaits recipient acceptance. Any later external delivery has its own
owner and acknowledgement. The example below stops at local acceptance.

## Accept a saved-asset announcement

Declare the announcement and give it a recipient before emitting it. The local recipient lets you inspect the accepted
value. Replace it with a durable recipient only when the announcement must survive this process.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as `example.ts` at the checkout root and use
`mise exec -- deno run example.ts`.

```ts runnable
import * as context from '@okikio/context';
import * as effect from '@okikio/capability/effect';
import * as schema from '@okikio/schema';

// Define the announcement before choosing who will accept it.
const Saved = effect.define({ id: 'asset.saved', value: schema.object({ id: schema.string() }) });

// This lifetime owns cancellation and cleanup, not downstream delivery.
await using owner = context.create({ id: 'save' });

// This recipient accepts into memory only; restart would lose these records.
const accepted: string[] = [];
const ctx = effect.scope(owner, {
	effects: [Saved],
	emitter: {
		/** Accept the occurrence in this local demo; production persistence belongs to the receiver. */
		async emit(_ctx, occurrence) {
			accepted.push(occurrence.key);
		},
	},
});

// The stable key identifies this occurrence. An in-memory receiver alone cannot deduplicate across restarts.
await effect.emit(ctx, Saved, { id: 'asset-1' }, { key: 'save:asset-1' });
console.log(accepted.join(','));
```

Expected output:

```text output
save:asset-1
```

## Follow one saved asset through the handoff

`Saved` is import-safe metadata: it names `asset.saved` and its payload schema. The scope permits that exact definition. The occurrence is the checked `{ id: 'asset-1' }` plus the stable key `save:asset-1`. The emitter is the recipient: in this example it appends to the `accepted` array. Creating the scope does none of those business operations.

To prepare the occurrence without sending it, replace the `emit` call with `const occurrence = await effect.create(Saved, { id: 'asset-1' }, { key: 'save:asset-1' })`. Creation validates the value but does not contact the recipient. Later, the application can call `effect.emit(ctx, occurrence)`. Keep the same logical key on a retry; an attempt number identifies a different thing.

Make the recipient throw `new Error('Audit store unavailable')` before appending to see acceptance fail. Catch the `emit` Promise at the call site and report or reconcile that failure; do not print the success line. A previous asset write is still a previous write. Failure to announce cannot roll it back, and an uncertain durable acknowledgement must be reconciled before repeating external work.

## Acceptance has an exact meaning

When configured, `emit()` resolves when the `EffectEmitter` accepts responsibility for the occurrence. Acceptance is the
point after which the producer may rely on the announcement having an owner. An unconfigured emitter only matters when
code actually calls `emit()`.

Acceptance can mean different concrete things:

- a direct handler completed the required work;
- a database transaction committed an outbox record;
- a queue durably accepted an idempotent item;
- another runtime accepted responsibility for later delivery.

Acceptance does not mean every asynchronous consequence has finished.

A direct recipient can use `effect.emitter(effect.implement(Saved, async (_ctx, occurrence) => { accepted.push(occurrence.key); }))`. The handler receives the exact validated asset occurrence and must finish its required work before returning. A compiled service can bind that recipient through its effect adapter; consult [Server](../../packages/server/README.md) only when the application actually needs a service host.

A declaration permits an announcement, so a service can start without an effect owner. An actual `emit()` call requires
that owner and fails with `MissingEffectEmitterError` when none is bound. If code tries to emit an effect that the
execution did not declare, `UndeclaredEffectError` fails that call.

## Atomicity is owned where the side effect occurs

`effect.emit()` does not make an earlier database mutation and a later announcement atomic by itself.

When the domain mutation and the announcement must commit together, the application must put both under one
authoritative transaction or outbox design. For example:

```text
transaction
  |
  +-- update domain row
  +-- insert effect outbox occurrence
  `-- commit
          |
          v
      effect accepted
          |
          v
      later delivery
```

A billing reservation, usage commitment, audit record, or workflow-start event may need this stronger form. A direct
in-memory emitter is appropriate only when its weaker ownership semantics are acceptable.

## Use `outbox()` when queue acceptance is the handoff point

`effect.outbox()` provides a queue-backed `EffectEmitter`. Producer acceptance occurs when the queue accepts the
idempotent encoded occurrence. `drain()` later claims occurrences and sends each one to its exact handler.

The following is a composition sketch: the application supplies a queue and `handleSavedAsset`. It is not an additional standalone program.

```typescript
await using effects = effect.outbox({
	queue,
	handlers: [
		effect.implement(Saved, handleSavedAsset),
	],
	maximumAttempts: 8,
	retryDelay: { seconds: 1 },
});
```

The outbox separates producer acceptance from downstream completion while retaining the same definition identity and
stable occurrence key.

## Scopes enforce declarations

Hosts attach the definitions available to an execution with `effect.scope()`. Service, activity, and workflow runtimes
do this from their compiled/static contracts.

```typescript
const effectCtx = effect.scope(ctx, {
	effects: [Saved],
	emitter,
});
```

The scope is a typed `@okikio/context` view. It borrows the parent lifetime and does not create a registry or hidden
resource container. Omitting options preserves an existing effect view; supplied options replace its declarations and
recipient. Capability's [scope example](../../packages/capability/README.md#save-a-note-with-explicit-dependencies)
combines this same view with resource borrowing and requirement interpretation.

The service compiler gathers effects contributed by the service, targeted service policies, endpoint groups, endpoint
paths, endpoint operations, and middleware. A resource does not silently add side effects to an operation. If an
externally visible side effect is part of the operation contract, declare it at a service or execution composition layer
where callers and tooling can see it.

## Durable transport revalidates data

`encode()` stores the stable definition ID, logical key, and validated value. `decode()` accepts trusted imported
definitions and validates the value again before recreating an occurrence.

```typescript
const encoded = await effect.encode(occurrence);
const restored = await effect.decode(encoded, [Saved]);
```

The encoded envelope must be an inert plain record with own enumerable data properties. Accessor-backed transport values
are rejected without invoking their getters.

The occurrence wrapper is shallowly frozen. Its schema-produced `value` is borrowed. A schema or producer that requires
immutable nested data must enforce that rule itself.

## Cancellation and failure

`emit()` checks cancellation before transferring responsibility. If cancellation wins before the emitter accepts the
occurrence, the producer cannot assume the announcement exists.

After the emitter resolves, ownership has transferred. Later producer cancellation does not recall the accepted
occurrence.

The main failures are deliberate and specific:

| Failure                        | Meaning                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `UndeclaredEffectError`        | Code tried to announce an effect outside the declarations available to this execution. |
| `MissingEffectEmitterError`    | The execution declared effects but no live owner can accept an emission.               |
| `DuplicateEffectHandlerError`  | Two direct/outbox handlers claim the same exact definition.                            |
| `MissingEffectHandlerError`    | The owner has no handler for an occurrence it was asked to deliver.                    |
| `UnknownEffectDefinitionError` | Durable data names an effect definition not trusted by this receiving process.         |

## Use effects for required announcements, not diagnostics

An effect is appropriate when the system needs an explicit, typed record that a side effect occurred or when another
component must accept responsibility for a required consequence.

Typical examples include:

- usage and meter occurrences;
- billing or balance consequences;
- audit records that must not disappear silently;
- notification or webhook delivery intents;
- workflow or activity side-effect announcements;
- domain events whose delivery is part of correctness.

Metrics, logs, and traces normally use observers instead. An observer is allowed to fail without changing a successful
application result; an announced effect is not.

## Observe accepted effects

Use `effect.observe()` when a caller needs to display accepted effects. Supply a recipient when the effect must also be
accepted by a business owner:

```ts
using reports = effect.observe({ emitter: recipient, onError: reportError });
using subscription = reports.events.subscribe((occurrence) => {
	show(occurrence.definition.id, occurrence.value);
});
// Bind reports as the declared effect emitter of a service or local activity.
```

The observer borrows `recipient`. It publishes only after that recipient accepts the occurrence. Closing the observer
does not close the recipient or revoke already accepted work. It rejects new emissions and completes subscribers.
Subscriber failures go to `onError`; they do not change the work result. Omit the recipient when the report itself is
the whole declared effect.

`latest` contains the latest accepted report. The stream has no replay history. Pending notifications can combine into
one snapshot. A slow earlier emission cannot replace a newer accepted report. Close the observer when its owner ends.
Unsubscribe when only a display ends. Keep callbacks short because they still run in this process.

This observer does not schedule work after an HTTP response. The application's existing effect recipient still owns that
scheduling and lifetime. Use an outbox for delivery that must survive process loss. Use
[Task progress](../task/03-progress.md) for a local operation, or [saved workflow progress](../workflows/12-progress.md)
for a durable activity.
