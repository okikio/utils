`@okikio/http`
=============

Purpose
-------

`@okikio/http` contains framework-neutral HTTP protocol utilities.

It owns the HTTP data and wire rules that endpoint definitions and server
runtimes share.  It does not own Hono, routing, middleware execution, service
compilation, or gateway composition.


Public areas
------------

`@okikio/http/request`
: Parses and sanitizes an untrusted Web `Request` with explicit size and trust
  rules.

`@okikio/http/cookie`
: Defines stable application cookie contracts and provides Fetch-native cookie
  helpers.

`@okikio/http/response`
: Defines successful HTTP representations and runtime occurrences.  It also
  owns headers, status schemas, pagination, conditional responses, byte ranges,
  and response-body completion observation.

`@okikio/http/problem`
: Defines RFC 9457 problem representations and runtime occurrences.



Start here
----------

The request helpers work with native Web `Request` objects. They do not replace
`Request`, `URL`, `Headers`, or `ReadableStream`.

```ts
import * as request from '@okikio/http/request';

const values = request.parseQuery('?tag=one&tag=two&enabled=true');
// { tag: ['one', 'two'], enabled: 'true' }
```

The helper performs transport parsing only. A Zod or other Standard Schema at
the endpoint layer still decides whether `enabled` is a boolean and whether the
`tag` values are valid.


Declared problem example
------------------------

```ts
import * as problem from '@okikio/http/problem';

const problemBase = 'https://problems.example.invalid/v1';
const NotFound = problem.define({
  id: 'widget:not-found',
  type: problem.url(problemBase, 'widget-not-found'),
  status: 404,
  title: 'Widget not found',
  description: 'The requested widget does not exist.',
});

const result = problem.create(NotFound, {
  detail: 'Widget "w_123" was not found.',
  instance: '/widgets/w_123',
});
```

`problem.url(base, path)` is only a convenience. Its manual equivalent is a
normalized `new URL(path, base)` call. The caller owns the stable problem
namespace; the generic HTTP package does not choose a product domain.


Larger HTTP composition
-----------------------

A service normally uses several areas together:

```ts
import * as cookie from '@okikio/http/cookie';
import * as request from '@okikio/http/request';
import * as response from '@okikio/http/response';

const QueryResult = response.ok(QueryResultSchema, {
  id: 'query-result',
  description: 'Validated query result.',
});

const url = new URL(incoming.url);
const query = request.parseQuery(url.search);
const session = await cookie.safeGet(incoming.headers, SessionCookie);
if (!session.success) return new Response(null, { status: 401 });

const logical = response.create(QueryResult, {
  query,
  workspaceId: session.value.workspaceId,
});
const finalized = response.finalize(logical, { url });
return new Response(JSON.stringify(finalized.body), {
  status: finalized.status,
  headers: { ...finalized.headers, 'content-type': 'application/json' },
});
```

At the server layer, endpoint definitions and schemas normally own the repeated
validation and response-selection work. The HTTP utility remains usable without
that convenience layer.

Query wire forms
----------------

Query parsing keeps transport syntax separate from endpoint schema semantics.
When the runtime has the raw `URL.search` string, it preserves the difference
between a bare parameter and an explicitly empty value:

```text
?loud        bare parameter
?loud=       explicit empty value
?loud=true   explicit value
```

`parseQuery()` accepts a `bareQueryParameters` policy:

- `flag` maps a bare parameter to the string `"true"`;
- `empty` maps it to an empty string;
- `reject` reports the bare form as invalid input.

The default is `empty`, which matches `URLSearchParams`. An endpoint that defines
presence-as-true syntax can opt into `flag`; `endpoint.input(...)` can scope that
policy to one query contract. Explicit `=` values are never rewritten, so
`?loud=` remains empty and can fail a schema that accepts only `true` or `false`.
Repeated values retain authored order. WHATWG `URLSearchParams` still owns
percent decoding and `+`-as-space behavior. Passing an existing
`URLSearchParams` cannot preserve the bare-versus-empty distinction because the
Web API has already normalized both forms to an empty string.

The generic reader does not coerce arbitrary text such as `42`, `null`, or JSON.
The endpoint Standard Schema remains responsible for domain-specific conversion
and validation.

How it fits
-----------

Domain code can define expected failures without HTTP.  Endpoint code selects
which success responses and HTTP problems the operation may expose.  The server
runtime validates the selected definitions and materializes the final native
`Response`.

~~~~ text
domain result or expected failure
  -> endpoint response/problem selection
  -> HTTP response or RFC 9457 problem occurrence
  -> server materialization
  -> native Response
~~~~

The package remains import-safe.  Importing it performs no network access,
starts no listener, and installs no global state.

Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`.  Read that guide when the
individual helpers make sense in isolation but their place in a service,
resource graph, runtime host, or workflow is not yet clear.

Record-shaped request options and response headers
--------------------------------------------------

When an HTTP helper accepts a JavaScript record for parsing limits or headers,
that record must be a plain object or null-prototype data record. Hidden,
inherited, symbol, and accessor properties are rejected before their values are
read. Native `Headers` objects and explicit `[name, value]` header tuples keep
their own Web-platform semantics.

This matters most for operational limits: an inherited getter must never be able
to silently change a body/header bound that the visible configuration does not
show.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `request.*` | parse headers/query/cookies/body from Web `Request`, enforce configured bounds, and normalize cancellation yourself | one deterministic request-input contract |
| `response.*` | validate status/body/header definitions, snapshot response options, build headers, pagination, conditionals, and completion observation manually | one immutable response-construction contract |
| `problem.*` | construct RFC problem envelopes, stable type URLs, response tuples, and matching helpers yourself | one shared problem-details vocabulary |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/http` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with Web Request, Response, Headers, URL, URLSearchParams, and ReadableStream directly.

The utility adds bounded parsing, declared representations, RFC 9457 contracts, cookies, forwarding rules, and completion observation while keeping the Web APIs visible.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
