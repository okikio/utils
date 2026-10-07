# Independent HTTP API parity

`elysia.ts` and `vixeny.ts` also implement the complete authored API and routing corpora through their native compiled
Fetch handlers. Read the [challenger guide](../../../docs/http-challengers.md) for runtime selection, dependency
preparation, literal preflights and repeated measurements. Their application adapters reproduce selected observations;
gateway forwarding and proxy lifetimes remain the two-candidate Hono/Utils fixtures below.

Each candidate implements the same small account API, using its own production stack. `hono.ts` uses Hono, native Fetch
values, and Hono's body-limit middleware. `utils.ts` uses direct HTTP, server/http, endpoint, compiled service,
resource, and gateway imports. Neither candidate imports the other's stack. Shared fixture code owns only inputs,
explicit expected outputs, request construction, and a native Fetch upstream observer.

The 35 application cases cover routing, decoded parameters, repeated query values, strict trailing slashes, GET/HEAD,
custom not-found/error policy, request-local state, middleware onion order, JSON parsing, actual body-byte admission,
framing bypass, and a compiled account service. The gateway corpus checks one deliberately configured credential,
trust-header, Connection-nominated transport-header, body, response-cookie, cache, and forwarding policy through an
in-memory upstream. No network server, remote provider, authentication service, or deployed gateway is claimed.

The body-limit vectors include UTF-8 text at 14 bytes and 15 bytes. Four `雪` characters occupy twelve bytes; adding two
ASCII bytes reaches the limit, and adding one more must reject. Counting JavaScript characters would incorrectly admit
the oversized input.

## Shared fixture calls

- `createHonoApi()` / `createUtilsApi()` own the application corpus.
- `createHonoGateway()` / `createUtilsGateway()` own `gatewayCases`.
- `createHonoRouting(count)` / `createUtilsRouting(count)` register exactly `count` routes: half static and half
  dynamic.
- `routingCases(count)` supplies first, middle, late, and missing positions for 16, 256, and 4096 routes separately.
- `request(case, origin?)` always creates a fresh Request and fresh stream body.
- `observe(response, case)` consumes output and returns the selected observable contract for comparison with
  `case.expected`.
- Each returned application has `fetch(request)` and `close()`. Close after in-flight requests settle.

Benchmark preflights must compare both candidates independently with the explicit expected results. Timed work can reuse
the application but must rebuild one-shot requests and consume response bodies. Report app construction and router
warm-up separately from steady-state dispatch. The full application has middleware and a compiled service; the
route-table workload deliberately isolates dispatch and response materialization. Neither workload qualifies every
feature or determines which stack an application should choose.

## Upstream provenance

Small input cases adapt Hono's tests at version **4.13.5**, the repository lockfile version. The annotated release tag
resolves to immutable commit **06880c4a2b04de9dd74217f26dd831209b9c01f1**.

- [hono.test.ts](https://github.com/honojs/hono/blob/06880c4a2b04de9dd74217f26dd831209b9c01f1/src/hono.test.ts): strict
  slash cases, encoded Unicode/slash parameters, middleware response modification, context variables, GET/HEAD.
- [body-limit/index.test.ts](https://github.com/honojs/hono/blob/06880c4a2b04de9dd74217f26dd831209b9c01f1/src/middleware/body-limit/index.test.ts):
  exact/over byte limits, streamed bodies, conflicting framing headers, and rejection before a non-reading handler.
- [HONO-LICENSE](HONO-LICENSE) preserves Hono's MIT copyright and permission notice.

The fixtures reconstruct these observable contracts with real streams and independently written handlers. They do not
copy Vitest machinery, private call counts, internal router classes, incidental diagnostic wording, or whole suites.

## Deliberate contract gaps

Hono's context variables and Utils' low-level Fetch middleware are different models. The Utils application explicitly
owns a WeakMap for request state; that map is fixture composition, not a new server context API. The account service
adds schema validation, transformation, declared result identity, resource lifetime, and compilation. Hono implements
this particular account rule manually; this does not establish equivalence to all service/compiler contracts.

The service-invalid-input case compares status and stable problem type only. Utils may carry additional schema/path
issues, title, and detail; those fields are outside the selected shared application contract. General safe errors are
explicitly configured on both candidates. Default framework diagnostic bodies are not adopted as requirements.

Static-before-parameter behavior is configured by registering the Hono static route first. A separate control registers
the parameter route first: Hono then selects the parameter handler, while Utils selects the more specific static route.
This difference is explicit rather than folded into the shared corpus. Both applications explicitly reject malformed
percent encoding in the item handler; that is an application policy, not a claim about either router default.
Optional/regex/wildcard routes, implicit route merging, provider authority, retries, shutdown races, and observability
are covered by their owners elsewhere rather than silently claimed by this comparison. Gateway forwarding here is a
selected application policy, not built-in Hono service compilation.
