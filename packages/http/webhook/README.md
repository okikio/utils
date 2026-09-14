`@okikio/http/webhook`
======================

This package signs and verifies HTTP webhook messages without changing the bytes
covered by the signature. Route registration, subscriptions, retries, queues,
and delivery history belong to services or to a future delivery package that
owns those records.

Inbound webhooks
----------------

An inbound webhook is normally an HTTP endpoint. Verify the exact request bytes
before the endpoint parses JSON or form content.

`verifyRequest()` reads a bounded clone, so the endpoint can still parse the
original request after authentication:

~~~~ typescript
import * as webhook from '@okikio/http/webhook';
import * as standard from '@okikio/http/webhook/standard';

const verifier = standard.create({ secret });
const verified = await webhook.verifyRequest(request, verifier);

if (!verified.ok) {
  return new Response('Invalid webhook', { status: 401 });
}

const payload = await request.json();
~~~~

A server integration should run this work before normal body parsing. The
verification result contains stable failure codes. It does not expose the secret,
raw payload, or received signature.

Outbound webhooks
-----------------

An outbound sender should serialize a payload once, sign those exact bytes, and
send the same bytes.

~~~~ typescript
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
~~~~

The signer returns the webhook ID, timestamp, and signatures together. This
prevents a caller from combining headers from different signing attempts.

Bidirectional integrations
--------------------------

A bidirectional integration uses both roles independently:

~~~~ text
provider  -> service endpoint -> verify -> application behavior
provider  <- HTTP sender      <- sign   <- application event
~~~~

There is no separate bidirectional wire protocol. Each direction has its own
credentials, replay window, delivery policy, and failure handling.

Standard Webhooks v1
--------------------

`@okikio/http/webhook/standard` implements the symmetric Standard Webhooks v1
format with Web Crypto HMAC-SHA256.

The implementation supports secret rotation and places explicit limits on work:

 -  24 to 64 decoded secret bytes per key
 -  at most 10 configured keys
 -  at most 10 accepted signatures
 -  a bounded signature header
 -  a bounded webhook ID
 -  a strict past and future timestamp window
 -  a bounded request body when `verifyRequest()` reads the request

`maximumKeys`, `maximumSignatures`, `maximumSignatureHeaderBytes`,
`maximumIdBytes`, and `toleranceSeconds` can tighten the defaults. The configured
key and signature counts cannot raise the protocol work cap above 10.

The package does not implement asymmetric `v1a` signing. The current code does
not have enough stable upstream protocol evidence to make that a compatibility
promise.

Delivery orchestration
----------------------

HTTP signing and verification are complete without a top-level webhook package.
A separate `@okikio/webhook` becomes useful when Okikio owns durable delivery
semantics such as subscriptions, delivery attempts, retries, replay, dead-letter
records, endpoint health, and secret rotation workflows.

Until those concepts exist, services own inbound endpoints and outbound delivery
policy. `@okikio/http/webhook` owns only the reusable HTTP authentication
mechanics.
