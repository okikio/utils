# `@okikio/http/problem`

When an asset is missing or an input is unacceptable, callers need an answer they can understand and act on. A status
such as `404` gives the broad reason, but a stable problem type distinguishes this rejection from other failures with
the same status. This package describes expected HTTP rejections and creates their values consistently.

A **status** is HTTP's numeric result, such as 200 for success or 404 for a missing resource. A **problem body** adds
machine-readable information to a rejected request. Its stable `type` tells client code which case occurred; `detail`
explains this particular occurrence to a person. Keep internal stack traces and secrets out of that public body.

```text
Application result
  found   -> declared success response
  missing -> problem.create(Missing) -> body + 404 -> server sends problem JSON
```

Read the branches as application decisions. The missing branch produces a named problem with a status, title and
optional safe detail. The server sends it as an HTTP response. The problem type URL identifies the kind of rejection;
creating it does not fetch that URL or create a documentation page.

## Give a missing record a useful HTTP answer

Give a missing asset a stable problem type and a 404 response. The diagnostic detail explains this occurrence, while the
type URL lets a caller recognize the failure independently of its wording.

After the [checkout setup](../../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
import * as problem from '@okikio/http/problem';
import { toHeaders } from '@okikio/http/response';
const Missing = problem.define({
	id: 'asset.missing',
	type: problem.url('https://problems.invalid/v1', 'asset-missing'),
	status: 404,
	title: 'Asset missing',
	description: 'The asset could not be found.',
});
// Build the declared problem body and use its HTTP status when creating the actual Response.
const [body, status, headers] = problem.create(Missing, { detail: 'No asset has that ID.' });
console.log(status, body.type);
// Preserve generated and application headers, including the default no-store policy.
const outgoing = Response.json(body, { status, headers: toHeaders(headers) });
console.log(outgoing.headers.get('cache-control'));
console.log(await outgoing.text());
```

Expected output:

```text output
404 https://problems.invalid/v1/asset-missing
no-store
{"type":"https://problems.invalid/v1/asset-missing","title":"Asset missing","status":404,"detail":"No asset has that ID."}
```

The demo defines the missing-asset rejection once, then creates one occurrence with the detail `No asset has that ID.`.
The logical result contains body, HTTP status and headers. Printing `404` and the type URL shows two stable facts a
caller can use to choose a missing-asset screen or recovery action. The native Response preserves all returned headers;
`no-store` confirms that the default cache policy survived conversion. The last line reads its exact JSON. No network
connection is made and no internal exception is exposed.

You can send this value without a service compiler. Its JSON contains `type`, `title`, `status` and the supplied
`detail`; it does not contain an exception stack.

## Choose adjacent capabilities

Use Problem for an expected HTTP rejection with a declared wire shape. Result Failure names domain rejection
independently of HTTP, while Fault projects unexpected exceptions into diagnostics.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

Continue in the [numbered guide](https://github.com/okikio/utils/blob/main/docs/http/04-problem.md) for composition,
ownership, and failure behavior.
