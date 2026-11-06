# `@okikio/http/webhook`

A payment or delivery provider can POST an event to your service. Before acting on it, you need to check that its
signature matches the exact bytes received. Parsing and rewriting JSON first can change those bytes even when the
message appears equivalent. This package verifies or signs webhook messages and leaves event processing to your
application.

A **webhook** is an HTTP request another service sends to notify your application about an event. Unlike a person
clicking a button, that caller is a program. A **signature** lets you check that the message matches a shared secret and
its original bytes. It does not tell you that the same valid message has never been delivered before.

Treat delivery as repeatable: check the signature and timestamp, validate the event fields, and make the business action
safe to repeat using the provider's event identity. The example below signs and checks a local message so you can see
both sides without needing an account with an external provider.

```text
Provider sends headers + exact body bytes
  -> verify bounded Request clone -> rejected: stop application work
                                  -> verified: check identity + parse original -> application-owned effect
```

The signature check reads a bounded clone, so a later parser can still read the original request. The final step belongs
to the receiving application: signature validity does not make two deliveries of the same event two distinct business
actions. Store and check the event identity when duplicates would matter.

## Check a signed event before reading its JSON

Sign a small event with the chosen webhook contract, then verify the received bytes before reading their JSON. The
example supplies its own key and request so it runs locally; real peers must agree on the protocol and key.

These examples use the current experimental source checkout, not an assumed registry release. From the `utils`
repository root, review `mise.toml`, run `mise trust`, then `mise install` and `mise run prepare -- --kind deps`.
Save the following module as `example.ts` and run `mise exec -- deno run example.ts`.
[Checkout prerequisites](../../../README.md#work-on-the-repository) explain installing Mise.

```ts runnable
import * as webhook from '@okikio/http/webhook';
import * as standard from '@okikio/http/webhook/standard';
const verifier = standard.create({ secret: 'whsec_' + btoa(String.fromCharCode(...new Uint8Array(32).fill(1))) });
// Sign the exact text that will be sent. Reformatting equivalent JSON would change its signature.
const body = '{"kind":"payment.received","invoiceId":"invoice-42"}';
const headers = await verifier.sign({ id: 'event-1', timestamp: 1000, body });
const request = new Request('https://service.invalid/webhook', { method: 'POST', headers, body });
const verified = await webhook.verifyRequest(request, verifier, { now: new Date(1000_000) });
if (!verified.ok) throw new Error(`Payment event rejected: ${verified.code}`);
// Verification reads a bounded clone, leaving the original request available for parsing.
const event = await request.json();
console.log(verified.id, event.kind, event.invoiceId);
```

Expected output:

```text output
event-1 payment.received invoice-42
```

The demo signs a local payment-event fixture as `event-1` with a fixed example key and a matching verification clock.
Only after verification succeeds does it parse the original request and read the invoice identity. This shows the order
an inbound payment route needs without pretending to contact a payment provider. It does not mark the invoice paid or
deduplicate deliveries. Validate the event schema and commit its identity with the business update in your application.
Use application-owned secrets and the real clock in deployment; this key and timestamp only make the demo reproducible.

## Signed time and injected clocks

The Standard Webhooks wire timestamp is a positive, safe integer count of Unix seconds. Its digits-only guard defines
signed protocol text; it is not a calendar-date parser. Verification accepts the existing `now: Date` injection, while
signing accepts a Date or epoch seconds. Date access here adapts that public host contract, and tolerance compares the
signed epoch value with the verification epoch value. A monotonic process clock cannot replace those instants because
the sender and verifier are separate hosts. Calendar ISO parsing is not involved.

## Admit a signed delivery once

`protect(verifier, options)` adds replay admission to an existing protocol verifier. Pass the returned verifier to
`verifyRequest` to retain its bounded raw-body read and original Request ownership. Supply
`store.claim(identity, expiresAt)` with the cross-process atomicity and retention required by the receiving service.

Save this independent continuation as `payment-replay.ts` and run `mise exec -- deno run payment-replay.ts`.
The Map is a **single-process demonstration store**: its synchronous claim has no await between lookup and insertion.
It is neither durable nor shared between replicas; deployment needs a store with the atomic cross-process contract.

```ts runnable=payment-replay.ts
import * as webhook from '@okikio/http/webhook';
import * as standard from '@okikio/http/webhook/standard';
const now = new Date(1000_000);
const retained = new Map<string, number>();
let claims = 0;
const verifier = standard.create({ secret: 'whsec_' + btoa(String.fromCharCode(...new Uint8Array(32).fill(1))) });
const guarded = webhook.protect(verifier, {
	namespace: 'payments:invoice-service',
	maximumIdentityBytes: 256,
	maximumAgeSeconds: 10,
	maximumFutureSeconds: 1,
	store: {
		claim(identity, expiresAt) {
			claims++;
			if ((retained.get(identity) ?? 0) > now.getTime()) return false;
			retained.set(identity, expiresAt);
			return true;
		},
	},
});
const body = '{"kind":"payment.received","invoiceId":"invoice-42"}';
const headers = await verifier.sign({ id: 'event-1', timestamp: 1000, body });
for (const delivered of [body, body, body + ' ']) {
	const request = new Request('https://service.invalid/webhook', { method: 'POST', headers, body: delivered });
	const result = await webhook.verifyRequest(request, guarded, { maximumBodyBytes: 1024, now });
	console.log(
		result.ok ? 'Accepted event-1' : result.code === 'duplicate' ? 'Duplicate rejected' : 'Changed bytes rejected',
	);
}
console.log('Store claims:', claims);
```

```text output
Accepted event-1
Duplicate rejected
Changed bytes rejected
Store claims: 2
```

The duplicate reaches storage after authentication. The whitespace-modified JSON is still parseable but its signed
bytes differ, so it fails before storage. This is why a parser must not normalize the body before verification. The
example stores only admission identities; it deliberately performs no invoice update.

The protocol authenticates first, including its own timestamp policy. The wrapper then applies the explicit age/future
window and atomically claims the encoded `[namespace, authenticated ID]`. The identity byte bound includes both
namespace and ID. Exact body bytes are unchanged. Invalid signature/time/body outcomes do not claim storage. A duplicate
returns `{ ok: false, code: 'duplicate' }`; a store fault throws and cannot admit a message. The wrapper borrows both
capabilities and never closes or clears either.

Store retention ends **after** the final valid timestamp second, not at its start. For timestamp 1000 seconds and
maximum age 10 seconds, a delivery remains valid at 1010.999 seconds; the claim must remain until 1011.000 seconds.
Replicas must share namespace, atomic store and clock policy. Early eviction breaks the replay contract. There is no
implicit global in-memory cache.

Claim success is admission, not a transaction containing the application's effect. A crash after claim but before the
effect can lose that delivery. A durable inbox or effect requiring reliable recovery must join admission and its state
transition in the service's own transaction. This wrapper does not add retries or exactly-once effect guarantees.

## Choose adjacent capabilities

Use Webhook for an incoming signed event and Signature for lower-level authenticated bytes. Verify the raw body before
parsing JSON. The application owns secrets, protocol choice, clock policy, the atomic replay store and the accepted event destination.
Use `protect()` above when admission must reject duplicate authenticated IDs; that wrapper still cannot commit an
invoice update atomically.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

Continue in the [numbered guide](https://github.com/okikio/utils/blob/main/docs/http/07-webhook.md) for composition,
ownership, and failure behavior.
