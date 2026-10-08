# `@okikio/http/problem`

When an asset is missing or an input is unacceptable, callers need an answer they can understand and act on. A status
such as `404` gives the broad reason, but a stable problem type distinguishes this rejection from other failures with
the same status. This package describes expected HTTP rejections and creates their values consistently.

```text
Application result
  found   -> declared success response
  missing -> problem.create(Missing) -> body + 404 -> server sends problem JSON
```

Read the branches as application decisions. The missing branch produces a named problem with a status, title and
optional safe detail. The server sends it as an HTTP response. The problem type URL identifies the kind of rejection;
creating it does not fetch that URL or create a documentation page.

For shared terms such as `await` and `await using`, see
[the short glossary](../../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](../API.md#problem).

## Run a complete example

```ts runnable
import * as problem from '@okikio/http/problem';
const Missing = problem.define({
	id: 'asset.missing',
	type: problem.url('https://problems.invalid/v1', 'asset-missing'),
	status: 404,
	title: 'Asset missing',
	description: 'The asset could not be found.',
});
const [body, status] = problem.create(Missing, { detail: 'No asset has that ID.' });
console.log(status, body.type);
```

Expected output:

```text output
404 https://problems.invalid/v1/asset-missing
```

The demo defines the missing-asset rejection once, then creates one occurrence with the detail `No asset has that ID.`.
The returned pair contains the problem body and HTTP status. Printing `404` and the type URL shows the two stable facts
a caller can use to choose a missing-asset screen or recovery action. This example creates a value; it does not send a
network response or expose an internal exception.

## Build on the example

For an asset download, declare both the download [response](../response/README.md) and the missing-asset problem on the
[endpoint](../../server/endpoint/README.md). The handler returns the success value when it finds the asset and the
declared problem when it does not. A [service](../../server/service/README.md) checks the returned declaration and sends
the native HTTP response.

For an unexpected storage outage, keep exception details in application diagnostics and use the host's
[safe error response](../../server/http/README.md). Do not put credentials, stack traces or private record contents in
caller-visible problem detail. The application decides which information is safe to disclose.

## Purpose

`@okikio/http/problem` defines RFC 9457 HTTP error representations.

A problem definition records the public type URI, HTTP status, title, description, retry guidance, exposure policy,
examples, and optional extension schema. A problem result contains the final RFC 9457 body and HTTP headers.

The package is generic across HTTP applications, but the concept itself is HTTP-specific.

## How it fits

`@okikio/failure` defines an expected operation failure that can exist without HTTP. `@okikio/http/problem` defines what
an HTTP caller is allowed to see.

A service can translate one expected failure into a declared problem. The failure definition should not gain HTTP status
codes merely because one API exposes it.

Some problems have no domain failure at all. Unsupported media type, malformed request syntax, and an undeclared handler
result are examples of protocol or server conditions.

## Public safety

Problem extensions cannot overwrite canonical RFC 9457 members. An optional Standard Schema validates extension data
before the server sends it.

Definitions distinguish public and internal exposure. Provider causes can be retained in hidden local metadata for
diagnostics while the public problem body stays controlled.

```typescript
const NotFound = problem.define({
	id: 'widgets.not-found',
	type: 'https://api.example.invalid/problems/widget-not-found',
	status: 404,
	title: 'Widget not found',
	description: 'The widget does not exist or is not visible.',
});
```

`problem.catalog()`, `select()`, and `compose()` build declared problem universes. `problem.is()` and `match()` preserve
exact definition identity at runtime.
