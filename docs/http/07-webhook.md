# Verify signed webhook bytes before reading the event

Start with the [complete package example](../../packages/http/webhook/README.md). The sections below continue that
example.

A webhook is an event notification another service sends as an HTTP request. For a payment event, you must establish
who sent the message before changing an invoice. The sender signs the original bytes with a secret; the receiver checks
those bytes, the signature and the message time. Parsing and formatting the JSON before checking would change the input.

This guide supplies both sender and receiver locally. It shows authentication, not a payment system. Delivery may repeat;
the application still needs a persistent event identity and a repeat-safe business write.

## Verify a local payment event

Verify local signed bytes before reading the event payload. This program supplies its own local input and uses public
workspace imports. After `mise run prepare -- --kind deps`, save it as `example.ts` at the checkout root and run
`mise exec -- deno run example.ts`.

```ts runnable=complete-task.ts
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

Compare the output before changing the input. The remaining sections explain the options and limits; the
[package example](../../packages/http/webhook/README.md) also places this operation among adjacent capabilities.

## The contract beneath verification

| Call or value                                 | Contract                                                                     | Why it exists                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `standard.create(options)`                    | Reusable signer/verifier; application supplies one secret or a rotation list | Keeps protocol and key policy together without owning an HTTP route      |
| `sign({ id, body, timestamp? })`              | `Promise` of `webhook-id`, `webhook-timestamp`, `webhook-signature` headers  | Signs exactly the bytes the sender will transmit                         |
| `WebhookVerifier.verify(input)`               | Receives `{ body: Uint8Array, headers: Headers, now: Date }`                 | Allows a protocol adapter to operate on the same raw-input contract      |
| `verifyRequest(incoming, verifier, options?)` | `Promise<WebhookVerificationResult>`                                         | Reads a bounded clone and invokes that verifier                          |
| Successful result                             | `{ ok: true, id, timestamp, version, keyIndex }`                             | Identifies the authenticated message and accepted key                    |
| Rejected result                               | `{ ok: false, code }`                                                        | Gives a stable reason such as `invalid-signature` or `timestamp-too-old` |

For Standard Webhooks v1 the signed input is `id + "." + timestamp + "." + exact body bytes`. Verification checks the
header syntax and timestamp window, bounds the number of signatures and keys, then verifies HMAC-SHA256 through Web
Crypto. That is why parsing JSON first is unsafe: changing whitespace changes the signed bytes.

`verifyRequest()` translates body admission failures into rejection codes, but unexpected reader or verifier faults
reject its promise. Treat `ok: false` as an authentication decision and a thrown failure as a separate operational
failure. The clone keeps the original body available, but cloning is not free: a stream tee can retain bytes for the
other reader. The configured byte budget bounds this verification read, not every upstream transport allocation. See the
[full contracts](../../packages/http/README.md) for the available codes and options.

## Build on the example

For a provider callback, place verification before JSON validation in
[service middleware](../../packages/server/middleware/README.md), then let an
[endpoint](../../packages/server/endpoint/README.md) validate the verified event shape. Reject verification failures
before changing domain state. The [request package](../../packages/http/request/README.md) explains body admission; set
a budget appropriate to your provider's events.

For an event that starts background work, record its ID together with the application's accepted work, then use your
chosen [workflow](../../packages/workflow/README.md) to run it. Design the recording and duplicate check to fit your
persistence owner. Signature checks, timestamp tolerance and key rotation are not a durable replay store; subscriptions,
delivery retries and delivery history remain application-owned.

## Inbound webhooks

An inbound webhook is normally an HTTP endpoint. Verify the exact request bytes before the endpoint parses JSON or form
content.

`verifyRequest()` reads a bounded clone, so the endpoint can still parse the original request after authentication.
The runnable payment example above is this inbound path: `verifyRequest()` first, then `request.json()` only after
`verified.ok` succeeds. Return an authentication failure response when `ok` is false. A thrown reader or verifier fault
is a separate operational failure; do not silently treat it as a valid delivery.

A server integration should run this work before normal body parsing. The verification result contains stable failure
codes. It does not expose the secret, raw payload, or received signature.

## Outbound webhooks

An outbound sender should serialize a payload once, sign those exact bytes, and send the same bytes.

The following complete sender builds a POST request and checks it locally through the receiver. It opens no network
connection. Sending that same request with `fetch(outgoing)` is the later transport step; the destination, credentials,
timeout and retry policy belong to the application.

```ts runnable=outbound-webhook.ts
import * as webhook from '@okikio/http/webhook';
import * as standard from '@okikio/http/webhook/standard';

// This fixed local key makes the example reproducible. A real host supplies a secret securely.
const verifier = standard.create({ secret: 'whsec_' + btoa(String.fromCharCode(...new Uint8Array(32).fill(1))) });
const body = JSON.stringify({ kind: 'payment.received', invoiceId: 'invoice-42' });
const signed = await verifier.sign({ id: 'event-1', timestamp: 1000, body });
const outgoing = new Request('https://receiver.invalid/webhook', {
	method: 'POST',
	headers: { 'content-type': 'application/json', ...signed },
	body,
});
// The receiver reads exactly the bytes the sender placed in its request.
const accepted = await webhook.verifyRequest(outgoing, verifier, { now: new Date(1000_000) });
if (!accepted.ok) throw new Error(`Local message rejected: ${accepted.code}`);
console.log(outgoing.method, accepted.id);
```

```text output
POST event-1
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
