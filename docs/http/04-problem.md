# Http: problem

A missing picture should produce a useful answer, not an internal exception dump. An HTTP **status** gives the broad
result, such as 404. A **problem body** adds a stable type for client code and safe detail for the person reading it.
The type URL is an identifier; creating the problem does not fetch it.

Declare the reusable missing-picture rule once. Create an individual rejection when a lookup actually fails, then send
that rejection as an ordinary Web Response. The example below shows all three values without starting a server.

## Run a complete task

Return an expected missing-record response using a declared problem. This program supplies its own local input and uses
public workspace imports. After `mise run prepare -- --kind deps`, copy it to a `.ts` file in your project and run
`mise exec -- deno run example.ts`.

```ts runnable=complete-task.ts
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
const outgoing = Response.json(body, { status, headers: { 'content-type': 'application/problem+json' } });
console.log(await outgoing.text());
```

Expected output:

```text output
404 https://problems.invalid/v1/asset-missing
{"type":"https://problems.invalid/v1/asset-missing","title":"Asset missing","status":404,"detail":"No asset has that ID."}
```

Compare the output before changing the input. The remaining sections explain the options and limits; the
[package example](../../packages/http/problem/README.md) also places this operation among adjacent capabilities.

## The reusable rule and the individual rejection

| Contract               | Contents                                                                                            | What it does                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `ProblemDefinition`    | Stable `id`, absolute `type` URI, error `status`, `title`, `description`, optional extension schema | Describes one kind of rejection              |
| `CreateProblemOptions` | Optional safe `detail`, `instance`, extensions, headers and private `cause`                         | Describes this occurrence of that rejection  |
| `ProblemResult`        | Readonly `[body, status, headers]`                                                                  | Ready-to-materialize RFC 9457 representation |

`define()` checks the ID, absolute type URI, error status and required text, then snapshots the description. `create()`
builds the public body, protects canonical members from extension collisions, and keeps the exact definition and
optional cause in hidden metadata. A service can therefore check that this result was declared on its endpoint, rather
than accepting any object that happens to contain `status: 404`.

When an extension schema is supplied, a service validates it before sending the response. `create()` does not perform
that asynchronous schema check; a manual host can call `validateExtensions()` when receiving unknown extension values.
This is why construction, validation and transport remain separate. The
[complete contracts](../../packages/http/README.md) explain exposure and retry metadata too.

## Build on the example

For an asset download, declare both the download [response](../../packages/http/response/README.md) and the
missing-asset problem on the [endpoint](../../packages/server/endpoint/README.md). The handler returns the success value
when it finds the asset and the declared problem when it does not. A [service](../../packages/server/service/README.md)
checks the returned declaration and sends the native HTTP response.

For an unexpected storage outage, keep exception details in application diagnostics and use the host's
[safe error response](../../packages/server/http/README.md). Do not put credentials, stack traces or private record
contents in caller-visible problem detail. The application decides which information is safe to disclose.

## Translate an application failure at the HTTP boundary

`@okikio/result/failure` defines an expected operation failure that can exist without HTTP. `@okikio/http/problem`
defines what an HTTP caller is allowed to see.

A service can translate one expected failure into a declared problem. The failure definition should not gain HTTP status
codes merely because one API exposes it.

Some problems have no domain failure at all. Unsupported media type, malformed request syntax, and an undeclared handler
result are examples of protocol or server conditions.

## Public safety

Problem extensions cannot overwrite canonical RFC 9457 members. An optional Standard Schema validates extension data
before the server sends it.

Definitions distinguish public and internal exposure. Provider causes can be retained in hidden local metadata for
diagnostics while the public problem body stays controlled.

The `Missing` definition above describes every missing asset response. Its `type` remains stable while the safe
`detail` can explain this occurrence. Keep private storage failures in diagnostic metadata rather than the public detail.


`problem.catalog()`, `select()`, and `compose()` build declared problem universes. `problem.is()` and `match()` preserve
exact definition identity at runtime.
