`@okikio/http/response`
======================

Purpose
-------

`@okikio/http/response` defines successful HTTP representations and creates
immutable logical response results.

A response definition records the stable ID, HTTP status, body schema, content
type, headers, examples, envelope policy, pagination policy, and response mode.
The package does not import Hono.  A server adapter performs final framework
materialization.

RFC 9457 error representations live in the neighboring
`@okikio/http/problem` package.


Response flow
-------------

~~~~ text
endpoint handler
  -> logical response result
  -> verify declared definition and body
  -> finalize request-aware headers and pagination
  -> server framework materialization
  -> native Response
~~~~

`response.create()` combines one exact definition with the logical body.
`response.finalize()` performs the last request-aware transformation, such as
building pagination links from the public request URL.

A raw native `Response` remains an explicit escape hatch for proxying,
WebSockets, server-sent events, or provider responses.  It is not the normal
handler result.


Headers and pagination
----------------------

Header inputs preserve repeated fields.  This is required for fields such as
`Set-Cookie` that must not be flattened into one comma-joined value.

Storage adapters return transport-neutral cursor or offset page windows.  They
do not construct public URLs.  `response.finalize()` can add RFC 8288 links and
count metadata according to the response definition.

~~~~ typescript
return response.create(WidgetPage, {
  kind: 'cursor',
  items,
  limit: 50,
  hasMore: true,
  nextCursor,
});
~~~~


Discarding an unread body
-------------------------

A native `Response` owns a readable body until the caller consumes it, transfers
that body to another response, or deliberately abandons it. Use `discard()`
when the body is no longer part of the result. The operation cancels an
unlocked body and keeps cleanup failure secondary to the HTTP decision that made
the body unnecessary.

~~~~ typescript
import * as response from '@okikio/http/response';

const upstream = await fetch(url, { signal });
if (!upstream.ok) {
  await response.discard(upstream);
  throw new Error(`Upstream returned ${upstream.status}.`);
}
~~~~

If a reader already owns the body, cancel that reader instead. `discard()` does
not take a locked stream away from its current owner.


Special HTTP helpers
--------------------

`onComplete()` observes response-body drain, cancellation, abort, or stream
failure exactly once.

Conditional response helpers support declared `304` results.  Byte-range
helpers support single open, suffix, bounded, and unsatisfiable ranges for
artifact and download adapters.

The server package owns content negotiation, endpoint membership checks, and
conversion to the framework response object.

## Recognized status is not the same as constructible status

The status helpers can recognize historical wire values that the response constructors should not emit. RFC 9110 keeps `305 Use Proxy` as deprecated and `306` as reserved/unused. `response.redirectStatus` therefore recognizes them when inspecting external HTTP, while `response.redirect()` only constructs currently supported redirect responses.

```ts
response.redirectStatus.is(305); // true: recognized historical status
response.redirectStatus.is(306); // true: recognized reserved status

response.redirect(308, {
  description: 'Resource moved permanently.',
}); // supported
```

There is no convenience constructor for 305 or 306. Manually, the distinction is the same as keeping one set for protocol recognition and a smaller set for statuses your application is willing to produce.

## Current status registry

The recognition schemas follow the current IANA HTTP Status Code Registry rather than only the original RFC 9110 table. As of August 2026, `104 Upload Resumption Supported` is a temporary informational status registered through November 13, 2026. It is recognized by `response.informationalStatus` and `response.statusAny`, but this package does not provide a response constructor for informational statuses.

```ts
response.informationalStatus.is(104); // true while the IANA registration is current
```

The manual equivalent is a reviewed status-code set derived from the IANA registry. Temporary and obsolete codes should remain visibly annotated so recognition policy can be revisited without changing application response constructors by accident.
