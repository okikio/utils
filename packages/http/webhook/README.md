# `@okikio/http/webhook`

A payment or delivery provider can POST an event to your service. Before acting on it, you need to check that its
signature matches the exact bytes received. Parsing and rewriting JSON first can change those bytes even when the
message appears equivalent. This package verifies or signs webhook messages and leaves event processing to your
application.

```text
Provider sends headers + exact body bytes
  -> verify bounded Request clone -> rejected: stop application work
                                  -> verified: parse original -> apply event once
```

The signature check reads a bounded clone, so a later parser can still read the original request. The final step belongs
to the receiving application: signature validity does not make two deliveries of the same event two distinct business
actions. Store and check the event identity when duplicates would matter.

For shared terms such as `await` and `await using`, see
[the short glossary](../../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](../API.md#webhook).

## Run a complete example

```ts runnable
import * as webhook from '@okikio/http/webhook';
import * as standard from '@okikio/http/webhook/standard';
const verifier = standard.create({ secret: 'whsec_' + btoa(String.fromCharCode(...new Uint8Array(32).fill(1))) });
const body = '{"ok":true}';
const headers = await verifier.sign({ id: 'event-1', timestamp: 1000, body });
const request = new Request('https://service.invalid/webhook', { method: 'POST', headers, body });
const verified = await webhook.verifyRequest(request, verifier, { now: new Date(1000_000) });
console.log(verified.ok, (await request.json()).ok);
```

Expected output:

```text output
true true
```

The demo creates a verifier with a fixed example key, signs `{"ok":true}` as event `event-1`, and uses a fixed
verification clock that matches the signed timestamp. The first `true` means verification accepted the signed bytes and
metadata. The second comes from parsing the original request, showing that verification did not consume it. Use
application-owned secrets and the real clock in deployment; this key and timestamp only make the demo reproducible.

## Build on the example

For a provider callback, place verification before JSON validation in
[service middleware](../../server/middleware/README.md), then let an [endpoint](../../server/endpoint/README.md)
validate the verified event shape. Reject verification failures before changing domain state. The
[request package](../request/README.md) explains body admission; set a budget appropriate to your provider's events.

For an event that starts background work, record its ID together with the application's accepted work, then use your
chosen [workflow](../../workflow/README.md) to run it. Design the recording and duplicate check to fit your persistence
owner. Signature checks, timestamp tolerance and key rotation are not a durable replay store; subscriptions, delivery
retries and delivery history remain application-owned.

## Inbound webhooks

An inbound webhook is normally an HTTP endpoint. Verify the exact request bytes before the endpoint parses JSON or form
content.

`verifyRequest()` reads a bounded clone, so the endpoint can still parse the original request after authentication:

```typescript
import * as webhook from '@okikio/http/webhook';
import * as standard from '@okikio/http/webhook/standard';

const verifier = standard.create({ secret });
const verified = await webhook.verifyRequest(request, verifier);

if (!verified.ok) {
	return new Response('Invalid webhook', { status: 401 });
}

const payload = await request.json();
```

A server integration should run this work before normal body parsing. The verification result contains stable failure
codes. It does not expose the secret, raw payload, or received signature.

## Outbound webhooks

An outbound sender should serialize a payload once, sign those exact bytes, and send the same bytes.

```typescript
const body = new TextEncoder().encode(JSON.stringify(event));
const headers = await verifier.sign({ id: event.id, body });

await fetch(destination, {
	method: 'POST',
	headers: {
		'content-type': 'application/json',
		...headers,
	},
	body,
});
```

The signer returns the webhook ID, timestamp, and signatures together. This prevents a caller from combining headers
from different signing attempts.

## Bidirectional integrations

A bidirectional integration uses both roles independently:

```text
provider  -> service endpoint -> verify -> application behavior
provider  <- HTTP sender      <- sign   <- application event
```

There is no separate bidirectional wire protocol. Each direction has its own credentials, replay window, delivery
policy, and failure handling.

## Standard Webhooks v1

`@okikio/http/webhook/standard` implements the symmetric Standard Webhooks v1 format with Web Crypto HMAC-SHA256.

The implementation supports secret rotation and places explicit limits on work:

- 24 to 64 decoded secret bytes per key
- at most 10 configured keys
- at most 10 accepted signatures
- a bounded signature header
- a bounded webhook ID
- a strict past and future timestamp window
- a bounded request body when `verifyRequest()` reads the request

`maximumKeys`, `maximumSignatures`, `maximumSignatureHeaderBytes`, `maximumIdBytes`, and `toleranceSeconds` can tighten
the defaults. The configured key and signature counts cannot raise the protocol work cap above 10.

The package does not implement asymmetric `v1a` signing. The current code does not have enough stable upstream protocol
evidence to make that a compatibility promise.

## Delivery orchestration

HTTP signing and verification are complete without a top-level webhook package. A separate `@okikio/webhook` becomes
useful when Okikio owns durable delivery semantics such as subscriptions, delivery attempts, retries, replay,
dead-letter records, endpoint health, and secret rotation workflows.

Until those concepts exist, services own inbound endpoints and outbound delivery policy. `@okikio/http/webhook` owns
only the reusable HTTP authentication mechanics.
