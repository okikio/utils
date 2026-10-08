# @okikio/http contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                             | Source                                               | Reference                                   |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `@okikio/http`                     | [./mod.ts](./mod.ts)                                 | [root](#root)                               |
| `@okikio/http/cookie`              | [./cookie/mod.ts](./cookie/mod.ts)                   | [cookie](#cookie)                           |
| `@okikio/http/headers`             | [./headers.ts](./headers.ts)                         | [headers](#headers)                         |
| `@okikio/http/problem`             | [./problem/mod.ts](./problem/mod.ts)                 | [problem](#problem)                         |
| `@okikio/http/problem/testing`     | [./problem/testing/mod.ts](./problem/testing/mod.ts) | [problem-testing](#problem-testing)         |
| `@okikio/http/problem/types`       | [./problem/types.ts](./problem/types.ts)             | [problem-types](#problem-types)             |
| `@okikio/http/request`             | [./request/mod.ts](./request/mod.ts)                 | [request](#request)                         |
| `@okikio/http/request/types`       | [./request/types.ts](./request/types.ts)             | [request-types](#request-types)             |
| `@okikio/http/response`            | [./response/mod.ts](./response/mod.ts)               | [response](#response)                       |
| `@okikio/http/response/body`       | [./response/body.ts](./response/body.ts)             | [response-body](#response-body)             |
| `@okikio/http/response/completion` | [./response/completion.ts](./response/completion.ts) | [response-completion](#response-completion) |
| `@okikio/http/response/headers`    | [./response/headers.ts](./response/headers.ts)       | [response-headers](#response-headers)       |
| `@okikio/http/response/http`       | [./response/http.ts](./response/http.ts)             | [response-http](#response-http)             |
| `@okikio/http/response/status`     | [./response/status.ts](./response/status.ts)         | [response-status](#response-status)         |
| `@okikio/http/response/types`      | [./response/types.ts](./response/types.ts)           | [response-types](#response-types)           |
| `@okikio/http/webhook`             | [./webhook/mod.ts](./webhook/mod.ts)                 | [webhook](#webhook)                         |
| `@okikio/http/webhook/standard`    | [./webhook/standard.ts](./webhook/standard.ts)       | [webhook-standard](#webhook-standard)       |

## root

Import `@okikio/http`. [Source](./mod.ts).

Preserve HTTP syntax and trust decisions before application validation. Collapsing repeated query parameters or
forwarding incoming credentials blindly changes what the caller asked for and what the next service can see.

Use request helpers to bound and parse incoming data, response and problem definitions to declare outputs, and webhook
helpers to verify exact raw bytes. headers.forward() strips fixed connection fields and fields named by Connection while
retaining separate Set-Cookie values. request.forwardHeaders() adds credential and host trust policy. The application
still authenticates actors and decides what credentials may cross an origin.

### root: cookie

[Declaration source](mod.ts#L16)

````text
namespace cookie
  Preserve HTTP syntax and trust decisions before application validation. Collapsing repeated query parameters or forwarding incoming credentials blindly changes what the caller asked for and what the next service can see.

  Use request helpers to bound and parse incoming data, response and problem definitions to declare outputs, and webhook helpers to verify exact raw bytes. headers.forward() strips fixed connection fields and fields named by Connection while retaining separate Set-Cookie values. request.forwardHeaders() adds credential and host trust policy. The application still authenticates actors and decides what credentials may cross an origin.

  @example
      ```ts
      import * as request from '@okikio/http/request';
      import { forward } from '@okikio/http/headers';
      console.log(JSON.stringify(request.parseQuery('?tag=one&tag=two')));
      const headers = forward(new Headers({ Connection: 'X-Internal', 'X-Internal': 'secret', Accept: 'application/json' }));
      console.log(headers.has('x-internal'), headers.get('accept'));
      ```

  @module

  reference define: ./packages/http/cookie/mod.ts:33:1
    Define one import-safe application cookie contract.
  reference cookieCatalog: ./packages/http/cookie/mod.ts:52:1
    Create a named immutable cookie catalog.
  reference select: ./packages/http/cookie/mod.ts:60:1
    Select an immutable key-preserving cookie subset.
  reference compose: ./packages/http/cookie/mod.ts:71:1
    Compose cookie definitions, catalogs, selections, and nested arrays.
  reference safeGet: ./packages/http/cookie/mod.ts:78:1
    Parse one cookie from a Request or Headers object.
  reference get: ./packages/http/cookie/mod.ts:97:1
    Parse one cookie and throw a TypeError when its value is invalid.
  reference set: ./packages/http/cookie/mod.ts:109:1
    Append one Set-Cookie field without overwriting other cookie writes.
  reference document: ./packages/http/cookie/mod.ts:130:1
    Create deterministic JSON-safe cookie documentation.
  reference catalog: ./packages/http/cookie/mod.ts:52:1
    Create a named immutable cookie catalog.
  reference delete: ./packages/http/cookie/mod.ts:119:1
    Append an expired Set-Cookie field for one definition.
  reference CookieAttributes: ./packages/http/cookie/mod.ts:285:3
  reference CookieDefinition: ./packages/http/cookie/mod.ts:286:3
  reference CookieDefinitionInput: ./packages/http/cookie/mod.ts:287:3
  reference CookieDocument: ./packages/http/cookie/mod.ts:288:3
  reference CookieReadResult: ./packages/http/cookie/mod.ts:289:3
  reference CookieSameSite: ./packages/http/cookie/mod.ts:290:3
  reference CookieValue: ./packages/http/cookie/mod.ts:291:3
  reference SetCookieOptions: ./packages/http/cookie/mod.ts:292:3
````

### root: problem

[Declaration source](mod.ts#L17)

````text
namespace problem
  Give an expected HTTP rejection a stable type, status and remediation contract.

  Declare problems on endpoints, map expected domain failures to them and keep unexpected faults in redacted diagnostics. A service owns which details a caller may see.

  @example
      ```ts
      import * as problem from '@okikio/http/problem';
      const Missing = problem.define({ id: 'asset.missing', type: problem.url('https://problems.invalid/v1', 'asset-missing'), status: 404, title: 'Asset missing', description: 'The asset could not be found.' });
      const [body, status] = problem.create(Missing, { detail: 'No asset has that ID.' });
      console.log(status, body.type);
      ```

  @module

  reference url: ./packages/http/problem/mod.ts:45:1
    Resolve one stable problem type URL below a caller-owned namespace.

    This is a convenience for `new URL(path, base)`. The helper normalizes the
    base pathname so callers do not accidentally replace its final segment when
    they omit a trailing slash.
  reference namespace: ./packages/http/problem/mod.ts:57:1
    Create a reusable resolver for one caller-owned problem type namespace.

    This is equivalent to repeatedly calling `url(base, path)`. It is useful when
    a package defines several RFC 9457 problem types below one stable base URL.
  reference define: ./packages/http/problem/mod.ts:64:1
    Define one immutable RFC 9457 problem contract.
  reference problemCatalog: ./packages/http/problem/mod.ts:96:1
    Create a named immutable problem catalog.
  reference select: ./packages/http/problem/mod.ts:104:1
    Select an immutable key-preserving problem subset.
  reference compose: ./packages/http/problem/mod.ts:115:1
    Compose problem definitions, catalogs, selections, and nested arrays.
  reference create: ./packages/http/problem/mod.ts:122:1
    Instantiate one problem occurrence as an RFC 9457 tuple.
  reference is: ./packages/http/problem/mod.ts:178:1
    Return whether a value is any problem result or belongs to one definition/input.
  function is<Definition extends ProblemDefinition>(value: unknown, definition: Definition): value is ProblemResult<Definition>
    Return whether a value belongs to one exact problem definition.
  function is<Entry extends ProblemDefinition>(value: unknown, input: DefinitionInput<Entry>): value is ProblemResult<Entry>
    Return whether a value belongs to any problem in a composed definition input.
    Narrow a value to a problem result and optionally one exact declared universe.
  reference definitionOf: ./packages/http/problem/mod.ts:199:1
    Return the exact imported definition retained by a problem tuple.
  reference causeOf: ./packages/http/problem/mod.ts:207:1
    Return the internal cause retained by a problem tuple, when present.
  reference match: ./packages/http/problem/mod.ts:213:1
    Exhaustively branch by direct definition identity using catalog keys.
  function match<Entry extends ProblemDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>, Result>(value: ProblemResult<Entry>, universe: Catalog<Entry, Entries> | CatalogSelection<Entry, Entries>, handlers: Partial<readonly [Key in keyof Entries]: (value: ProblemResult<Entries[Key]>) => Result>, options: { readonly otherwise: (value: ProblemResult<Entry>) => Result; }): Result
    Branch through partial handlers with one required fallback.
    Dispatch a problem result through exhaustive or fallback handlers.
  reference map: ./packages/http/problem/mod.ts:253:1
    Exhaustively translate one problem universe into problem results.
  reference document: ./packages/http/problem/mod.ts:266:1
    Create JSON-safe documentation from definitions, catalogs, or selections.
  reference validateExtensions: ./packages/http/problem/mod.ts:398:1
    Validate definition extension values against the optional Standard Schema contract.
  reference catalog: ./packages/http/problem/mod.ts:96:1
    Create a named immutable problem catalog.
  reference CreateProblemOptions: ./packages/http/problem/mod.ts:435:3
  reference ProblemBody: ./packages/http/problem/mod.ts:436:3
  reference ProblemDefinition: ./packages/http/problem/mod.ts:437:3
  reference ProblemDefinitionInput: ./packages/http/problem/mod.ts:438:3
  reference ProblemDocument: ./packages/http/problem/mod.ts:439:3
  reference ProblemExample: ./packages/http/problem/mod.ts:440:3
  reference ProblemExtensionContract: ./packages/http/problem/mod.ts:441:3
  reference ProblemHeaders: ./packages/http/problem/mod.ts:442:3
  reference ProblemProviderMetadata: ./packages/http/problem/mod.ts:443:3
  reference ProblemResult: ./packages/http/problem/mod.ts:444:3
  reference ProblemResultMetadata: ./packages/http/problem/mod.ts:445:3
  reference ProblemRetryPolicy: ./packages/http/problem/mod.ts:446:3
  reference ProblemSeverity: ./packages/http/problem/mod.ts:447:3
  reference ProblemStatus: ./packages/http/problem/mod.ts:448:3
````

### root: request

[Declaration source](mod.ts#L18)

````text
namespace request
  Read bounded request bytes and preserve query multiplicity before domain validation.

  Choose the body budget before reading, then validate the decoded shape with an endpoint schema. Cancellation and one-byte-over-limit cases fail without returning a partial body.

  @example
      ```ts
      import * as request from '@okikio/http/request';
      console.log(JSON.stringify(request.parseQuery('?tag=a&tag=b')));
      const incoming = new Request('https://service.invalid/import', { method: 'POST', body: 'abc' });
      console.log(new TextDecoder().decode(await request.readBody(incoming, { maximumBodyBytes: 3 })));
      ```

  @module

  reference parseAuthorization: ./packages/http/request/mod.ts:15:10
  reference parseForm: ./packages/http/request/mod.ts:16:10
  reference parseJson: ./packages/http/request/mod.ts:16:21
  reference readBody: ./packages/http/request/mod.ts:16:32
  reference negotiateContent: ./packages/http/request/mod.ts:17:10
  reference parseMediaType: ./packages/http/request/mod.ts:17:28
  reference requireContentType: ./packages/http/request/mod.ts:17:44
  reference parseCookies: ./packages/http/request/mod.ts:18:10
  reference forwardHeaders: ./packages/http/request/mod.ts:19:10
  reference ForwardHeaderOptionsType: ./packages/http/request/mod.ts:20:15
  reference externalUrl: ./packages/http/request/mod.ts:21:10
  reference parseHeaders: ./packages/http/request/mod.ts:22:10
  reference redactHeaders: ./packages/http/request/mod.ts:22:24
  reference parseContentLength: ./packages/http/request/mod.ts:23:10
  reference formatPath: ./packages/http/request/mod.ts:24:10
  reference normalizePath: ./packages/http/request/mod.ts:24:22
  reference validationDetail: ./packages/http/request/mod.ts:24:37
  reference validationDetails: ./packages/http/request/mod.ts:24:55
  reference DefaultRequestParsingLimits: ./packages/http/request/mod.ts:25:10
  reference limits: ./packages/http/request/mod.ts:25:39
  reference disposeMemo: ./packages/http/request/mod.ts:26:10
  reference invalidateMemo: ./packages/http/request/mod.ts:26:34
  reference memoize: ./packages/http/request/mod.ts:26:64
  reference parseParameters: ./packages/http/request/mod.ts:27:10
  reference correlation: ./packages/http/request/mod.ts:29:3
  reference correlationFields: ./packages/http/request/mod.ts:30:3
  reference parseTraceParent: ./packages/http/request/mod.ts:31:3
  reference parseTraceState: ./packages/http/request/mod.ts:32:3
  reference propagationHeaders: ./packages/http/request/mod.ts:33:3
  reference requestId: ./packages/http/request/mod.ts:34:3
  reference parseQuery: ./packages/http/request/mod.ts:36:10
  reference RequestTransportError: ./packages/http/request/mod.ts:37:10
  reference DuplicateCookiePolicy: ./packages/http/request/mod.ts:39:3
  reference ForwardedHeaderPolicy: ./packages/http/request/mod.ts:40:3
  reference MediaType: ./packages/http/request/mod.ts:41:3
  reference ParsedAuthorization: ./packages/http/request/mod.ts:42:3
  reference RequestIssue: ./packages/http/request/mod.ts:43:3
  reference RequestIssueCode: ./packages/http/request/mod.ts:44:3
  reference RequestParsingLimits: ./packages/http/request/mod.ts:45:3
  reference RequestParsingOptions: ./packages/http/request/mod.ts:46:3
  reference SensitiveCredential: ./packages/http/request/mod.ts:47:3
  reference WireRecord: ./packages/http/request/mod.ts:48:3
  reference WireValue: ./packages/http/request/mod.ts:49:3
  reference RequestInputSource: ./packages/http/request/mod.ts:52:15
  reference RequestValidationDetail: ./packages/http/request/mod.ts:52:35
  reference RequestCorrelation: ./packages/http/request/mod.ts:53:15
  reference RequestCorrelationFieldOptions: ./packages/http/request/mod.ts:53:35
  reference RequestCorrelationOptions: ./packages/http/request/mod.ts:53:67
````

### root: response

[Declaration source](mod.ts#L19)

````text
namespace response
  Keep a successful representation tied to one schema and attach a safe download name.

  Add pagination, repeated headers, conditional responses or byte ranges as the representation needs them. The server validates an occurrence against its endpoint declarations and materializes the native Response; a filename header does not authorize access to a file.

  @example
      ```ts
      import * as response from '@okikio/http/response';
      import { z } from 'zod';
      const Saved = response.ok(z.object({ id: z.string() }), { id: 'asset.saved', description: 'Saved asset.' });
      const value = response.finalize(response.create(Saved, { id: 'asset-1' }));
      console.log(value.status);
      console.log(response.attachmentDisposition('reports/quarterly.csv'));
      ```

  @module

  reference accepted: ./packages/http/response/mod.ts:18:3
  reference compose: ./packages/http/response/mod.ts:19:3
  reference created: ./packages/http/response/mod.ts:20:3
  reference define: ./packages/http/response/mod.ts:21:3
  reference document: ./packages/http/response/mod.ts:22:3
  reference download: ./packages/http/response/mod.ts:23:3
  reference html: ./packages/http/response/mod.ts:24:3
  reference noContent: ./packages/http/response/mod.ts:25:3
  reference notModified: ./packages/http/response/mod.ts:26:3
  reference ok: ./packages/http/response/mod.ts:27:3
  reference paginated: ./packages/http/response/mod.ts:28:3
  reference partialContent: ./packages/http/response/mod.ts:29:3
  reference redirect: ./packages/http/response/mod.ts:30:3
  reference catalog: ./packages/http/response/mod.ts:31:3
  reference select: ./packages/http/response/mod.ts:32:3
  reference stream: ./packages/http/response/mod.ts:33:3
  reference onComplete: ./packages/http/response/mod.ts:35:10
  reference discard: ./packages/http/response/mod.ts:36:10
  reference readText: ./packages/http/response/mod.ts:37:10
  reference byteRange: ./packages/http/response/mod.ts:38:10
  reference byteRangeHeaders: ./packages/http/response/mod.ts:38:21
  reference conditionalHeaders: ./packages/http/response/mod.ts:38:39
  reference isNotModified: ./packages/http/response/mod.ts:38:59
  reference ByteRange: ./packages/http/response/mod.ts:39:15
  reference ResponseCompletion: ./packages/http/response/mod.ts:40:15
  reference appendHeaders: ./packages/http/response/mod.ts:41:10
  reference headerEntries: ./packages/http/response/mod.ts:41:25
  reference headers: ./packages/http/response/mod.ts:41:40
  reference headerValues: ./packages/http/response/mod.ts:41:49
  reference mergeHeaders: ./packages/http/response/mod.ts:41:63
  reference mergeVary: ./packages/http/response/mod.ts:41:77
  reference toHeaders: ./packages/http/response/mod.ts:41:88
  reference statusAny: ./packages/http/response/mod.ts:43:3
  reference clientErrorStatus: ./packages/http/response/mod.ts:44:3
  reference contentfulStatus: ./packages/http/response/mod.ts:45:3
  reference contentlessStatus: ./packages/http/response/mod.ts:46:3
  reference informationalStatus: ./packages/http/response/mod.ts:47:3
  reference isStatus: ./packages/http/response/mod.ts:48:3
  reference isContentlessStatus: ./packages/http/response/mod.ts:49:3
  reference isProblemStatus: ./packages/http/response/mod.ts:50:3
  reference problemStatus: ./packages/http/response/mod.ts:51:3
  reference redirectStatus: ./packages/http/response/mod.ts:52:3
  reference serverErrorStatus: ./packages/http/response/mod.ts:53:3
  reference successStatus: ./packages/http/response/mod.ts:54:3
  reference ClientErrorStatus: ./packages/http/response/mod.ts:59:3
  reference ContentfulStatus: ./packages/http/response/mod.ts:60:3
  reference ContentlessStatus: ./packages/http/response/mod.ts:61:3
  reference HttpStatus: ./packages/http/response/mod.ts:62:3
  reference HttpStatusSchema: ./packages/http/response/mod.ts:63:3
  reference InformationalStatus: ./packages/http/response/mod.ts:64:3
  reference ProblemStatus: ./packages/http/response/mod.ts:65:3
  reference RedirectStatus: ./packages/http/response/mod.ts:66:3
  reference ServerErrorStatus: ./packages/http/response/mod.ts:67:3
  reference SuccessStatus: ./packages/http/response/mod.ts:68:3
  reference create: ./packages/http/response/mod.ts:70:10
  reference definitionOf: ./packages/http/response/mod.ts:70:18
  reference finalize: ./packages/http/response/mod.ts:70:32
  reference is: ./packages/http/response/mod.ts:70:42
  reference pageHeaders: ./packages/http/response/mod.ts:70:46
  reference pageLinks: ./packages/http/response/mod.ts:70:59
  reference withHeaders: ./packages/http/response/mod.ts:70:70
  reference withMeta: ./packages/http/response/mod.ts:70:83
  reference CreateResponseOptions: ./packages/http/response/mod.ts:72:3
  reference CursorPageWindow: ./packages/http/response/mod.ts:73:3
  reference FinalizedResponseResult: ./packages/http/response/mod.ts:74:3
  reference FinalizeResponseOptions: ./packages/http/response/mod.ts:75:3
  reference HeaderField: ./packages/http/response/mod.ts:76:3
  reference HeaderInput: ./packages/http/response/mod.ts:77:3
  reference HeaderValue: ./packages/http/response/mod.ts:78:3
  reference HtmlBody: ./packages/http/response/mod.ts:79:3
  reference HtmlChunk: ./packages/http/response/mod.ts:80:3
  reference NormalizedPageWindow: ./packages/http/response/mod.ts:81:3
  reference OffsetPageWindow: ./packages/http/response/mod.ts:82:3
  reference PageWindow: ./packages/http/response/mod.ts:83:3
  reference PaginationLinkContext: ./packages/http/response/mod.ts:84:3
  reference PaginationLinks: ./packages/http/response/mod.ts:85:3
  reference PaginationMetadata: ./packages/http/response/mod.ts:86:3
  reference PaginationParameters: ./packages/http/response/mod.ts:87:3
  reference PaginationResponsePolicy: ./packages/http/response/mod.ts:88:3
  reference ResponseBody: ./packages/http/response/mod.ts:89:3
  reference ResponseDefinition: ./packages/http/response/mod.ts:90:3
  reference ResponseDefinitionInput: ./packages/http/response/mod.ts:91:3
  reference ResponseDocument: ./packages/http/response/mod.ts:92:3
  reference ResponseEnvelope: ./packages/http/response/mod.ts:93:3
  reference ResponseExample: ./packages/http/response/mod.ts:94:3
  reference ResponseHeaders: ./packages/http/response/mod.ts:95:3
  reference ResponseResult: ./packages/http/response/mod.ts:96:3
  reference ResponseResultMetadata: ./packages/http/response/mod.ts:97:3
  reference ResponseSchema: ./packages/http/response/mod.ts:98:3
  reference ResponseStatus: ./packages/http/response/mod.ts:99:3
  reference SuccessEnvelope: ./packages/http/response/mod.ts:100:3
  reference attachmentDisposition: ./packages/http/response/mod.ts:103:10
  namespace status
    HTTP status recognition schemas; constructible response statuses are a separate policy.
````

### root: webhook

[Declaration source](mod.ts#L20)

````text
namespace webhook
  Authenticate the exact received bytes while keeping the original request available to its parser.

  The fixed test key and clock make this example reproducible. A real application supplies secrets and replay policy. Verify before parsing, then add key rotation and bounded raw-body admission; delivery retries and deduplication belong to the receiving service.

  @example
      ```ts
      import * as webhook from '@okikio/http/webhook';
      import * as standard from '@okikio/http/webhook/standard';
      const verifier = standard.create({ secret: 'whsec_' + btoa(String.fromCharCode(...new Uint8Array(32).fill(1))) });
      const body = '{"ok":true}';
      const headers = await verifier.sign({ id: 'event-1', timestamp: 1000, body });
      const request = new Request('https://service.invalid/webhook', { method: 'POST', headers, body });
      const verified = await webhook.verifyRequest(request, verifier, { now: new Date(1000_000) });
      console.log(verified.ok, (await request.json()).ok);
      ```

  @module

  reference verifyRequest: ./packages/http/webhook/mod.ts:31:1
    Authenticate a bounded clone of a Web Request without consuming the original.

    This is intended for `beforeValidation`-style middleware. Signature
    verification observes exact bytes first; ordinary parsing and Standard Schema
    validation can then consume a separate clone or the original request.
  reference VerifyRequestOptions: ./packages/http/webhook/mod.ts:67:3
  reference WebhookPayload: ./packages/http/webhook/mod.ts:68:3
  reference WebhookVerificationFailure: ./packages/http/webhook/mod.ts:69:3
  reference WebhookVerificationFailureCode: ./packages/http/webhook/mod.ts:70:3
  reference WebhookVerificationInput: ./packages/http/webhook/mod.ts:71:3
  reference WebhookVerificationResult: ./packages/http/webhook/mod.ts:72:3
  reference WebhookVerificationSuccess: ./packages/http/webhook/mod.ts:73:3
  reference WebhookVerifier: ./packages/http/webhook/mod.ts:74:3
  namespace standard
    Symmetric Standard Webhooks signing, verification, key rotation and bounded admission.
````

## cookie

Import `@okikio/http/cookie`. [Source](./cookie/mod.ts).

Declare and validate a cookie once instead of repeating unsafe parsing and security attributes.

Use safeGet() for ordinary invalid-input branches and keep independent Set-Cookie fields. The application must still
authenticate the token, rotate credentials and decide session expiry.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding        | Contract owner or source                                    |
| ----------------------- | ----------------------------------------------------------- |
| `catalog`               | [catalog contracts](../catalog/API.md)                      |
| `getCookies`            | [External source](https://jsr.io/@std/http/1.1.3/cookie.ts) |
| `appendSetCookie`       | [External source](https://jsr.io/@std/http/1.1.3/cookie.ts) |
| `StandardCookie`        | [External source](https://jsr.io/@std/http/1.1.3/cookie.ts) |
| `Catalog`               | [catalog contracts](../catalog/API.md)                      |
| `CatalogSelection`      | [catalog contracts](../catalog/API.md)                      |
| `DefinitionInput`       | [catalog contracts](../catalog/API.md)                      |
| `CookieAttributes`      | [Source](cookie/types.ts)                                   |
| `CookieDefinition`      | [Source](cookie/types.ts)                                   |
| `CookieDefinitionInput` | [Source](cookie/types.ts)                                   |
| `CookieDocument`        | [Source](cookie/types.ts)                                   |
| `CookieReadResult`      | [Source](cookie/types.ts)                                   |
| `CookieValue`           | [Source](cookie/types.ts)                                   |
| `SetCookieOptions`      | [Source](cookie/types.ts)                                   |

### cookie: catalog

[Declaration source](cookie/mod.ts#L52)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, CookieDefinition>>>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries>
  Create a named immutable cookie catalog.
```

### cookie: compose

[Declaration source](cookie/mod.ts#L71)

```text
function compose<Entry extends CookieDefinition>(...input: readonly DefinitionInput<Entry>[]): readonly Entry[]
  Compose cookie definitions, catalogs, selections, and nested arrays.
```

### cookie: cookieCatalog

[Declaration source](cookie/mod.ts#L52)

```text
function cookieCatalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, CookieDefinition>>>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries>
  Create a named immutable cookie catalog.
```

### cookie: define

[Declaration source](cookie/mod.ts#L33)

```text
function define<Schema extends import("@standard-schema/spec").StandardSchemaV1<string, string>>(input: CookieDefinitionInput<Schema>): CookieDefinition<Schema>
  Define one import-safe application cookie contract.
```

### cookie: delete

[Declaration source](cookie/mod.ts#L119)

```text
function delete(headers: Headers, definition: CookieDefinition): void
  Append an expired Set-Cookie field for one definition.
```

### cookie: document

[Declaration source](cookie/mod.ts#L130)

```text
function document(input: DefinitionInput<CookieDefinition>): readonly CookieDocument[]
  Create deterministic JSON-safe cookie documentation.
```

### cookie: get

[Declaration source](cookie/mod.ts#L97)

```text
async function get<Definition extends CookieDefinition>(input: Request | Headers, definition: Definition): Promise<CookieValue<Definition> | undefined>
  Parse one cookie and throw a TypeError when its value is invalid.
```

### cookie: safeGet

[Declaration source](cookie/mod.ts#L78)

```text
async function safeGet<Definition extends CookieDefinition>(input: Request | Headers, definition: Definition): Promise<CookieReadResult<CookieValue<Definition>>>
  Parse one cookie from a Request or Headers object.
```

### cookie: select

[Declaration source](cookie/mod.ts#L60)

```text
function select<Entries extends Readonly<Record<PropertyKey, CookieDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: Catalog<Entries[keyof Entries], Entries>, keys: Keys): CatalogSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select an immutable key-preserving cookie subset.
```

### cookie: set

[Declaration source](cookie/mod.ts#L109)

```text
function set<Definition extends CookieDefinition>(headers: Headers, definition: Definition, value: CookieValue<Definition>, options: SetCookieOptions): void
  Append one Set-Cookie field without overwriting other cookie writes.
```

### cookie: CookieAttributes

[Declaration source](cookie/types.ts#L7)

```text
interface CookieAttributes
  Static attributes applied whenever a cookie is written.

  readonly domain?: string
    Domain attribute explicitly selected for the cookie.
  readonly path?: string
    Explicit cookie Path attribute.
  readonly secure?: boolean
    Whether cookie serialization includes the Secure attribute.
  readonly httpOnly?: boolean
    Whether cookie serialization includes the HttpOnly attribute.
  readonly sameSite?: CookieSameSite
    Explicit SameSite attribute serialized for this cookie.
  readonly partitioned?: boolean
    Whether cookie serialization includes the Partitioned attribute.
  readonly priority?: "low" | "medium" | "high"
    Explicit cookie Priority attribute, when selected.
  readonly maxAge?: number
    Cookie Max-Age in seconds.
```

### cookie: CookieDefinition

[Declaration source](cookie/types.ts#L27)

```text
interface CookieDefinition<Schema extends StandardSchemaV1<string, string> = StandardSchemaV1<string, string>> extends CatalogEntryIdentity
  Import-safe definition of one stable application cookie.

  readonly kind: "cookie"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly name: string
    Wire cookie name; distinct from its catalog definition ID.
  readonly value: Schema
    Standard Schema used to validate the string cookie value.
  readonly attributes: CookieAttributes
    Static cookie attributes retained by the definition.
```

### cookie: CookieDefinitionInput

[Declaration source](cookie/types.ts#L40)

```text
interface CookieDefinitionInput<Schema extends StandardSchemaV1<string, string>>
  Input accepted by `cookie.define()`.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly name: string
    Wire cookie name; distinct from its catalog definition ID.
  readonly value: Schema
    Standard Schema used to validate the string cookie value.
  readonly attributes?: CookieAttributes
    Static cookie attributes retained by the definition.
```

### cookie: CookieDocument

[Declaration source](cookie/types.ts#L70)

```text
interface CookieDocument
  JSON-safe cookie definition projection.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly name: string
    Wire cookie name retained in documentation.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly attributes: CookieAttributes
    Static cookie attributes retained by the definition.
```

### cookie: SetCookieOptions

[Declaration source](cookie/types.ts#L57)

```text
interface SetCookieOptions
  Optional per-occurrence attributes applied while setting a cookie.

  readonly expires?: Temporal.Instant | Date
    Per-occurrence cookie expiry instant supplied by the caller.
  readonly maxAge?: number
    Per-occurrence cookie Max-Age in seconds.
```

### cookie: CookieReadResult

[Declaration source](cookie/types.ts#L65)

```text
type CookieReadResult<Value> = Readonly<{ readonly success: true; readonly value: Value | undefined; }> | Readonly<{ readonly success: false; readonly issues: readonly StandardSchemaV1.Issue[]; }>
  Non-throwing cookie read result.
```

### cookie: CookieSameSite

[Declaration source](cookie/types.ts#L4)

```text
type CookieSameSite = "strict" | "lax" | "none"
  Browser SameSite policy for an application cookie.
```

### cookie: CookieValue

[Declaration source](cookie/types.ts#L54)

```text
type CookieValue<Definition extends CookieDefinition> = StandardSchemaV1.InferOutput<Definition["value"]>
  Output inferred from a cookie definition's Standard Schema.
```

## headers

Import `@okikio/http/headers`. [Source](./headers.ts).

### headers: forward

[Declaration source](headers.ts#L39)

````text
function forward(input: Headers): Headers
  Copy the HTTP fields that can pass from one connection to the next.

  The `Connection` header can name other fields that apply only to the incoming
  connection. This function removes those fields and the fixed connection fields.
  Invalid option tokens are ignored. Valid options are still removed, so a
  malformed upstream list cannot prevent forwarding its other response fields.
  It preserves separate `Set-Cookie` values and does not change the input.
  The caller still decides which credentials, cache fields and content metadata
  the next connection can receive.

  For a proxy that must keep upstream cookies, copy the headers first. Then
  remove metadata for an encoding that Fetch has already decoded.

  @example
      ```ts
      const upstream = new Headers({ 'content-encoding': 'gzip' });
      upstream.append('set-cookie', 'session=one; Path=/; HttpOnly');
      upstream.append('set-cookie', 'session-data=two; Path=/; HttpOnly');
      const headers = forward(upstream);
      headers.delete('content-encoding');
      ```
````

## problem

Import `@okikio/http/problem`. [Source](./problem/mod.ts).

Give an expected HTTP rejection a stable type, status and remediation contract.

Declare problems on endpoints, map expected domain failures to them and keep unexpected faults in redacted diagnostics.
A service owns which details a caller may see.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding           | Contract owner or source                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| `StandardSchemaV1`         | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `catalog`                  | [catalog contracts](../catalog/API.md)                                     |
| `record`                   | [record contracts](../record/API.md)                                       |
| `Catalog`                  | [catalog contracts](../catalog/API.md)                                     |
| `CatalogSelection`         | [catalog contracts](../catalog/API.md)                                     |
| `DefinitionInput`          | [catalog contracts](../catalog/API.md)                                     |
| `mergeHeaders`             | [Source](response/headers.ts)                                              |
| `CreateProblemOptions`     | [Source](problem/types.ts)                                                 |
| `ProblemBody`              | [Source](problem/types.ts)                                                 |
| `ProblemDefinition`        | [Source](problem/types.ts)                                                 |
| `ProblemDefinitionInput`   | [Source](problem/types.ts)                                                 |
| `ProblemDocument`          | [Source](problem/types.ts)                                                 |
| `ProblemExtensionContract` | [Source](problem/types.ts)                                                 |
| `ProblemHeaders`           | [Source](problem/types.ts)                                                 |
| `ProblemResult`            | [Source](problem/types.ts)                                                 |
| `ProblemResultMetadata`    | [Source](problem/types.ts)                                                 |
| `ProblemRetryPolicy`       | [Source](problem/types.ts)                                                 |
| `ProblemStatus`            | [Source](problem/types.ts)                                                 |

### problem: catalog

[Declaration source](problem/mod.ts#L96)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, ProblemDefinition>>>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries>
  Create a named immutable problem catalog.
```

### problem: causeOf

[Declaration source](problem/mod.ts#L207)

```text
function causeOf(value: ProblemResult): unknown
  Return the internal cause retained by a problem tuple, when present.
```

### problem: compose

[Declaration source](problem/mod.ts#L115)

```text
function compose<Entry extends ProblemDefinition>(...inputs: readonly DefinitionInput<Entry>[]): readonly Entry[]
  Compose problem definitions, catalogs, selections, and nested arrays.
```

### problem: create

[Declaration source](problem/mod.ts#L122)

```text
function create<Definition extends ProblemDefinition, Extensions extends Readonly<Record<string, unknown>> = Readonly<Record<string, never>>>(definition: Definition, options: CreateProblemOptions<Extensions>): ProblemResult<Definition, ProblemBody<Definition> & Extensions>
  Instantiate one problem occurrence as an RFC 9457 tuple.
```

### problem: define

[Declaration source](problem/mod.ts#L64)

```text
function define<Extensions extends ProblemExtensionContract | undefined = undefined, Status extends ProblemStatus = ProblemStatus>(input: ProblemDefinitionInput<Extensions, Status>): ProblemDefinition<Extensions, Status>
  Define one immutable RFC 9457 problem contract.
```

### problem: definitionOf

[Declaration source](problem/mod.ts#L199)

```text
function definitionOf<Definition extends ProblemDefinition>(value: ProblemResult<Definition>): Definition
  Return the exact imported definition retained by a problem tuple.
```

### problem: document

[Declaration source](problem/mod.ts#L266)

```text
function document(input: DefinitionInput<ProblemDefinition>): readonly ProblemDocument[]
  Create JSON-safe documentation from definitions, catalogs, or selections.
```

### problem: is

[Declaration source](problem/mod.ts#L178)

```text
function is(value: unknown): value is ProblemResult
  Return whether a value is any problem result or belongs to one definition/input.
```

[Declaration source](problem/mod.ts#L180)

```text
function is<Definition extends ProblemDefinition>(value: unknown, definition: Definition): value is ProblemResult<Definition>
  Return whether a value belongs to one exact problem definition.
```

[Declaration source](problem/mod.ts#L185)

```text
function is<Entry extends ProblemDefinition>(value: unknown, input: DefinitionInput<Entry>): value is ProblemResult<Entry>
  Return whether a value belongs to any problem in a composed definition input.

  Narrow a value to a problem result and optionally one exact declared universe.
```

### problem: map

[Declaration source](problem/mod.ts#L253)

```text
function map<Entry extends ProblemDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>, Result extends ProblemResult>(value: ProblemResult<Entry>, universe: Catalog<Entry, Entries> | CatalogSelection<Entry, Entries>, handlers: readonly [Key in keyof Entries]: (value: ProblemResult<Entries[Key]>) => Result): Result
  Exhaustively translate one problem universe into problem results.
```

### problem: match

[Declaration source](problem/mod.ts#L213)

```text
function match<Entry extends ProblemDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>, Result>(value: ProblemResult<Entry>, universe: Catalog<Entry, Entries> | CatalogSelection<Entry, Entries>, handlers: readonly [Key in keyof Entries]: (value: ProblemResult<Entries[Key]>) => Result): Result
  Exhaustively branch by direct definition identity using catalog keys.
```

[Declaration source](problem/mod.ts#L223)

```text
function match<Entry extends ProblemDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>, Result>(value: ProblemResult<Entry>, universe: Catalog<Entry, Entries> | CatalogSelection<Entry, Entries>, handlers: Partial<readonly [Key in keyof Entries]: (value: ProblemResult<Entries[Key]>) => Result>, options: { readonly otherwise: (value: ProblemResult<Entry>) => Result; }): Result
  Branch through partial handlers with one required fallback.

  Dispatch a problem result through exhaustive or fallback handlers.
```

### problem: namespace

[Declaration source](problem/mod.ts#L57)

```text
function namespace(base: string | URL): (path: string) => string
  Create a reusable resolver for one caller-owned problem type namespace.

  This is equivalent to repeatedly calling `url(base, path)`. It is useful when
  a package defines several RFC 9457 problem types below one stable base URL.
```

### problem: problemCatalog

[Declaration source](problem/mod.ts#L96)

```text
function problemCatalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, ProblemDefinition>>>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries>
  Create a named immutable problem catalog.
```

### problem: select

[Declaration source](problem/mod.ts#L104)

```text
function select<Entries extends Readonly<Record<PropertyKey, ProblemDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: Catalog<Entries[keyof Entries], Entries>, keys: Keys): CatalogSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select an immutable key-preserving problem subset.
```

### problem: url

[Declaration source](problem/mod.ts#L45)

```text
function url(base: string | URL, path: string): string
  Resolve one stable problem type URL below a caller-owned namespace.

  This is a convenience for `new URL(path, base)`. The helper normalizes the
  base pathname so callers do not accidentally replace its final segment when
  they omit a trailing slash.
```

### problem: validateExtensions

[Declaration source](problem/mod.ts#L398)

```text
async function validateExtensions<Definition extends ProblemDefinition>(definition: Definition, value: unknown): Promise<readonly StandardSchemaV1.Issue[]>
  Validate definition extension values against the optional Standard Schema contract.
```

### problem: CreateProblemOptions

[Declaration source](problem/mod.ts#L435)

```text
reference CreateProblemOptions: ./packages/http/problem/types.ts:128:1
```

### problem: ProblemBody

[Declaration source](problem/mod.ts#L436)

```text
reference ProblemBody: ./packages/http/problem/types.ts:115:1
```

### problem: ProblemDefinition

[Declaration source](problem/mod.ts#L437)

```text
reference ProblemDefinition: ./packages/http/problem/types.ts:45:1
```

### problem: ProblemDefinitionInput

[Declaration source](problem/mod.ts#L438)

```text
reference ProblemDefinitionInput: ./packages/http/problem/types.ts:80:1
```

### problem: ProblemDocument

[Declaration source](problem/mod.ts#L439)

```text
reference ProblemDocument: ./packages/http/problem/types.ts:159:1
```

### problem: ProblemExample

[Declaration source](problem/mod.ts#L440)

```text
reference ProblemExample: ./packages/http/problem/types.ts:27:1
```

### problem: ProblemExtensionContract

[Declaration source](problem/mod.ts#L441)

```text
reference ProblemExtensionContract: ./packages/http/problem/types.ts:37:1
```

### problem: ProblemHeaders

[Declaration source](problem/mod.ts#L442)

```text
reference ProblemHeaders: ./packages/http/problem/types.ts:125:1
```

### problem: ProblemProviderMetadata

[Declaration source](problem/mod.ts#L443)

```text
reference ProblemProviderMetadata: ./packages/http/problem/types.ts:17:1
```

### problem: ProblemResult

[Declaration source](problem/mod.ts#L444)

```text
reference ProblemResult: ./packages/http/problem/types.ts:152:1
```

### problem: ProblemResultMetadata

[Declaration source](problem/mod.ts#L445)

```text
reference ProblemResultMetadata: ./packages/http/problem/types.ts:144:1
```

### problem: ProblemRetryPolicy

[Declaration source](problem/mod.ts#L446)

```text
reference ProblemRetryPolicy: ./packages/http/problem/types.ts:11:1
```

### problem: ProblemSeverity

[Declaration source](problem/mod.ts#L447)

```text
reference ProblemSeverity: ./packages/http/problem/types.ts:8:1
```

### problem: ProblemStatus

[Declaration source](problem/mod.ts#L448)

```text
reference ProblemStatus: ./packages/http/problem/types.ts:5:1
```

## problem-testing

Import `@okikio/http/problem/testing`. [Source](./problem/testing/mod.ts).

### problem-testing: coverage

[Declaration source](problem/testing/coverage.ts#L40)

```text
function coverage<Entry extends ProblemDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>>(universe: Catalog<Entry, Entries> | CatalogSelection<Entry, Entries>, registrations: readonly [Key in keyof Entries]: () => void): ProblemCoverageReport
  Verify and register exhaustive behavioral coverage for one problem universe.

  Registration functions are invoked in source-catalog order only after the
  runtime key set is exact. This prevents a malformed JavaScript caller from
  registering a partial suite before the defect is reported.
```

### problem-testing: ProblemCoverageError

[Declaration source](problem/testing/coverage.ts#L17)

```text
class ProblemCoverageError extends Error
  Error raised before registration when behavioral coverage is not exhaustive.

  constructor(report: ProblemCoverageReport)
    Retain the coverage report that names missing and unexpected problem cases.
  readonly report: ProblemCoverageReport
    Structured coverage result retained so callers can inspect missing and extra definitions.
```

### problem-testing: ProblemCoverageReport

[Declaration source](problem/testing/coverage.ts#L5)

```text
interface ProblemCoverageReport
  Coverage summary for one problem catalog or selection.

  readonly declared: number
    Number of declared problem definitions in the selected coverage universe.
  readonly covered: number
    Number of declared problem definitions with registered coverage cases.
  readonly missing: readonly string[]
    Authored problem keys without a registered coverage callback.
  readonly extra: readonly string[]
    Registered keys that do not belong to the declared problem universe.
```

## problem-types

Import `@okikio/http/problem/types`. [Source](./problem/types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding       | Contract owner or source                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| `StandardSchemaV1`     | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `CatalogEntryIdentity` | [catalog contracts](../catalog/API.md)                                     |
| `HeaderInput`          | [Source](response/headers.ts)                                              |
| `ResponseHeaders`      | [Source](response/headers.ts)                                              |

### problem-types: CreateProblemOptions

[Declaration source](problem/types.ts#L128)

```text
interface CreateProblemOptions<Extensions extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>>
  Options supplied while creating one problem occurrence.

  readonly detail?: string
    Occurrence-specific explanation serialized in the problem body.
  readonly instance?: string
    URI identifying this particular problem occurrence.
  readonly extensions?: Extensions
    Occurrence members validated by the declared extension contract.
  readonly headers?: HeaderInput
    Explicit transport headers retained for this boundary; credential forwarding uses its separate policy.
  readonly cause?: unknown
    Original diagnostic cause retained outside the public problem body.
```

### problem-types: ProblemDefinition

[Declaration source](problem/types.ts#L45)

```text
interface ProblemDefinition<Extensions extends ProblemExtensionContract | undefined = ProblemExtensionContract | undefined, Status extends ProblemStatus = ProblemStatus> extends CatalogEntryIdentity
  Static immutable RFC 9457 problem definition.

  readonly kind: "problem"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly type: string
    RFC 9457 problem type URI retained by the definition.
  readonly status: Status
    HTTP status selected by this response or reported by this lifecycle observation.
  readonly title: string
    Stable short title for this problem type.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly remediation?: string
    Caller-facing action that may resolve this problem, when one is known.
  readonly externalDocumentation?: string
    External reference for this problem type.
  readonly localizationKey?: string
    Application-owned localization identity for this problem type.
  readonly examples?: readonly ProblemExample[]
    Concrete authored examples retained for API documentation.
  readonly retry?: ProblemRetryPolicy
    Declared retry guidance; the caller or runtime still owns actual retry scheduling.
  readonly severity?: ProblemSeverity
    Diagnostic severity assigned to this problem type.
  readonly extensions?: Extensions
    Definition-specific problem extension contract or validated occurrence members.
  readonly exposure: "public" | "internal"
    Whether this problem type is public or intended for internal use.
  readonly provider?: ProblemProviderMetadata
    Optional provider metadata retained with this problem type.
```

### problem-types: ProblemDefinitionInput

[Declaration source](problem/types.ts#L80)

```text
interface ProblemDefinitionInput<Extensions extends ProblemExtensionContract | undefined, Status extends ProblemStatus>
  Input accepted by {@link define}.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly type: string
    RFC 9457 problem type URI retained by the definition.
  readonly status: Status
    HTTP status selected by this response or reported by this lifecycle observation.
  readonly title: string
    Stable short title for this problem type.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly remediation?: string
    Caller-facing action that may resolve this problem, when one is known.
  readonly externalDocumentation?: string
    External reference for this problem type.
  readonly localizationKey?: string
    Application-owned localization identity for this problem type.
  readonly examples?: readonly ProblemExample[]
    Concrete authored examples retained for API documentation.
  readonly retry?: ProblemRetryPolicy
    Declared retry guidance; the caller or runtime still owns actual retry scheduling.
  readonly severity?: ProblemSeverity
    Diagnostic severity assigned to this problem type.
  readonly extensions?: Extensions
    Definition-specific problem extension contract or validated occurrence members.
  readonly exposure?: "public" | "internal"
    Whether this problem type is public or intended for internal use.
  readonly provider?: ProblemProviderMetadata
    Optional provider metadata retained with this problem type.
```

### problem-types: ProblemDocument

[Declaration source](problem/types.ts#L159)

```text
interface ProblemDocument
  JSON-safe problem documentation projection.

  readonly key?: string
    Authored name of this entry or example in its containing catalog.
  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly type: string
    RFC 9457 problem type URI retained by the definition.
  readonly status: ProblemStatus
    HTTP status selected by this response or reported by this lifecycle observation.
  readonly title: string
    Stable short title for this problem type.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly remediation?: string
    Caller-facing action that may resolve this problem, when one is known.
  readonly externalDocumentation?: string
    External reference for this problem type.
  readonly retry: ProblemRetryPolicy
    Declared retry guidance; the caller or runtime still owns actual retry scheduling.
  readonly severity: ProblemSeverity
    Diagnostic severity assigned to this problem type.
  readonly exposure: "public" | "internal"
    Whether this problem type is public or intended for internal use.
  readonly examples: readonly ProblemExample[]
    Concrete authored examples retained for API documentation.
  readonly provider?: ProblemProviderMetadata
    Optional provider metadata retained with this problem type.
```

### problem-types: ProblemExample

[Declaration source](problem/types.ts#L27)

```text
interface ProblemExample
  Concrete problem example retained for generated references.

  readonly key: string
    Authored name of this entry or example in its containing catalog.
  readonly summary?: string
    Short explanation shown beside this operation or example in generated references.
  readonly value: Readonly<Record<string, unknown>>
    Concrete example payload retained for generated documentation.
```

### problem-types: ProblemExtensionContract

[Declaration source](problem/types.ts#L37)

```text
interface ProblemExtensionContract<Schema extends StandardSchemaV1 = StandardSchemaV1>
  Contract for extension members appended to the RFC 9457 body.

  readonly schema: Schema
    Standard Schema that validates definition-specific problem extension members.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
```

### problem-types: ProblemProviderMetadata

[Declaration source](problem/types.ts#L17)

```text
interface ProblemProviderMetadata
  Provider metadata retained for internal problem catalogs.

  readonly name: string
    External provider identity retained as problem metadata.
  readonly code?: string
    Stable failure code; callers should branch on this instead of matching explanation text.
  readonly documentation?: string
    Reference URL supplied for the external provider.
```

### problem-types: ProblemResultMetadata

[Declaration source](problem/types.ts#L144)

```text
interface ProblemResultMetadata<Definition extends ProblemDefinition = ProblemDefinition>
  Hidden metadata retained by a problem tuple.

  readonly definition: Definition
    Exact problem definition retained with this logical tuple.
  readonly cause?: unknown
    Original diagnostic cause retained outside the public problem body.
```

### problem-types: ProblemBody

[Declaration source](problem/types.ts#L115)

```text
type ProblemBody<Definition extends ProblemDefinition = ProblemDefinition> = Readonly<{ type: Definition["type"]; title: Definition["title"]; status: Definition["status"]; detail?: string; instance?: string; [key: string]: unknown; }>
  Canonical RFC 9457 members plus definition-specific extensions.
```

### problem-types: ProblemHeaders

[Declaration source](problem/types.ts#L125)

```text
type ProblemHeaders = ResponseHeaders
  Immutable headers attached to a problem result.
```

### problem-types: ProblemResult

[Declaration source](problem/types.ts#L152)

```text
type ProblemResult<Definition extends ProblemDefinition = ProblemDefinition, Body extends ProblemBody<Definition> = ProblemBody<Definition>, Headers extends ProblemHeaders = ProblemHeaders> = readonly [Body, Definition["status"], Headers]
  Logical RFC 9457 response tuple returned before server materialization.
```

### problem-types: ProblemRetryPolicy

[Declaration source](problem/types.ts#L11)

```text
type ProblemRetryPolicy = { readonly kind: "never"; } | { readonly kind: "immediate"; readonly maximumAttempts?: number; } | { readonly kind: "after"; readonly header?: string; readonly defaultSeconds?: number; }
  Retry guidance attached to a problem definition.
```

### problem-types: ProblemSeverity

[Declaration source](problem/types.ts#L8)

```text
type ProblemSeverity = "info" | "warning" | "error" | "critical"
  Public severity classification used by documentation and diagnostics.
```

### problem-types: ProblemStatus

[Declaration source](problem/types.ts#L5)

```text
type ProblemStatus = number
  Supported RFC 9457 HTTP error status.
```

## request

Import `@okikio/http/request`. [Source](./request/mod.ts).

Read bounded request bytes and preserve query multiplicity before domain validation.

Choose the body budget before reading, then validate the decoded shape with an endpoint schema. Cancellation and
one-byte-over-limit cases fail without returning a partial body.

### request: correlation

[Declaration source](request/trace.ts#L51)

```text
function correlation(request: Request, options: RequestCorrelationOptions): Promise<RequestCorrelation>
  Establish one request-owned correlation value.

  A valid incoming W3C trace is continued with a newly generated span. Invalid
  parent material is never propagated. The pending result is memoized by the
  Request object so authentication, logging, and downstream clients share the
  same IDs.
```

### request: correlationFields

[Declaration source](request/trace.ts#L75)

```text
function correlationFields(value: RequestCorrelation, options: RequestCorrelationFieldOptions): Readonly<Record<string, string>>
  Project correlation into redaction-safe structured logging fields.

  The returned record contains identifiers only; it never includes headers,
  cookies, authorization credentials, query values, or request bodies.
```

### request: disposeMemo

[Declaration source](request/memo.ts#L41)

```text
async function disposeMemo(request: object): Promise<void>
  Dispose memoized values exposing native disposal protocols, then clear the request cache.
```

### request: externalUrl

[Declaration source](request/forwarded.ts#L5)

```text
function externalUrl(request: Request, policy: ForwardedHeaderPolicy): URL
  Resolve the externally visible URL only when forwarding fields are explicitly trusted.
```

### request: formatPath

[Declaration source](request/issues.ts#L73)

```text
function formatPath(path: readonly PropertyKey[]): string
  Format a normalized path without rendering any request value.
```

### request: forwardHeaders

[Declaration source](request/forward.ts#L40)

```text
function forwardHeaders(request: Pick<Request, "headers" | "url">, options: ForwardHeaderOptionsType): Headers
  Build trusted forwarding headers from one untrusted request.

  Caller-authored forwarding, correlation, hop-by-hop, and selected host-owned
  fields are removed before the public host and protocol are reconstructed.
```

### request: invalidateMemo

[Declaration source](request/memo.ts#L35)

```text
function invalidateMemo(request: object, key?: unknown): void
  Invalidate one memoized request capability or the complete request cache.
```

### request: limits

[Declaration source](request/limits.ts#L41)

```text
function limits(options: RequestParsingOptions): RequestParsingLimits
  Resolve request limits into an immutable snapshot that can be reused by several readers.

  Pass the returned policy to body, header or query readers to avoid repeating
  preparation. Later mutation of the authored options cannot alter that policy.
  Caller-owned records, including frozen records, still receive full validation.
```

### request: memoize

[Declaration source](request/memo.ts#L5)

```text
async function memoize<Value>(request: object, key: unknown, load: () => Value | Promise<Value>, options: { readonly cacheRejected?: boolean; }): Promise<Value>
  Compute one request-owned capability once, sharing a pending promise across consumers.
```

### request: negotiateContent

[Declaration source](request/content.ts#L49)

```text
function negotiateContent(accept: string | null, supported: readonly string[]): string
  Select the best supported representation using the Deno standard HTTP negotiator.
```

### request: normalizePath

[Declaration source](request/issues.ts#L62)

```text
function normalizePath(path: StandardSchemaV1.Issue["path"] | RequestIssue["path"]): readonly PropertyKey[]
  Convert a Standard Schema path into ordinary property keys.
```

### request: parseAuthorization

[Declaration source](request/authorization.ts#L46)

```text
function parseAuthorization(value: string | null, options: { readonly allowedSchemes?: readonly string[]; }): ParsedAuthorization | undefined
  Parse Authorization syntax without verifying the credential or establishing identity.
```

### request: parseContentLength

[Declaration source](request/length.ts#L9)

```text
function parseContentLength(value: string | null): number | undefined
  Parses one Content-Length field using the HTTP decimal-integer grammar.

  `undefined` means the field is absent. Malformed, negative, fractional,
  exponential, or unsafe integer values are rejected instead of being treated
  as an unknown length.
```

### request: parseCookies

[Declaration source](request/cookies.ts#L7)

```text
function parseCookies(header: string | null, options: RequestParsingOptions & { readonly duplicates?: DuplicateCookiePolicy; readonly percentDecode?: boolean; }): WireRecord
  Parse a Cookie field with explicit duplicate and decoding policy. Provider cookies remain opaque strings.
```

### request: parseForm

[Declaration source](request/body.ts#L122)

```text
async function parseForm(request: Request, options: RequestParsingOptions): Promise<FormWireRecord>
  Parse a bounded URL-encoded or multipart form while preserving repeated string values.
```

### request: parseHeaders

[Declaration source](request/headers.ts#L7)

```text
function parseHeaders(input: Headers, options: RequestParsingOptions): WireRecord
  Parse request fields into a lower-case, bounded record while preserving repetitions where observable.
```

### request: parseJson

[Declaration source](request/body.ts#L94)

```text
async function parseJson(request: Request, options: RequestParsingOptions): Promise<unknown>
  Parse bounded JSON after enforcing application/json or a +json media type.
```

### request: parseMediaType

[Declaration source](request/content.ts#L5)

```text
function parseMediaType(value: string): MediaType
  Parse a Content-Type or Accept media-range token.
```

### request: parseParameters

[Declaration source](request/parameters.ts#L5)

```text
function parseParameters(routePath: string, pathname: string, options: RequestParsingOptions): Readonly<Record<string, string>>
  Parse canonical `:name` route parameters from a matched path.
```

### request: parseQuery

[Declaration source](request/query.ts#L21)

```text
function parseQuery(input: QueryInput, options: RequestParsingOptions): WireRecord
  Preserve repeated query values without applying endpoint-specific schema semantics.

  A raw query string keeps one useful distinction that `URLSearchParams` loses:
  `?flag` means the flag is present, while `?flag=` is an explicitly empty value.
  Bare parameters use the configured `bareQueryParameters` policy. The default
  `empty` policy emits an empty string; `flag` emits the string `"true"`; and
  `reject` rejects bare syntax. Explicit values remain unchanged and repeated
  occurrences preserve wire order.

  Pass the raw `URL.search` string when that distinction matters. Supplying an
  already-created `URLSearchParams` keeps its native semantics, where `?flag`
  and `?flag=` are both represented as an empty string.
```

### request: parseTraceParent

[Declaration source](request/trace.ts#L120)

```text
function parseTraceParent(value: string | null): Readonly<{ readonly traceId: string; readonly parentSpanId: string; readonly flags: string; }> | undefined
  Parse an incoming W3C traceparent without accepting zero IDs or future-version ambiguity.
```

### request: parseTraceState

[Declaration source](request/trace.ts#L139)

```text
function parseTraceState(value: string | null, maximumLength: number): string | undefined
  Validate and normalize W3C tracestate. Invalid state is dropped, never forwarded.
```

### request: propagationHeaders

[Declaration source](request/trace.ts#L104)

```text
function propagationHeaders(value: RequestCorrelation): Headers
  Build fields safe to propagate to one downstream HTTP request.
```

### request: readBody

[Declaration source](request/body.ts#L14)

```text
async function readBody(request: Request, options: RequestParsingOptions): Promise<Uint8Array>
  Read request bytes once with a hard upper bound and Content-Length precheck.

  Cancellation settles before the reader lock is released. A body-limit issue
  remains the primary transport failure if cancellation rejects, with private
  cleanup diagnostics retained in its cause. Other primary and cleanup failures
  produce an AggregateError whose cause is the original read or abort failure.
```

### request: redactHeaders

[Declaration source](request/headers.ts#L55)

```text
function redactHeaders(input: Headers | WireRecord, extraSensitive: readonly string[]): WireRecord
  Create a log-safe projection that never exposes credentials or cookie values.
```

### request: requestId

[Declaration source](request/trace.ts#L114)

```text
function requestId(value: string | null | undefined): string
  Return a bounded caller-provided request ID or generate a new UUID.
```

### request: requireContentType

[Declaration source](request/content.ts#L28)

```text
function requireContentType(request: Request, supported: readonly string[]): MediaType
  Require one of the supported request content types.
```

### request: validationDetail

[Declaration source](request/issues.ts#L45)

```text
function validationDetail(source: RequestInputSource, issue: RequestIssue | StandardSchemaV1.Issue): RequestValidationDetail
  Normalize one transport or Standard Schema issue.
```

### request: validationDetails

[Declaration source](request/issues.ts#L37)

```text
function validationDetails(source: RequestInputSource, issues: readonly (RequestIssue | StandardSchemaV1.Issue)[]): readonly RequestValidationDetail[]
  Normalize transport and Standard Schema issues without copying rejected
  request values into diagnostics.
```

### request: DefaultRequestParsingLimits

[Declaration source](request/limits.ts#L4)

```text
const DefaultRequestParsingLimits
  These defaults allow common web requests and keep parsing work within a clear bound.
```

### request: ForwardHeaderOptionsType

[Declaration source](request/forward.ts#L4)

```text
interface ForwardHeaderOptionsType
  Credential forwarding policy for one outbound HTTP request.

  readonly requestCookies?: "preserve" | "strip"
    Explicit policy for retaining or stripping inbound Cookie headers.
  readonly requestAuthorization?: "preserve" | "strip"
    Explicit policy for retaining or stripping inbound Authorization, including after authentication.
  readonly clientIp?: string
    Host-trusted connected client address used when reconstructing forwarding metadata.
  readonly remove?: readonly string[]
    Exact header names removed before forwarding.
  readonly removePrefixes?: readonly string[]
    Header-name prefixes removed before forwarding.
```

### request: RequestCorrelation

[Declaration source](request/trace.ts#L12)

```text
interface RequestCorrelation
  W3C trace and request-correlation values derived from trusted request input.

  readonly requestId: string
    Request correlation identity; it is diagnostic data rather than authorization.
  readonly traceId: string
    Trace correlation identity retained for diagnostic propagation.
  readonly spanId: string
    Span correlation identity for the current operation.
  readonly parentSpanId?: string
    Valid incoming parent span identity, when a trace was continued.
  readonly traceFlags: string
    Trace flags retained in the representation required by this adapter.
  readonly traceState?: string
    Optional validated vendor trace state carried for correlation.
  readonly traceparent: string
    Serialized W3C traceparent for the newly owned request span.
  readonly source: "continued" | "new" | "replaced-invalid-parent"
    Whether a valid trace was continued, a fresh trace was created, or invalid parent data was replaced.
```

### request: RequestCorrelationFieldOptions

[Declaration source](request/trace.ts#L60)

```text
interface RequestCorrelationFieldOptions
  Optional stable dimensions added to structured correlation fields.

  readonly service?: string
    Optional stable service identity added to correlation fields.
  readonly operationId?: string
    Stable operation identity used by generated clients, routing and diagnostics.
  readonly routeId?: string
    Identity of the selected compiled route, when routing has completed.
```

### request: RequestCorrelationOptions

[Declaration source](request/trace.ts#L32)

```text
interface RequestCorrelationOptions
  Options used when establishing request correlation.

  readonly requestId?: string | ((request: Request) => string | undefined)
    Explicit request identity or provider; ingress reuse is controlled separately by trustRequestId.
  readonly trustRequestId?: boolean
    Accept X-Request-ID from this request as trusted ingress metadata. Defaults to false.
  readonly sampled?: boolean
    Sampling bit selected for a newly established trace.
  readonly maximumTraceStateLength?: number
    Maximum incoming tracestate character budget.
```

### request: RequestValidationDetail

[Declaration source](request/issues.ts#L18)

```text
interface RequestValidationDetail
  Stable, value-free validation detail suitable for RFC problem extensions,
  diagnostics, tests, and structured logging.

  readonly source: RequestInputSource
    Request input location whose validation failed.
  readonly code: RequestIssueCode | "invalid-value" | string
    Stable failure code; callers should branch on this instead of matching explanation text.
  readonly message: string
    Human-readable diagnostic explanation; it is not a stable program discriminator.
  readonly path: readonly PropertyKey[]
    Property-key path to the rejected value; rejected values themselves are not copied.
  readonly location: string
    Human-readable input location supplied for this issue.
  readonly field?: string
    Input field associated with this validation observation.
```

### request: RequestInputSource

[Declaration source](request/issues.ts#L5)

```text
type RequestInputSource = "param" | "query" | "header" | "cookie" | "json" | "form" | "raw"
  Request location whose wire or schema validation produced an issue.
```

### request: DuplicateCookiePolicy

[Declaration source](request/mod.ts#L39)

```text
reference DuplicateCookiePolicy: ./packages/http/request/types.ts:114:1
```

### request: ForwardedHeaderPolicy

[Declaration source](request/mod.ts#L40)

```text
reference ForwardedHeaderPolicy: ./packages/http/request/types.ts:117:1
```

### request: MediaType

[Declaration source](request/mod.ts#L41)

```text
reference MediaType: ./packages/http/request/types.ts:131:1
```

### request: ParsedAuthorization

[Declaration source](request/mod.ts#L42)

```text
reference ParsedAuthorization: ./packages/http/request/types.ts:104:1
```

### request: RequestIssue

[Declaration source](request/mod.ts#L43)

```text
reference RequestIssue: ./packages/http/request/types.ts:25:1
```

### request: RequestIssueCode

[Declaration source](request/mod.ts#L44)

```text
reference RequestIssueCode: ./packages/http/request/types.ts:1:1
```

### request: RequestParsingLimits

[Declaration source](request/mod.ts#L45)

```text
reference RequestParsingLimits: ./packages/http/request/types.ts:48:1
```

### request: RequestParsingOptions

[Declaration source](request/mod.ts#L46)

```text
reference RequestParsingOptions: ./packages/http/request/types.ts:75:1
```

### request: RequestTransportError

[Declaration source](request/mod.ts#L37)

```text
reference RequestTransportError: ./packages/http/request/types.ts:35:1
```

### request: SensitiveCredential

[Declaration source](request/mod.ts#L47)

```text
reference SensitiveCredential: ./packages/http/request/types.ts:94:1
```

### request: WireRecord

[Declaration source](request/mod.ts#L48)

```text
reference WireRecord: ./packages/http/request/types.ts:86:1
```

### request: WireValue

[Declaration source](request/mod.ts#L49)

```text
reference WireValue: ./packages/http/request/types.ts:83:1
```

## request-types

Import `@okikio/http/request/types`. [Source](./request/types.ts).

### request-types: RequestTransportError

[Declaration source](request/types.ts#L35)

```text
class RequestTransportError extends Error
  Error containing one or more transport issues safe for validation reporting.

  constructor(issues: RequestIssue | readonly RequestIssue[], options?: ErrorOptions)
    Retain safe wire issues; an optional cause holds private diagnostics outside validation reporting.
  readonly issues: readonly RequestIssue[]
    Structured validation issues retained for inspection without matching error messages.
```

### request-types: ForwardedHeaderPolicy

[Declaration source](request/types.ts#L117)

```text
interface ForwardedHeaderPolicy
  Trusted external-origin resolution policy.

  readonly trust: boolean
    Whether this ingress deliberately trusts forwarded origin fields.
  readonly allowForwarded?: boolean
    Whether trusted RFC Forwarded fields may supply external-origin evidence.
  readonly allowXForwarded?: boolean
    Whether trusted X-Forwarded fields may supply external-origin evidence.
  readonly allowedHosts?: readonly string[]
    Explicit external host allowlist for trusted origin reconstruction.
  readonly allowedProtocols?: readonly ("http:" | "https:")[]
    Explicit HTTP/HTTPS protocol allowlist for trusted origin reconstruction.
```

### request-types: MediaType

[Declaration source](request/types.ts#L131)

```text
interface MediaType
  Parsed media type.

  readonly type: string
    Top-level component of the parsed media type, such as application.
  readonly subtype: string
    Subtype component of the parsed media type.
  readonly parameters: Readonly<Record<string, string>>
    Named media-type parameters retained after syntax parsing.
  readonly essence: string
    Media type and subtype without parameters, suitable for content-type matching.
```

### request-types: ParsedAuthorization

[Declaration source](request/types.ts#L104)

```text
interface ParsedAuthorization
  Syntax-level Authorization field, not a verified identity.

  readonly scheme: string
    Authored authorization scheme spelling retained from the header.
  readonly normalizedScheme: string
    Case-normalized authorization scheme used for explicit matching.
  readonly credential: SensitiveCredential
    Parsed secret held behind an explicit reveal operation; it is not a verified identity.
```

### request-types: RequestIssue

[Declaration source](request/types.ts#L25)

```text
interface RequestIssue
  Structured wire parsing failure.

  readonly code: RequestIssueCode
    Stable failure code; callers should branch on this instead of matching explanation text.
  readonly message: string
    Human-readable diagnostic explanation; it is not a stable program discriminator.
  readonly path?: readonly PropertyKey[]
    Property-key path to the rejected request value, when available.
```

### request-types: RequestParsingLimits

[Declaration source](request/types.ts#L48)

```text
interface RequestParsingLimits
  Bounded defaults for generic Web request parsing.

  readonly maximumHeaders: number
    Maximum request header fields admitted by wire parsing.
  readonly maximumHeaderBytes: number
    Maximum aggregate request-header byte budget.
  readonly maximumHeaderValueBytes: number
    Maximum encoded bytes admitted for one header value.
  readonly maximumQueryParameters: number
    Maximum query parameter occurrences admitted by parsing.
  readonly maximumQueryValueLength: number
    Maximum text length admitted for a query name or value.
  readonly maximumParameterLength: number
    Maximum text length admitted for one path parameter.
  readonly maximumCookieBytes: number
    Maximum encoded Cookie header byte budget.
  readonly maximumCookies: number
    Maximum cookie occurrences admitted by parsing.
  readonly maximumBodyBytes: number
    Maximum consumed request-body bytes, including the bounded read after a declared length.
  readonly maximumFormFields: number
    Maximum form field occurrences admitted by parsing.
```

### request-types: SensitiveCredential

[Declaration source](request/types.ts#L94)

```text
interface SensitiveCredential
  Parsed authorization credential. The secret is revealed only by an explicit call.

  reveal(): string
    Reveal the parsed credential explicitly; parsing alone does not authenticate it.
  toString(): "[REDACTED]"
    Return [REDACTED] so ordinary string conversion does not reveal the credential.
  toJSON(): "[REDACTED]"
    Return the redacted credential marker during JSON serialization.
```

### request-types: BareQueryParameterPolicy

[Declaration source](request/types.ts#L72)

```text
type BareQueryParameterPolicy = "flag" | "empty" | "reject"
  Policy applied when a raw query parameter is present without an equals sign.
```

### request-types: DuplicateCookiePolicy

[Declaration source](request/types.ts#L114)

```text
type DuplicateCookiePolicy = "reject" | "first" | "last" | "array"
  Cookie duplicate handling policy.
```

### request-types: FormWireRecord

[Declaration source](request/types.ts#L92)

```text
type FormWireRecord = Readonly<Record<string, FormWireValue>>
  Bounded form record preserving repeated text values and uploaded files.
```

### request-types: FormWireValue

[Declaration source](request/types.ts#L89)

```text
type FormWireValue = string | File | readonly (string | File)[]
  One parsed form field value. Files remain explicit rather than being coerced to strings.
```

### request-types: RequestIssueCode

[Declaration source](request/types.ts#L1)

```text
type RequestIssueCode = "too-many-headers" | "headers-too-large" | "header-too-large" | "invalid-header" | "too-many-query-parameters" | "query-name-too-large" | "query-value-too-large" | "invalid-parameter" | "cookies-too-large" | "too-many-cookies" | "invalid-cookie" | "duplicate-cookie" | "invalid-authorization" | "unsupported-authorization" | "invalid-content-length" | "body-too-large" | "unsupported-content-type" | "invalid-json" | "invalid-form" | "not-acceptable" | "untrusted-forwarded-header"
  Stable issue codes emitted by request wire parsing and sanitation.
```

### request-types: RequestParsingOptions

[Declaration source](request/types.ts#L75)

```text
type RequestParsingOptions = Partial<RequestParsingLimits> & Readonly<{ readonly bareQueryParameters?: BareQueryParameterPolicy; }>
  Parsing policy and bounded limit overrides accepted by generic request readers.
```

### request-types: WireRecord

[Declaration source](request/types.ts#L86)

```text
type WireRecord = Readonly<Record<string, WireValue>>
  Normalized wire record used for bounded query, header, and parameter values.
```

### request-types: WireValue

[Declaration source](request/types.ts#L83)

```text
type WireValue = string | readonly string[]
  One normalized wire value, preserving repeated occurrences when present.
```

## response

Import `@okikio/http/response`. [Source](./response/mod.ts).

Keep a successful representation tied to one schema and attach a safe download name.

Add pagination, repeated headers, conditional responses or byte ranges as the representation needs them. The server
validates an occurrence against its endpoint declarations and materializes the native Response; a filename header does
not authorize access to a file.

### response: accepted

[Declaration source](response/definition.ts#L81)

```text
function accepted<Schema extends ResponseSchema>(schema: Schema, options: Omit<ResponseDefinitionInput<Schema, 202>, "id" | "status" | "schema"> & { readonly id?: string; }): ResponseDefinition<Schema, 202>
  Define a `202 Accepted` response.
```

### response: attachmentDisposition

[Declaration source](response/filename.ts#L16)

````text
function attachmentDisposition(value: string): string
  Describe a download filename for Content-Disposition without trusting a source path.

  Only the last path component survives. Control characters are removed and
  empty or dot-only names become `download`. Quoting protects ASCII names;
  non-ASCII names add a UTF-8 extended value beside a safe ASCII fallback.
  This formats an HTTP field, not a filesystem path or a file authorization rule.

  @example
      ```ts
      const headers = new Headers({
        'content-disposition': attachmentDisposition('reports/quarterly.csv'),
      });
      // attachment; filename="quarterly.csv"
      ```
````

### response: catalog

[Declaration source](response/definition.ts#L207)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, ResponseDefinition>>>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries>
  Create a named immutable response catalog.
```

### response: compose

[Declaration source](response/definition.ts#L229)

```text
function compose<Entry extends ResponseDefinition>(...inputs: readonly DefinitionInput<Entry>[]): readonly Entry[]
  Compose response definitions, catalogs, selections, and nested arrays.
```

### response: create

[Declaration source](response/result.ts#L44)

```text
function create<Definition extends ResponseDefinition>(definition: Definition, body: ResponseBody<Definition>, options: CreateResponseOptions): ResponseResult<Definition, CreatedResponseBody<Definition>>
  Instantiate a definition-associated logical result. Request-dependent work happens in {@link finalize}.
```

### response: created

[Declaration source](response/definition.ts#L73)

```text
function created<Schema extends ResponseSchema>(schema: Schema, options: Omit<ResponseDefinitionInput<Schema, 201>, "id" | "status" | "schema"> & { readonly id?: string; }): ResponseDefinition<Schema, 201>
  Define a `201 Created` response.
```

### response: define

[Declaration source](response/definition.ts#L37)

```text
function define<Schema extends ResponseSchema | undefined, Status extends ResponseStatus>(input: ResponseDefinitionInput<Schema, Status>): ResponseDefinition<Schema, Status>
  Define one immutable successful HTTP response contract.
```

### response: definitionOf

[Declaration source](response/result.ts#L174)

```text
function definitionOf<Definition extends ResponseDefinition>(value: ResponseResult<Definition>): Definition
  Return the exact imported definition retained by a response tuple.
```

### response: discard

[Declaration source](response/discard.ts#L9)

```text
async function discard(value: Response, reason?: unknown): Promise<void>
  Release an HTTP response body that the caller intentionally will not read.

  Cancellation is best-effort cleanup. A failure while discarding an unused
  body must not replace the response status, validation error, or other result
  that caused the caller to abandon the body. If a reader already owns the
  stream, that reader remains responsible for cancellation and this operation
  does nothing.
```

### response: document

[Declaration source](response/definition.ts#L236)

```text
function document(input: DefinitionInput<ResponseDefinition>): readonly ResponseDocument[]
  Create JSON-safe response documentation.
```

### response: download

[Declaration source](response/definition.ts#L173)

```text
function download<Schema extends ResponseSchema>(schema: Schema, options: Omit<ResponseDefinitionInput<Schema, 200>, "id" | "status" | "schema" | "mode"> & { readonly id?: string; }): ResponseDefinition<Schema, 200>
  Define a downloadable response.
```

### response: finalize

[Declaration source](response/result.ts#L93)

```text
function finalize<Definition extends ResponseDefinition>(result: ResponseResult<Definition>, options: FinalizeResponseOptions): FinalizedResponseResult<Definition>
  Finalize one logical result with request-aware transport metadata.

  Handlers call {@link create} before a public request URL, current time, or
  adapter-specific pagination parameter names necessarily exist. The server
  adapter calls `finalize` exactly once after handler/result validation to:

  - generate pagination links from the current or explicitly supplied URL;
  - preserve non-pagination query parameters and fragments;
  - emit configured Link/count headers and body metadata;
  - create optional data envelopes and timestamps.

  This function still returns a transport-neutral finalized value. The selected
  server adapter owns the subsequent conversion to a native `Response`,
  including prepared middleware headers and repeated Set-Cookie fields.
```

### response: html

[Declaration source](response/definition.ts#L187)

```text
function html(options: Omit<ResponseDefinitionInput<typeof htmlBodySchema, 200>, "id" | "status" | "schema" | "mode" | "contentType"> & { readonly id?: string; readonly contentType?: string; }): ResponseDefinition<typeof htmlBodySchema, 200> & { readonly mode: "html"; }
  Define a small one-off HTML page without changing the Solid application renderer.
```

### response: is

[Declaration source](response/result.ts#L169)

```text
function is(value: unknown): value is ResponseResult
  Return whether a value is a response tuple created by this package.
```

### response: noContent

[Declaration source](response/definition.ts#L89)

```text
function noContent(options: Omit<ResponseDefinitionInput<undefined, 204>, "id" | "status" | "schema" | "mode" | "description"> & { readonly id?: string; readonly description?: string; }): ResponseDefinition<undefined, 204> & { readonly mode: "empty"; }
  Define a bodyless `204 No Content` response.
```

### response: notModified

[Declaration source](response/definition.ts#L106)

```text
function notModified(options: Omit<ResponseDefinitionInput<undefined, 304>, "id" | "status" | "schema" | "mode" | "description"> & { readonly id?: string; readonly description?: string; }): ResponseDefinition<undefined, 304> & { readonly mode: "empty"; }
  Define a bodyless `304 Not Modified` response for explicit conditional contracts.
```

### response: ok

[Declaration source](response/definition.ts#L65)

```text
function ok<Schema extends ResponseSchema>(schema: Schema, options: Omit<ResponseDefinitionInput<Schema, 200>, "id" | "status" | "schema"> & { readonly id?: string; }): ResponseDefinition<Schema, 200>
  Define a `200 OK` response.
```

### response: pageHeaders

[Declaration source](response/result.ts#L211)

```text
function pageHeaders<Item>(page: PageWindow<Item>, url?: string | URL, parameters: Partial<PaginationParameters>): ResponseHeaders
  Construct RFC 8288 Link and count/page fields from a page window.
```

### response: pageLinks

[Declaration source](response/result.ts#L179)

```text
function pageLinks<Page extends PageWindow<unknown>>(page: Page, baseUrl: string | URL, parameters: Partial<PaginationParameters>, custom?: (context: PaginationLinkContext<NormalizedPageWindow<Page>>) => string | URL | undefined): PaginationLinks
  Construct request-aware pagination links without instantiating a response.
```

### response: paginated

[Declaration source](response/definition.ts#L159)

```text
function paginated<Schema extends ResponseSchema>(schema: Schema, options: Omit<ResponseDefinitionInput<Schema, 200>, "id" | "status" | "schema" | "mode"> & { readonly id?: string; }): ResponseDefinition<Schema, 200> & { readonly mode: "page"; }
  Define a paginated collection response.
```

### response: partialContent

[Declaration source](response/definition.ts#L123)

```text
function partialContent<Schema extends ResponseSchema>(schema: Schema, options: Omit<ResponseDefinitionInput<Schema, 206>, "id" | "status" | "schema"> & { readonly id?: string; }): ResponseDefinition<Schema, 206> & { readonly mode: "body"; }
  Define a `206 Partial Content` response whose body is produced by an artifact adapter.
```

### response: redirect

[Declaration source](response/definition.ts#L133)

```text
function redirect<Status extends 300 | 301 | 302 | 303 | 307 | 308>(status: Status, options: Omit<ResponseDefinitionInput<undefined, Status>, "id" | "status" | "schema" | "mode"> & { readonly id?: string; }): ResponseDefinition<undefined, Status> & { readonly mode: "redirect"; }
  Define an HTTP redirect response.
```

### response: select

[Declaration source](response/definition.ts#L218)

```text
function select<Entries extends Readonly<Record<PropertyKey, ResponseDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: Catalog<Entries[keyof Entries], Entries>, keys: Keys): CatalogSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select an immutable key-preserving response subset.
```

### response: stream

[Declaration source](response/definition.ts#L145)

```text
function stream<Schema extends ResponseSchema>(schema: Schema, options: Omit<ResponseDefinitionInput<Schema, 200>, "id" | "status" | "schema" | "mode"> & { readonly id?: string; }): ResponseDefinition<Schema, 200> & { readonly mode: "stream"; }
  Define a streaming response.
```

### response: withHeaders

[Declaration source](response/result.ts#L141)

```text
function withHeaders<Definition extends ResponseDefinition>(result: ResponseResult<Definition>, headers: import("./headers.ts").HeaderInput): ResponseResult<Definition>
  Return a copy of a logical result with occurrence headers merged in.
```

### response: withMeta

[Declaration source](response/result.ts#L150)

```text
function withMeta<Definition extends ResponseDefinition>(result: ResponseResult<Definition>, meta: Readonly<Record<string, unknown>>): ResponseResult<Definition>
  Return a copy whose final body contains merged metadata in a data envelope.
```

### response: status

[Declaration source](response/mod.ts#L57)

```text
namespace status
  HTTP status recognition schemas; constructible response statuses are a separate policy.

  reference InformationalStatus: ./packages/http/response/status.ts:8:1
    Informational HTTP status codes currently registered by IANA.
  reference SuccessStatus: ./packages/http/response/status.ts:10:1
    Successful HTTP status codes.
  reference RedirectStatus: ./packages/http/response/status.ts:12:1
    Redirect HTTP status codes, including deprecated 305/306 for recognition.
  reference ClientErrorStatus: ./packages/http/response/status.ts:14:1
    Standard client-error HTTP status codes.
  reference ServerErrorStatus: ./packages/http/response/status.ts:45:1
    Standard server-error HTTP status codes.
  reference HttpStatus: ./packages/http/response/status.ts:47:1
    Every standard final/interim status recognized by the utility.
  reference ProblemStatus: ./packages/http/response/status.ts:49:1
    Statuses valid for RFC problem responses.
  reference ContentlessStatus: ./packages/http/response/status.ts:51:1
    Statuses whose semantics prohibit a message body.
  reference ContentfulStatus: ./packages/http/response/status.ts:53:1
    Recognized statuses that may carry a representation.
  reference HttpStatusSchema: ./packages/http/response/status.ts:56:1
    Standard Schema plus JSON Schema projection for an HTTP status subset.
  reference informational: ./packages/http/response/status.ts:103:14
    Informational status schema.
  reference success: ./packages/http/response/status.ts:105:14
    Successful status schema.
  reference redirect: ./packages/http/response/status.ts:107:14
    Redirect status schema.
  reference clientError: ./packages/http/response/status.ts:109:14
    Client-error status schema.
  reference serverError: ./packages/http/response/status.ts:111:14
    Server-error status schema.
  reference problem: ./packages/http/response/status.ts:113:14
    RFC problem status schema.
  reference contentless: ./packages/http/response/status.ts:115:14
    Contentless status schema.
  reference contentful: ./packages/http/response/status.ts:117:14
    Contentful status schema.
  reference any: ./packages/http/response/status.ts:122:14
    All recognized HTTP statuses.
  reference is: ./packages/http/response/status.ts:133:1
    Return whether a value is any recognized HTTP status.
  reference isProblem: ./packages/http/response/status.ts:138:1
    Return whether a value is valid for an RFC problem response.
  reference isContentless: ./packages/http/response/status.ts:143:1
    Return whether the status semantics prohibit a message body.
```

### response: ByteRange

[Declaration source](response/mod.ts#L39)

```text
reference ByteRange: ./packages/http/response/http.ts:5:1
```

### response: ClientErrorStatus

[Declaration source](response/mod.ts#L59)

```text
reference ClientErrorStatus: ./packages/http/response/status.ts:14:1
```

### response: ContentfulStatus

[Declaration source](response/mod.ts#L60)

```text
reference ContentfulStatus: ./packages/http/response/status.ts:53:1
```

### response: ContentlessStatus

[Declaration source](response/mod.ts#L61)

```text
reference ContentlessStatus: ./packages/http/response/status.ts:51:1
```

### response: CreateResponseOptions

[Declaration source](response/mod.ts#L72)

```text
reference CreateResponseOptions: ./packages/http/response/types.ts:225:1
```

### response: CursorPageWindow

[Declaration source](response/mod.ts#L73)

```text
reference CursorPageWindow: ./packages/http/response/types.ts:120:1
```

### response: FinalizeResponseOptions

[Declaration source](response/mod.ts#L75)

```text
reference FinalizeResponseOptions: ./packages/http/response/types.ts:241:1
```

### response: FinalizedResponseResult

[Declaration source](response/mod.ts#L74)

```text
reference FinalizedResponseResult: ./packages/http/response/types.ts:287:1
```

### response: HeaderField

[Declaration source](response/mod.ts#L76)

```text
reference HeaderField: ./packages/http/response/headers.ts:3:1
```

### response: HeaderInput

[Declaration source](response/mod.ts#L77)

```text
reference HeaderInput: ./packages/http/response/headers.ts:12:1
```

### response: HeaderValue

[Declaration source](response/mod.ts#L78)

```text
reference HeaderValue: ./packages/http/response/headers.ts:6:1
```

### response: HtmlBody

[Declaration source](response/mod.ts#L79)

```text
reference HtmlBody: ./packages/http/response/types.ts:43:1
```

### response: HtmlChunk

[Declaration source](response/mod.ts#L80)

```text
reference HtmlChunk: ./packages/http/response/types.ts:40:1
```

### response: HttpStatus

[Declaration source](response/mod.ts#L62)

```text
reference HttpStatus: ./packages/http/response/status.ts:47:1
```

### response: HttpStatusSchema

[Declaration source](response/mod.ts#L63)

```text
reference HttpStatusSchema: ./packages/http/response/status.ts:56:1
```

### response: InformationalStatus

[Declaration source](response/mod.ts#L64)

```text
reference InformationalStatus: ./packages/http/response/status.ts:8:1
```

### response: NormalizedPageWindow

[Declaration source](response/mod.ts#L81)

```text
reference NormalizedPageWindow: ./packages/http/response/types.ts:207:1
```

### response: OffsetPageWindow

[Declaration source](response/mod.ts#L82)

```text
reference OffsetPageWindow: ./packages/http/response/types.ts:144:1
```

### response: PageWindow

[Declaration source](response/mod.ts#L83)

```text
reference PageWindow: ./packages/http/response/types.ts:166:1
```

### response: PaginationLinkContext

[Declaration source](response/mod.ts#L84)

```text
reference PaginationLinkContext: ./packages/http/response/types.ts:213:1
```

### response: PaginationLinks

[Declaration source](response/mod.ts#L85)

```text
reference PaginationLinks: ./packages/http/response/types.ts:193:1
```

### response: PaginationMetadata

[Declaration source](response/mod.ts#L86)

```text
reference PaginationMetadata: ./packages/http/response/types.ts:251:1
```

### response: PaginationParameters

[Declaration source](response/mod.ts#L87)

```text
reference PaginationParameters: ./packages/http/response/types.ts:179:1
```

### response: PaginationResponsePolicy

[Declaration source](response/mod.ts#L88)

```text
reference PaginationResponsePolicy: ./packages/http/response/types.ts:49:1
```

### response: ProblemStatus

[Declaration source](response/mod.ts#L65)

```text
reference ProblemStatus: ./packages/http/response/status.ts:49:1
```

### response: RedirectStatus

[Declaration source](response/mod.ts#L66)

```text
reference RedirectStatus: ./packages/http/response/status.ts:12:1
```

### response: ResponseBody

[Declaration source](response/mod.ts#L89)

```text
reference ResponseBody: ./packages/http/response/types.ts:169:1
```

### response: ResponseCompletion

[Declaration source](response/mod.ts#L40)

```text
reference ResponseCompletion: ./packages/http/response/completion.ts:1:1
```

### response: ResponseDefinition

[Declaration source](response/mod.ts#L90)

```text
reference ResponseDefinition: ./packages/http/response/types.ts:57:1
```

### response: ResponseDefinitionInput

[Declaration source](response/mod.ts#L91)

```text
reference ResponseDefinitionInput: ./packages/http/response/types.ts:90:1
```

### response: ResponseDocument

[Declaration source](response/mod.ts#L92)

```text
reference ResponseDocument: ./packages/http/response/types.ts:299:1
```

### response: ResponseEnvelope

[Declaration source](response/mod.ts#L93)

```text
reference ResponseEnvelope: ./packages/http/response/types.ts:46:1
```

### response: ResponseExample

[Declaration source](response/mod.ts#L94)

```text
reference ResponseExample: ./packages/http/response/types.ts:28:1
```

### response: ResponseHeaders

[Declaration source](response/mod.ts#L95)

```text
reference ResponseHeaders: ./packages/http/response/headers.ts:9:1
```

### response: ResponseResult

[Declaration source](response/mod.ts#L96)

```text
reference ResponseResult: ./packages/http/response/types.ts:335:1
```

### response: ResponseResultMetadata

[Declaration source](response/mod.ts#L97)

```text
reference ResponseResultMetadata: ./packages/http/response/types.ts:327:1
```

### response: ResponseSchema

[Declaration source](response/mod.ts#L98)

```text
reference ResponseSchema: ./packages/http/response/types.ts:5:1
```

### response: ResponseStatus

[Declaration source](response/mod.ts#L99)

```text
reference ResponseStatus: ./packages/http/response/types.ts:8:1
```

### response: ServerErrorStatus

[Declaration source](response/mod.ts#L67)

```text
reference ServerErrorStatus: ./packages/http/response/status.ts:45:1
```

### response: SuccessEnvelope

[Declaration source](response/mod.ts#L100)

```text
reference SuccessEnvelope: ./packages/http/response/types.ts:277:1
```

### response: SuccessStatus

[Declaration source](response/mod.ts#L68)

```text
reference SuccessStatus: ./packages/http/response/status.ts:10:1
```

### response: appendHeaders

[Declaration source](response/mod.ts#L41)

```text
reference appendHeaders: ./packages/http/response/headers.ts:49:1
```

### response: byteRange

[Declaration source](response/mod.ts#L38)

```text
reference byteRange: ./packages/http/response/http.ts:54:1
```

### response: byteRangeHeaders

[Declaration source](response/mod.ts#L38)

```text
reference byteRangeHeaders: ./packages/http/response/http.ts:94:1
```

### response: clientErrorStatus

[Declaration source](response/mod.ts#L44)

```text
reference clientErrorStatus: ./packages/http/response/status.ts:109:14
```

### response: conditionalHeaders

[Declaration source](response/mod.ts#L38)

```text
reference conditionalHeaders: ./packages/http/response/http.ts:44:1
```

### response: contentfulStatus

[Declaration source](response/mod.ts#L45)

```text
reference contentfulStatus: ./packages/http/response/status.ts:117:14
```

### response: contentlessStatus

[Declaration source](response/mod.ts#L46)

```text
reference contentlessStatus: ./packages/http/response/status.ts:115:14
```

### response: headerEntries

[Declaration source](response/mod.ts#L41)

```text
reference headerEntries: ./packages/http/response/headers.ts:29:1
```

### response: headerValues

[Declaration source](response/mod.ts#L41)

```text
reference headerValues: ./packages/http/response/headers.ts:76:1
```

### response: headers

[Declaration source](response/mod.ts#L41)

```text
reference headers: ./packages/http/response/headers.ts:24:1
```

### response: informationalStatus

[Declaration source](response/mod.ts#L47)

```text
reference informationalStatus: ./packages/http/response/status.ts:103:14
```

### response: isContentlessStatus

[Declaration source](response/mod.ts#L49)

```text
reference isContentlessStatus: ./packages/http/response/status.ts:143:1
```

### response: isNotModified

[Declaration source](response/mod.ts#L38)

```text
reference isNotModified: ./packages/http/response/http.ts:23:1
```

### response: isProblemStatus

[Declaration source](response/mod.ts#L50)

```text
reference isProblemStatus: ./packages/http/response/status.ts:138:1
```

### response: isStatus

[Declaration source](response/mod.ts#L48)

```text
reference isStatus: ./packages/http/response/status.ts:133:1
```

### response: mergeHeaders

[Declaration source](response/mod.ts#L41)

```text
reference mergeHeaders: ./packages/http/response/headers.ts:34:1
```

### response: mergeVary

[Declaration source](response/mod.ts#L41)

```text
reference mergeVary: ./packages/http/response/headers.ts:54:1
```

### response: onComplete

[Declaration source](response/mod.ts#L35)

```text
reference onComplete: ./packages/http/response/completion.ts:11:1
```

### response: problemStatus

[Declaration source](response/mod.ts#L51)

```text
reference problemStatus: ./packages/http/response/status.ts:113:14
```

### response: readText

[Declaration source](response/mod.ts#L37)

```text
reference readText: ./packages/http/response/body.ts:6:1
```

### response: redirectStatus

[Declaration source](response/mod.ts#L52)

```text
reference redirectStatus: ./packages/http/response/status.ts:107:14
```

### response: serverErrorStatus

[Declaration source](response/mod.ts#L53)

```text
reference serverErrorStatus: ./packages/http/response/status.ts:111:14
```

### response: statusAny

[Declaration source](response/mod.ts#L43)

```text
reference statusAny: ./packages/http/response/status.ts:122:14
```

### response: successStatus

[Declaration source](response/mod.ts#L54)

```text
reference successStatus: ./packages/http/response/status.ts:105:14
```

### response: toHeaders

[Declaration source](response/mod.ts#L41)

```text
reference toHeaders: ./packages/http/response/headers.ts:69:1
```

## response-body

Import `@okikio/http/response/body`. [Source](./response/body.ts).

### response-body: readText

[Declaration source](response/body.ts#L6)

```text
async function readText(response: Response, maximumBytes: number): Promise<string>
  Read one HTTP response body without allowing an upstream peer to force unbounded buffering.

  The declared Content-Length is rejected before reading when it exceeds the limit. The
  streaming byte count remains authoritative because peers can omit or misstate that header.
```

## response-completion

Import `@okikio/http/response/completion`. [Source](./response/completion.ts).

### response-completion: onComplete

[Declaration source](response/completion.ts#L11)

```text
function onComplete(response: Response, observe: (completion: ResponseCompletion) => void | Promise<void>): Response
  Observe full response-body completion without buffering or cloning the body.
```

### response-completion: ResponseCompletion

[Declaration source](response/completion.ts#L1)

```text
interface ResponseCompletion
  Final outcome of delivering a response body to the host/client.

  readonly outcome: "completed" | "cancelled" | "errored"
    Whether the response body completed, was cancelled or failed.
  readonly bytes: number
    Response-body bytes observed before its terminal outcome.
  readonly reason?: unknown
    Cancellation or stream failure reason retained for diagnostics.
```

## response-headers

Import `@okikio/http/response/headers`. [Source](./response/headers.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source             |
| ---------------- | ------------------------------------ |
| `recordCore`     | [record contracts](../record/API.md) |

### response-headers: appendHeaders

[Declaration source](response/headers.ts#L49)

```text
function appendHeaders(base: HeaderInput, additional: HeaderInput): ResponseHeaders
  Append additional field occurrences rather than replacing existing values.
```

### response-headers: headerEntries

[Declaration source](response/headers.ts#L29)

```text
function headerEntries(input: HeaderInput): readonly HeaderField[]
  Return every HTTP field occurrence in deterministic order.
```

### response-headers: headerValues

[Declaration source](response/headers.ts#L76)

```text
function headerValues(input: HeaderInput, name: string): readonly string[]
  Read every value for a field without comma-splitting values such as Set-Cookie.
```

### response-headers: headers

[Declaration source](response/headers.ts#L24)

```text
function headers(input: HeaderInput): ResponseHeaders
  Validate and normalize one header input without flattening repeated fields.
```

### response-headers: mergeHeaders

[Declaration source](response/headers.ts#L34)

```text
function mergeHeaders(...sources: readonly (HeaderInput | undefined)[]): ResponseHeaders
  Merge header sources with later sources replacing earlier fields by name.
```

### response-headers: mergeVary

[Declaration source](response/headers.ts#L54)

```text
function mergeVary(current: string | null | undefined, ...names: readonly string[]): string
  Merge request field names into one HTTP `Vary` value without duplicates.
```

### response-headers: toHeaders

[Declaration source](response/headers.ts#L69)

```text
function toHeaders(input: HeaderInput): Headers
  Return a standard Headers instance while preserving repeatable values where the runtime permits it.
```

### response-headers: HeaderField

[Declaration source](response/headers.ts#L3)

```text
type HeaderField = readonly [string, string]
  One HTTP field occurrence. Repeated fields are represented by repeated entries.
```

### response-headers: HeaderInput

[Declaration source](response/headers.ts#L12)

```text
type HeaderInput = ResponseHeaders | readonly HeaderField[] | Headers
  Header input accepted by response and problem occurrence APIs.
```

### response-headers: HeaderValue

[Declaration source](response/headers.ts#L6)

```text
type HeaderValue = string | readonly string[]
  Ergonomic value accepted in record-shaped header input.
```

### response-headers: ResponseHeaders

[Declaration source](response/headers.ts#L9)

```text
type ResponseHeaders = Readonly<Record<string, HeaderValue>>
  Immutable header record used in response/problem tuples.
```

## response-http

Import `@okikio/http/response/http`. [Source](./response/http.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding  | Contract owner or source                                  |
| ----------------- | --------------------------------------------------------- |
| `ifNoneMatch`     | [External source](https://jsr.io/@std/http/1.1.3/etag.ts) |
| `HeaderInput`     | [Source](response/headers.ts)                             |
| `ResponseHeaders` | [Source](response/headers.ts)                             |
| `headers`         | [Source](response/headers.ts)                             |
| `headerValues`    | [Source](response/headers.ts)                             |

### response-http: byteRange

[Declaration source](response/http.ts#L54)

```text
function byteRange(value: string | null, size: number): ByteRange
  Parse a single RFC 9110 bytes range without allocating or reading a body.
```

### response-http: byteRangeHeaders

[Declaration source](response/http.ts#L94)

```text
function byteRangeHeaders(range: Exclude<ByteRange, { readonly kind: "none" | "unsupported-multiple"; }>): Readonly<Record<string, string>>
  Return standard fields for one satisfiable or unsatisfiable byte-range decision.
```

### response-http: conditionalHeaders

[Declaration source](response/http.ts#L44)

```text
function conditionalHeaders(input: HeaderInput): ResponseHeaders
  Retain the representation metadata fields permitted on a generated 304 response.
```

### response-http: notModified

[Declaration source](response/http.ts#L23)

```text
function notModified(request: Request, responseHeaders: HeaderInput): boolean
  Evaluate GET/HEAD conditional request fields against response validators.

  `If-None-Match` takes precedence over `If-Modified-Since`. ETag comparison
  uses the weak comparison required for cache validation and supports `*`.
```

### response-http: ByteRange

[Declaration source](response/http.ts#L5)

```text
type ByteRange = Readonly<{ readonly kind: "none"; }> | Readonly<{ readonly kind: "unsupported-multiple"; }> | Readonly<{ readonly kind: "unsatisfiable"; readonly contentRange: string; }> | Readonly<{ readonly kind: "satisfiable"; readonly start: number; readonly end: number; readonly length: number; readonly contentRange: string; }>
  Result of parsing one HTTP byte-range request.
```

## response-status

Import `@okikio/http/response/status`. [Source](./response/status.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding       | Contract owner or source                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| `StandardJSONSchemaV1` | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `StandardSchemaV1`     | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |

### response-status: is

[Declaration source](response/status.ts#L133)

```text
function is(value: unknown): value is HttpStatus
  Return whether a value is any recognized HTTP status.
```

### response-status: isContentless

[Declaration source](response/status.ts#L143)

```text
function isContentless(value: unknown): value is ContentlessStatus
  Return whether the status semantics prohibit a message body.
```

### response-status: isProblem

[Declaration source](response/status.ts#L138)

```text
function isProblem(value: unknown): value is ProblemStatus
  Return whether a value is valid for an RFC problem response.
```

### response-status: any

[Declaration source](response/status.ts#L122)

```text
const any
  All recognized HTTP statuses.
```

### response-status: clientError

[Declaration source](response/status.ts#L109)

```text
const clientError
  Client-error status schema.
```

### response-status: contentful

[Declaration source](response/status.ts#L117)

```text
const contentful
  Contentful status schema.
```

### response-status: contentless

[Declaration source](response/status.ts#L115)

```text
const contentless
  Contentless status schema.
```

### response-status: informational

[Declaration source](response/status.ts#L103)

```text
const informational
  Informational status schema.
```

### response-status: problem

[Declaration source](response/status.ts#L113)

```text
const problem
  RFC problem status schema.
```

### response-status: redirect

[Declaration source](response/status.ts#L107)

```text
const redirect
  Redirect status schema.
```

### response-status: serverError

[Declaration source](response/status.ts#L111)

```text
const serverError
  Server-error status schema.
```

### response-status: success

[Declaration source](response/status.ts#L105)

```text
const success
  Successful status schema.
```

### response-status: ClientErrorStatus

[Declaration source](response/status.ts#L14)

```text
type ClientErrorStatus = 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 421 | 422 | 423 | 424 | 425 | 426 | 428 | 429 | 431 | 451
  Standard client-error HTTP status codes.
```

### response-status: ContentfulStatus

[Declaration source](response/status.ts#L53)

```text
type ContentfulStatus = Exclude<HttpStatus, ContentlessStatus>
  Recognized statuses that may carry a representation.
```

### response-status: ContentlessStatus

[Declaration source](response/status.ts#L51)

```text
type ContentlessStatus = 101 | 204 | 205 | 304
  Statuses whose semantics prohibit a message body.
```

### response-status: HttpStatus

[Declaration source](response/status.ts#L47)

```text
type HttpStatus = InformationalStatus | SuccessStatus | RedirectStatus | ClientErrorStatus | ServerErrorStatus
  Every standard final/interim status recognized by the utility.
```

### response-status: HttpStatusSchema

[Declaration source](response/status.ts#L56)

```text
type HttpStatusSchema<Status extends number = HttpStatus> = StandardSchemaV1<unknown, Status> & StandardJSONSchemaV1<unknown, Status> & Readonly<{ is(value: unknown): value is Status; readonly values: readonly Status[]; }>
  Standard Schema plus JSON Schema projection for an HTTP status subset.
```

### response-status: InformationalStatus

[Declaration source](response/status.ts#L8)

```text
type InformationalStatus = 100 | 101 | 102 | 103 | 104
  Informational HTTP status codes currently registered by IANA.
```

### response-status: ProblemStatus

[Declaration source](response/status.ts#L49)

```text
type ProblemStatus = ClientErrorStatus | ServerErrorStatus
  Statuses valid for RFC problem responses.
```

### response-status: RedirectStatus

[Declaration source](response/status.ts#L12)

```text
type RedirectStatus = 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308
  Redirect HTTP status codes, including deprecated 305/306 for recognition.
```

### response-status: ServerErrorStatus

[Declaration source](response/status.ts#L45)

```text
type ServerErrorStatus = 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511
  Standard server-error HTTP status codes.
```

### response-status: SuccessStatus

[Declaration source](response/status.ts#L10)

```text
type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226
  Successful HTTP status codes.
```

## response-types

Import `@okikio/http/response/types`. [Source](./response/types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding       | Contract owner or source                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| `StandardSchemaV1`     | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `CatalogEntryIdentity` | [catalog contracts](../catalog/API.md)                                     |
| `HeaderInput`          | [Source](response/headers.ts)                                              |
| `ResponseHeaders`      | [Source](response/headers.ts)                                              |

### response-types: CreateResponseOptions

[Declaration source](response/types.ts#L225)

```text
interface CreateResponseOptions
  Options applied when instantiating a successful response.

  readonly headers?: HeaderInput
    Explicit transport headers retained for this boundary; credential forwarding uses its separate policy.
  readonly location?: string | URL
    Source location of this validation observation.
  readonly filename?: string
    Caller-selected download name projected into safe Content-Disposition metadata.
  readonly url?: string | URL
    Explicit link-generation base URL. The server request URL is used when omitted.
  readonly link?: (context: PaginationLinkContext) => string | URL | undefined
    Optional override for each generated pagination link.
  readonly meta?: Readonly<Record<string, unknown>>
    Application-owned metadata added to the success envelope.
```

### response-types: CursorPageWindow

[Declaration source](response/types.ts#L120)

```text
interface CursorPageWindow<Item>
  Cursor-based page returned by a storage adapter.

  readonly kind: "cursor"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly items: readonly Item[]
    Items in this exact page window, in provider order.
  readonly limit: number
    Maximum requested items in this page window.
  readonly hasMore: boolean
    Whether the provider reports additional items beyond this window.
  readonly cursor?: string
    Opaque position used for this cursor page; the provider owns its interpretation.
  readonly nextCursor?: string
    Opaque position for the next page, when supplied by the provider.
  readonly previousCursor?: string
    Opaque position for the previous page, when supplied by the provider.
  readonly total?: number
    Exact total item count, when the provider knows it.
  readonly approximateTotal?: number
    Estimated total retained separately from an exact count.
  readonly expiresAt?: Temporal.Instant | string
    Optional expiry instant for provider-owned cursor validity.
```

### response-types: FinalizeResponseOptions

[Declaration source](response/types.ts#L241)

```text
interface FinalizeResponseOptions
  Adapter-owned materialization options.

  readonly url?: string | URL
    Explicit URL used by this contract; transport owners validate origins separately.
  readonly pagination?: Partial<PaginationParameters>
    Pagination presentation or URL parameter policy for this response.
  readonly now?: () => Temporal.Instant | string
    Application-owned clock for response timestamp materialization.
```

### response-types: FinalizedResponseResult

[Declaration source](response/types.ts#L287)

```text
interface FinalizedResponseResult<Definition extends ResponseDefinition = ResponseDefinition>
  Fully request-aware result ready for native HTTP response conversion.

  readonly definition: Definition
    Exact successful response definition used to validate and materialize this result.
  readonly body: unknown
    Final validated HTTP representation after envelope, timestamp and pagination policy.
  readonly status: Definition["status"]
    HTTP status selected by this response or reported by this lifecycle observation.
  readonly headers: ResponseHeaders
    Explicit transport headers retained for this boundary; credential forwarding uses its separate policy.
```

### response-types: OffsetPageWindow

[Declaration source](response/types.ts#L144)

```text
interface OffsetPageWindow<Item>
  Offset/page-number page returned by a storage adapter.

  readonly kind: "offset"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly items: readonly Item[]
    Items in this exact page window, in provider order.
  readonly offset: number
    Zero-based starting item offset in this page window.
  readonly limit: number
    Maximum requested items in this page window.
  readonly hasMore: boolean
    Whether the provider reports additional items beyond this window.
  readonly source?: "offset" | "page"
    Whether this offset was requested directly or derived from a one-based page.
  readonly page?: number
    One-based page number retained for page-style presentation.
  readonly total?: number
    Exact total item count, when the provider knows it.
  readonly approximateTotal?: number
    Estimated total retained separately from an exact count.
```

### response-types: PaginationLinkContext

[Declaration source](response/types.ts#L213)

```text
interface PaginationLinkContext<Page extends PageWindow<unknown> = PageWindow<unknown>>
  Context supplied to a custom pagination link builder.

  readonly relation: keyof PaginationLinks
    Pagination link relation requested from the custom builder.
  readonly page: Page
    Validated page window for which this link is being constructed.
  readonly url: URL
    Base request URL used for link generation.
  readonly generated?: URL
    Default generated pagination URL offered to the custom link builder.
```

### response-types: PaginationLinks

[Declaration source](response/types.ts#L193)

```text
interface PaginationLinks
  Generated pagination links.

  readonly self?: string
    Link to this page window.
  readonly first?: string
    Link to the first page, when it can be constructed.
  readonly previous?: string
    Link to the previous page, when the provider supplies a usable position.
  readonly next?: string
    Link to the next page, when the provider supplies a usable position.
  readonly last?: string
    Link to the last page, when its position is known.
```

### response-types: PaginationMetadata

[Declaration source](response/types.ts#L251)

```text
interface PaginationMetadata
  JSON-safe pagination metadata emitted in a response body.

  readonly kind: "cursor" | "offset"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly limit: number
    Maximum requested items in this page window.
  readonly hasMore: boolean
    Whether the provider reports additional items beyond this window.
  readonly cursor?: string
    Opaque position used for this cursor page; the provider owns its interpretation.
  readonly offset?: number
    Zero-based starting item offset in this page window.
  readonly page?: number
    One-based page number retained for page-style presentation.
  readonly perPage?: number
    Requested items per page in page-style presentation.
  readonly total?: number
    Exact total item count, when the provider knows it.
  readonly approximateTotal?: number
    Estimated total retained separately from an exact count.
  readonly totalPages?: number
    Total page count derived from an exact total and page size.
  readonly expiresAt?: string
    Optional expiry instant for provider-owned cursor validity.
```

### response-types: PaginationParameters

[Declaration source](response/types.ts#L179)

```text
interface PaginationParameters
  Standard pagination URL parameter names used during materialization.

  readonly cursor: string
    URL parameter name for an opaque cursor.
  readonly limit: string
    URL parameter name for the requested cursor/offset limit.
  readonly offset: string
    URL parameter name for a zero-based offset.
  readonly page: string
    URL parameter name for a one-based page number.
  readonly perPage: string
    URL parameter name for page size.
```

### response-types: PaginationResponsePolicy

[Declaration source](response/types.ts#L49)

```text
interface PaginationResponsePolicy
  Pagination presentation policy retained by a paginated response definition.

  readonly links: "none" | "header" | "body" | "both"
    Where pagination links are emitted: headers, body, both or neither.
  readonly totals: "none" | "headers" | "body" | "both"
    Where known pagination totals are presented: headers, body, both or neither.
```

### response-types: ResponseDefinition

[Declaration source](response/types.ts#L57)

```text
interface ResponseDefinition<Schema extends ResponseSchema | undefined = ResponseSchema | undefined, Status extends ResponseStatus = ResponseStatus> extends CatalogEntryIdentity
  Static successful response contract.

  readonly kind: "response"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly status: Status
    HTTP status selected by this response or reported by this lifecycle observation.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly schema?: Schema
    Standard Schema validator and transform for the value accepted by this contract.
  readonly jsonSchema?: unknown
    Explicit JSON Schema for the serialized HTTP body when it differs from validation output.
  readonly contentType?: string
    Declared HTTP media type for this input or response body.
  readonly headers?: ResponseHeaders
    Explicit transport headers retained for this boundary; credential forwarding uses its separate policy.
  readonly examples?: readonly ResponseExample[]
    Concrete authored examples retained for API documentation.
  readonly mode: "body" | "empty" | "redirect" | "stream" | "download" | "page" | "html"
    Selected materialization or forwarding behavior for this definition.
  readonly envelope: ResponseEnvelope
    Whether HTTP materialization wraps the body in the data envelope.
  readonly timestamp: boolean
    Whether materialization includes the configured response timestamp.
  readonly pagination?: PaginationResponsePolicy
    Pagination presentation or URL parameter policy for this response.
  readonly filename?: string
    Caller-selected download name projected into safe Content-Disposition metadata.
```

### response-types: ResponseDefinitionInput

[Declaration source](response/types.ts#L90)

```text
interface ResponseDefinitionInput<Schema extends ResponseSchema | undefined, Status extends ResponseStatus>
  Input accepted by {@link define}.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly status: Status
    HTTP status selected by this response or reported by this lifecycle observation.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly schema?: Schema
    Standard Schema validator and transform for the value accepted by this contract.
  readonly jsonSchema?: unknown
    Explicit JSON Schema for the serialized HTTP body when it differs from validation output.
  readonly contentType?: string
    Declared HTTP media type for this input or response body.
  readonly headers?: HeaderInput
    Explicit transport headers retained for this boundary; credential forwarding uses its separate policy.
  readonly examples?: readonly ResponseExample[]
    Concrete authored examples retained for API documentation.
  readonly mode?: ResponseDefinition["mode"]
    Selected materialization or forwarding behavior for this definition.
  readonly envelope?: ResponseEnvelope
    Whether HTTP materialization wraps the body in the data envelope.
  readonly timestamp?: boolean
    Whether materialization includes the configured response timestamp.
  readonly pagination?: Partial<PaginationResponsePolicy>
    Pagination presentation or URL parameter policy for this response.
  readonly filename?: string
    Caller-selected download name projected into safe Content-Disposition metadata.
```

### response-types: ResponseDocument

[Declaration source](response/types.ts#L299)

```text
interface ResponseDocument
  JSON-safe documentation projection for a successful response definition.

  readonly key?: string
    Authored name of this entry or example in its containing catalog.
  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly status: ResponseStatus
    HTTP status selected by this response or reported by this lifecycle observation.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly contentType?: string
    Declared HTTP media type for this input or response body.
  readonly mode: ResponseDefinition["mode"]
    Selected materialization or forwarding behavior for this definition.
  readonly envelope: ResponseEnvelope
    Whether HTTP materialization wraps the body in the data envelope.
  readonly timestamp: boolean
    Whether materialization includes the configured response timestamp.
  readonly pagination?: PaginationResponsePolicy
    Projected pagination presentation policy; parameter names are adapter options.
  readonly examples: readonly ResponseExample[]
    Concrete authored examples retained for API documentation.
  readonly headers: ResponseHeaders
    Explicit transport headers retained for this boundary; credential forwarding uses its separate policy.
  readonly filename?: string
    Caller-selected download name projected into safe Content-Disposition metadata.
```

### response-types: ResponseExample

[Declaration source](response/types.ts#L28)

```text
interface ResponseExample<Value = unknown>
  Concrete request or response example retained for generated documentation.

  readonly key: string
    Authored name of this entry or example in its containing catalog.
  readonly summary?: string
    Short explanation shown beside this operation or example in generated references.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
  readonly value: Value
    Concrete example payload retained for generated documentation.
```

### response-types: ResponseResultMetadata

[Declaration source](response/types.ts#L327)

```text
interface ResponseResultMetadata<Definition extends ResponseDefinition = ResponseDefinition>
  Hidden metadata attached to each response tuple.

  readonly definition: Definition
    Exact response definition retained with this logical tuple.
  readonly options: CreateResponseOptions
    Occurrence-specific options retained before response materialization.
```

### response-types: SuccessEnvelope

[Declaration source](response/types.ts#L277)

```text
interface SuccessEnvelope<Data = unknown>
  Default success envelope.

  readonly data: Data
    Logical successful response data carried by the envelope.
  readonly meta?: Readonly<Record<string, unknown>>
    Application-owned metadata added to the success envelope.
  readonly links?: PaginationLinks
    Generated pagination links retained in the body envelope.
```

### response-types: HtmlBody

[Declaration source](response/types.ts#L43)

```text
type HtmlBody = string | ReadableStream<Uint8Array> | AsyncIterable<HtmlChunk>
  Complete one-off HTML body accepted as a string, Web Stream, or async iterable.
```

### response-types: HtmlChunk

[Declaration source](response/types.ts#L40)

```text
type HtmlChunk = string | Uint8Array
  One string or encoded byte chunk accepted by a streaming HTML response.
```

### response-types: NormalizedPageWindow

[Declaration source](response/types.ts#L207)

```text
type NormalizedPageWindow<Page extends PageWindow<unknown>> = Page extends OffsetPageWindow<infer Item> ? OffsetPageWindow<Item> : Page extends CursorPageWindow<infer Item> ? CursorPageWindow<Item> : never
  Normalized page-window variant retained after runtime validation.
```

### response-types: PageWindow

[Declaration source](response/types.ts#L166)

```text
type PageWindow<Item> = CursorPageWindow<Item> | OffsetPageWindow<Item>
  Transport-neutral page window supplied to a paginated response definition.
```

### response-types: ResponseBody

[Declaration source](response/types.ts#L169)

```text
type ResponseBody<Definition extends ResponseDefinition> = Definition["mode"] extends "empty" | "redirect" ? undefined : Definition extends ResponseDefinition<infer Schema> ? Schema extends ResponseSchema ? Definition["mode"] extends "page" ? PageWindow<StandardSchemaV1.InferOutput<Schema>> : StandardSchemaV1.InferOutput<Schema> : unknown : unknown
  Logical body accepted when instantiating one response definition.
```

### response-types: ResponseEnvelope

[Declaration source](response/types.ts#L46)

```text
type ResponseEnvelope = "none" | "data"
  Optional success envelope added during HTTP materialization.
```

### response-types: ResponseResult

[Declaration source](response/types.ts#L335)

```text
type ResponseResult<Definition extends ResponseDefinition = ResponseDefinition, Body = unknown, Headers extends ResponseHeaders = ResponseHeaders> = readonly [Body, Definition["status"], Headers]
  Logical tuple returned by endpoint handlers before request-aware materialization.
```

### response-types: ResponseSchema

[Declaration source](response/types.ts#L5)

```text
type ResponseSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>
  Standard Schema-compatible response body contract.
```

### response-types: ResponseStatus

[Declaration source](response/types.ts#L8)

```text
type ResponseStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226 | 300 | 301 | 302 | 303 | 304 | 307 | 308
  HTTP success and redirect status codes supported by response definitions.
```

### response-types: HeaderField

[Declaration source](response/types.ts#L341)

```text
reference HeaderField: ./packages/http/response/headers.ts:3:1
```

### response-types: HeaderInput

[Declaration source](response/types.ts#L341)

```text
reference HeaderInput: ./packages/http/response/headers.ts:12:1
```

### response-types: HeaderValue

[Declaration source](response/types.ts#L341)

```text
reference HeaderValue: ./packages/http/response/headers.ts:6:1
```

### response-types: ResponseHeaders

[Declaration source](response/types.ts#L341)

```text
reference ResponseHeaders: ./packages/http/response/headers.ts:9:1
```

## webhook

Import `@okikio/http/webhook`. [Source](./webhook/mod.ts).

Authenticate the exact received bytes while keeping the original request available to its parser.

The fixed test key and clock make this example reproducible. A real application supplies secrets and replay policy.
Verify before parsing, then add key rotation and bounded raw-body admission; delivery retries and deduplication belong
to the receiving service.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source   |
| --------------------------- | -------------------------- |
| `readBody`                  | [Source](request/mod.ts)   |
| `RequestTransportError`     | [Source](request/mod.ts)   |
| `VerifyRequestOptions`      | [Source](webhook/types.ts) |
| `WebhookVerificationResult` | [Source](webhook/types.ts) |
| `WebhookVerifier`           | [Source](webhook/types.ts) |

### webhook: verifyRequest

[Declaration source](webhook/mod.ts#L31)

```text
async function verifyRequest(request: Request, verifier: WebhookVerifier, options: VerifyRequestOptions): Promise<WebhookVerificationResult>
  Authenticate a bounded clone of a Web Request without consuming the original.

  This is intended for `beforeValidation`-style middleware. Signature
  verification observes exact bytes first; ordinary parsing and Standard Schema
  validation can then consume a separate clone or the original request.
```

### webhook: VerifyRequestOptions

[Declaration source](webhook/types.ts#L59)

```text
interface VerifyRequestOptions
  Bounded raw-request policy used before application parsing or validation.

  readonly maximumBodyBytes?: number
    Maximum signed request body accepted in bytes. Defaults to 1 MiB.
  readonly now?: Date
    Clock supplied for deterministic verification and testing.
```

### webhook: WebhookVerificationFailure

[Declaration source](webhook/types.ts#L32)

```text
interface WebhookVerificationFailure
  Authentication failure safe to branch on without exposing signed material.

  readonly ok: false
    Discriminant that selects successful verification or a stable failure code.
  readonly code: WebhookVerificationFailureCode
    Stable failure code; callers should branch on this instead of matching explanation text.
```

### webhook: WebhookVerificationInput

[Declaration source](webhook/types.ts#L43)

```text
interface WebhookVerificationInput
  Exact request material supplied to a protocol-specific webhook verifier.

  readonly body: Uint8Array
    Exact raw signed bytes, before application parsing or normalization.
  readonly headers: Headers
    Original request headers containing the protocol signature fields.
  readonly now: Date
    Explicit verification Date used for timestamp admission.
```

### webhook: WebhookVerificationSuccess

[Declaration source](webhook/types.ts#L18)

```text
interface WebhookVerificationSuccess
  Successful webhook authentication result.

  readonly ok: true
    Discriminant that selects successful verification or a stable failure code.
  readonly id: string
    Authenticated webhook message identity; consumers still own deduplication.
  readonly timestamp: number
    Authenticated webhook timestamp in epoch seconds.
  readonly version: string
    Signature protocol version that authenticated the payload.
  readonly keyIndex: number
    Index of the configured verification key that authenticated the message.
```

### webhook: WebhookVerifier

[Declaration source](webhook/types.ts#L53)

```text
interface WebhookVerifier
  Framework-neutral webhook authenticator.

  verify(input: WebhookVerificationInput): WebhookVerificationResult | Promise<WebhookVerificationResult>
    Authenticate the exact signed bytes and headers with the explicit verification time.
```

### webhook: WebhookPayload

[Declaration source](webhook/types.ts#L1)

```text
type WebhookPayload = string | Uint8Array
  Raw payload accepted by webhook signing operations.
```

### webhook: WebhookVerificationFailureCode

[Declaration source](webhook/types.ts#L4)

```text
type WebhookVerificationFailureCode = "body-too-large" | "invalid-content-length" | "missing-header" | "malformed-id" | "malformed-timestamp" | "timestamp-too-old" | "timestamp-too-new" | "signature-header-too-large" | "too-many-signatures" | "malformed-signature" | "invalid-signature"
  Stable failures produced while authenticating a webhook request.
```

### webhook: WebhookVerificationResult

[Declaration source](webhook/types.ts#L40)

```text
type WebhookVerificationResult = WebhookVerificationSuccess | WebhookVerificationFailure
  Result returned by a webhook verifier.
```

### webhook: standard

[Declaration source](webhook/mod.ts#L65)

```text
namespace standard
  Symmetric Standard Webhooks signing, verification, key rotation and bounded admission.

  reference StandardWebhookOptions: ./packages/http/webhook/standard.ts:30:1
    Security and work bounds used by one Standard Webhooks signer/verifier.

    Supply either `secret` or `secrets`. Multiple secrets support key rotation.
    The implementation caps configured keys and accepted signatures so one
    request cannot increase HMAC work without a declared limit.
  reference SignStandardWebhookOptions: ./packages/http/webhook/standard.ts:54:1
    Exact message identity and payload used for one outbound signature.

    `body` must be the same bytes later transmitted. A `Date` or epoch-seconds
    value controls the signed timestamp. If `timestamp` is absent, signing uses
    the current time.
  reference StandardWebhookHeaders: ./packages/http/webhook/standard.ts:64:1
    Headers emitted by Standard Webhooks v1 signing.
  reference StandardWebhook: ./packages/http/webhook/standard.ts:71:1
    Configured Standard Webhooks v1 verifier and signer.
  reference create: ./packages/http/webhook/standard.ts:77:1
    Create one reusable Standard Webhooks v1 symmetric protocol instance.
```

## webhook-standard

Import `@okikio/http/webhook/standard`. [Source](./webhook/standard.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                 | Contract owner or source                                         |
| -------------------------------- | ---------------------------------------------------------------- |
| `decodeBase64`                   | [External source](https://jsr.io/@std/encoding/1.0.11/base64.ts) |
| `encodeBase64`                   | [External source](https://jsr.io/@std/encoding/1.0.11/base64.ts) |
| `WebhookPayload`                 | [Source](webhook/types.ts)                                       |
| `WebhookVerificationFailureCode` | [Source](webhook/types.ts)                                       |
| `WebhookVerificationInput`       | [Source](webhook/types.ts)                                       |
| `WebhookVerificationResult`      | [Source](webhook/types.ts)                                       |
| `WebhookVerifier`                | [Source](webhook/types.ts)                                       |

### webhook-standard: create

[Declaration source](webhook/standard.ts#L77)

```text
function create(options: StandardWebhookOptions): StandardWebhook
  Create one reusable Standard Webhooks v1 symmetric protocol instance.
```

### webhook-standard: SignStandardWebhookOptions

[Declaration source](webhook/standard.ts#L54)

```text
interface SignStandardWebhookOptions
  Exact message identity and payload used for one outbound signature.

  `body` must be the same bytes later transmitted. A `Date` or epoch-seconds
  value controls the signed timestamp. If `timestamp` is absent, signing uses
  the current time.

  readonly id: string
    Stable identity used to correlate this contract or occurrence.
  readonly body: WebhookPayload
    Exact payload covered by the transport or signature contract.
  readonly timestamp?: number | Date
    Timestamp used by the wire signature contract.
```

### webhook-standard: StandardWebhook

[Declaration source](webhook/standard.ts#L71)

```text
interface StandardWebhook extends WebhookVerifier
  Configured Standard Webhooks v1 verifier and signer.

  sign(options: SignStandardWebhookOptions): Promise<StandardWebhookHeaders>
    Sign the exact supplied bytes and return headers from that same signing operation.
```

### webhook-standard: StandardWebhookOptions

[Declaration source](webhook/standard.ts#L30)

```text
interface StandardWebhookOptions
  Security and work bounds used by one Standard Webhooks signer/verifier.

  Supply either `secret` or `secrets`. Multiple secrets support key rotation.
  The implementation caps configured keys and accepted signatures so one
  request cannot increase HMAC work without a declared limit.

  readonly secret?: string
    Application-owned symmetric signing key; no default production key is supplied.
  readonly secrets?: readonly string[]
    Application-owned keys used for explicit signing or verification rotation.
  readonly toleranceSeconds?: number
    Allowed age difference between the signed timestamp and verification time, in seconds.
  readonly maximumSignatures?: number
    Maximum signature tokens inspected for one verification.
  readonly maximumSignatureHeaderBytes?: number
    Maximum encoded signature header length, in bytes.
  readonly maximumKeys?: number
    Maximum signing or verification keys admitted for one operation.
  readonly maximumIdBytes?: number
    Maximum encoded webhook ID length, in bytes.
```

### webhook-standard: StandardWebhookHeaders

[Declaration source](webhook/standard.ts#L64)

```text
type StandardWebhookHeaders = Readonly<{ readonly webhook-id: string; readonly webhook-timestamp: string; readonly webhook-signature: string; }>
  Headers emitted by Standard Webhooks v1 signing.
```
