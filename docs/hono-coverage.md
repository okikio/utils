# Hono test provenance and contract coverage

The complete pinned Hono test source is retained so a reviewer can compare an original input and assertion with its
Utils translation. Start with a row in the [source ledger](#complete-source-ledger), then inspect the original
`.test.txt` file and the registration's callback in [inventory.json](../tests/fixtures/hono-upstream/inventory.json). A
mapped registration names a local executable test and the behavior it selects. Runtime results belong to the
qualification receipts for those tests.

The source pin is Hono **4.13.5**, commit
[`06880c4a2b04de9dd74217f26dd831209b9c01f1`](https://github.com/honojs/hono/tree/06880c4a2b04de9dd74217f26dd831209b9c01f1).
The supplied checkout contains **112 `.test.ts` files**, **26 `.test.tsx` files**, and **one `.test.json` input**, all
preserved byte for byte. The [manifest](../tests/fixtures/hono-upstream/manifest.json) records every original path,
retained path, byte length, SHA256, and scope decision. The [MIT license](../tests/fixtures/hono-upstream/LICENSE) is
retained with the source. These files have `.txt` extensions so ordinary Deno/Node test discovery does not try to
execute Vitest registrations, JSX, provider credentials, or upstream runtime setup.

## What the index proves

`tools/hono-inventory.ts` uses the installed TypeScript compiler API to read registration syntax, callback bodies,
assertion expressions, likely request and response input expressions, hooks, and router factory calls. It preserves
exact source spans and one-based lines. Source expressions remain source expressions: the tool does not evaluate
fixtures, reconstruct every possible helper call, or infer expected values from arbitrary JavaScript.

The index counts **static registration sites**. `it.each`, tagged test tables, loops, conditional registration, computed
titles, and common-router factories can produce more or fewer tests when Hono's own runner executes them. These
constructs remain visible in the index and do not become invented expanded counts. For example,
`src/router/common.case.test.ts` defines shared cases; the router wrappers call that factory with different constructors
and skip rules. Counting the wrappers as separately executed copies would require running their actual configurations.

At this pin, the AST index records **878 suite sites and 2,911 test sites**. It retains **52 each sites**, **15 computed
titles**, and **21 registrations inside lexical loop/conditional contexts**. These syntax counts describe the complete
retained test sources, including TSX and provider/type suites; they are not portable HTTP pass counts.

The hash check rejects changed or missing retained bytes, unexpected source files, a changed source pin, stale AST
output, stale scope assignments, and executable links to missing upstream registrations. It checks that each mapped
local executable file exists. A link is a reviewed contract selection, not proof that the test passed, that every
assertion was translated, or that an entire Hono suite is compatible. The source archive was supplied at the named pin;
the manifest's content hashes check that captured archive, rather than claiming that this directory is a Git checkout.

## Executable translations and remaining work

The [core contract registry](../tests/fixtures/hono-contracts/coverage.json) names selected original router, request,
response, middleware, and application inputs exercised by `tests/hono-contracts.test.ts`. The
[proxy registry](../tests/fixtures/hono-proxy/coverage.json) names each original proxy registration exercised by
`tests/hono-proxy.test.ts`. The [composition registry](../tests/fixtures/hono-compose/coverage.json) separates
executable cases from an applicability audit of every original compose registration. Read their `behavior` and
`disposition` fields before treating a translation as parity. A translated case can intentionally produce a different
result under a stricter request policy or a different public programming model.

The core registry marks its scope as `selected-observations`: those cases assert the named literal projections, rather
than every assertion in their original callback. Several input vectors can refer to one original registration. The proxy
registry states its original asserted projections and documents the policy differences separately. Retaining the full
original callbacks lets a reviewer identify additional assertions that need translation instead of treating a linked
source line as complete coverage.

Composition audit decisions appear in each site's `review` field. The checker requires a complete review for every
registration in an audited source and rejects duplicate or missing source references. An audit-only decision does not
increment executable links or become a runtime receipt.

The two compose registrations at original lines 308 and 322 are audit-only. They inspect `Context.finalized` after a
handler returns `undefined`, whereas the public HTTP translations require a returned Response. The audit retains this
API difference instead of using a cast to invent an equivalent wire outcome.

Every test site in the AST index carries its own coverage status. A linked site has
`linked-contract-no-execution-receipt`; an unlinked HTTP/core/router/proxy site has `unmapped-contract-candidate`. The
latter means that its inputs and outputs still need an applicability review and an executable selection. It is neither
an exclusion nor a pass. Host, type, build, and Hono-specific programming model sites remain separately named review
work. A zero candidate count in a host or JSX row therefore does not mean that row is covered.

Prioritize the following remaining contract classes. The generated ledger and each site's assertion/body spans identify
the exact unlinked registrations; the list explains why they matter.

| Source area                                                 | Applicable outcome to verify                                                                             | Translation or limit to keep visible                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/hono.test.ts`                                          | Method dispatch, HEAD fallback, mounted paths, error/not-found responses, and request/response mutation  | Hono registration order, route mounting, and multi-handler matching differ from Utils route ownership.                       |
| `src/request.test.ts`                                       | Parameters, repeated query values, headers, cookies, JSON/form/body reads and consumed-body errors       | A HonoRequest wrapper and Utils explicit parsing/memoization have different ownership APIs.                                  |
| `src/context.test.ts`                                       | Response status, body, headers, cookies, redirect and replacement behavior                               | Hono Context variable storage and response finalization are distinct from scoped Utils Context and declared service outputs. |
| `src/compose.test.ts`                                       | Onion ordering, short-circuiting, errors and repeated `next()` calls                                     | Preserve the observable sequence and failure, while keeping the two middleware signatures explicit.                          |
| `src/router/common.case.test.ts` and router implementations | Literal/wildcard/parameter matching, methods, encoded paths, precedence, and duplicate patterns          | Do not hide regex/optional-segment support, multi-match results, skipped shared cases, or rejected ambiguous registrations.  |
| `src/helper/proxy/index.test.ts`                            | Bodies, cookies, Connection nominations, decoded encoding metadata, request overrides and disconnects    | Host/Accept-Encoding forwarding, malformed nominations, and trusted transport overrides need explicit per-candidate results. |
| HTTP middleware and utilities                               | Body limits, streaming cancellation, header policies, parsing/security errors, and conditional responses | Authentication/JWT/JWK, compression and platform caches need an actual corresponding Utils capability before a parity claim. |
| Runtime/provider adapters                                   | Socket metadata, provider response conversion, abort callbacks and streaming under the named host        | Generic native Node/Deno Fetch tests do not execute AWS, Fastly, Bun or workerd adapter contracts.                           |
| Types, clients, JSX and build transforms                    | Compiler inference, typed clients, rendering and artifact metadata                                       | Hono-specific type syntax, JSX and build transformations are retained for review; they do not imply equivalent Utils APIs.   |

## Reproduce and review

Run these commands through the repository's pinned mise runtime. Capture needs the complete checkout at the exact pin;
write and check use only retained source and local executable registries.

```sh
mise exec -- deno run -A tools/hono-inventory.ts capture /path/to/hono-4.13.5
mise exec -- deno run -A tools/hono-inventory.ts write
mise exec -- deno run -A tools/hono-inventory.ts check
mise exec -- deno test -A tools/hono-inventory.test.ts
```

`write` refreshes the registration index and the table below after provenance links change. `check` is read-only. Both
report source-site and mapping counts, which must be kept separate from runtime pass counts. The small tooling tests
exercise actual AST behavior for matcher arguments, callback inputs, shared suite attribution, computed/each
registrations, tagged tables, Deno assertions, and TSX parsing. They do not validate Hono's runtime behavior.

## Complete source ledger

Each source row is retained, classified, and represented in the AST index. Linked sites are distinct upstream test
registration sites, even when several literal fixture rows exercise one registration. Unmapped contract candidates are
registrations awaiting review in the applicable HTTP categories. Other categories retain their own per-registration
review status in the JSON index.

<!-- hono-inventory:start -->

| Upstream source                                                                                                                                    | Scope                       | Static test sites | Linked sites | Unmapped contract candidates |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------: | -----------: | ---------------------------: |
| [build/remove-private-fields.test.ts](../tests/fixtures/hono-upstream/source/build/remove-private-fields.test.txt)                                 | build-contract              |                 1 |            0 |                            0 |
| [build/validate-exports.test.ts](../tests/fixtures/hono-upstream/source/build/validate-exports.test.txt)                                           | build-contract              |                 1 |            0 |                            0 |
| [runtime-tests/bun/color.test.ts](../tests/fixtures/hono-upstream/source/runtime-tests/bun/color.test.txt)                                         | host-integration            |                 1 |            0 |                            0 |
| [runtime-tests/bun/index.test.tsx](../tests/fixtures/hono-upstream/source/runtime-tests/bun/index.test.txt)                                        | host-integration            |                25 |            0 |                            0 |
| [runtime-tests/deno-jsx/jsx.test.tsx](../tests/fixtures/hono-upstream/source/runtime-tests/deno-jsx/jsx.test.txt)                                  | host-integration            |                12 |            0 |                            0 |
| [runtime-tests/deno/hono.test.ts](../tests/fixtures/hono-upstream/source/runtime-tests/deno/hono.test.txt)                                         | host-integration            |                 3 |            0 |                            0 |
| [runtime-tests/deno/middleware.test.tsx](../tests/fixtures/hono-upstream/source/runtime-tests/deno/middleware.test.txt)                            | host-integration            |                 4 |            0 |                            0 |
| [runtime-tests/deno/ssg.test.tsx](../tests/fixtures/hono-upstream/source/runtime-tests/deno/ssg.test.txt)                                          | host-integration            |                 1 |            0 |                            0 |
| [runtime-tests/deno/stream.test.ts](../tests/fixtures/hono-upstream/source/runtime-tests/deno/stream.test.txt)                                     | host-integration            |                 4 |            0 |                            0 |
| [runtime-tests/fastly/index.test.ts](../tests/fixtures/hono-upstream/source/runtime-tests/fastly/index.test.txt)                                   | host-integration            |                 6 |            0 |                            0 |
| [runtime-tests/lambda-edge/index.test.ts](../tests/fixtures/hono-upstream/source/runtime-tests/lambda-edge/index.test.txt)                         | host-integration            |                15 |            0 |                            0 |
| [runtime-tests/lambda/index.test.ts](../tests/fixtures/hono-upstream/source/runtime-tests/lambda/index.test.txt)                                   | host-integration            |                34 |            0 |                            0 |
| [runtime-tests/lambda/stream.test.ts](../tests/fixtures/hono-upstream/source/runtime-tests/lambda/stream.test.txt)                                 | host-integration            |                 1 |            0 |                            0 |
| [runtime-tests/node/index.test.ts](../tests/fixtures/hono-upstream/source/runtime-tests/node/index.test.txt)                                       | host-integration            |                14 |            0 |                            0 |
| [runtime-tests/workerd/index.test.ts](../tests/fixtures/hono-upstream/source/runtime-tests/workerd/index.test.txt)                                 | host-integration            |                 5 |            0 |                            0 |
| [src/adapter/aws-lambda/conninfo.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/aws-lambda/conninfo.test.txt)                         | host-integration            |                 4 |            0 |                            0 |
| [src/adapter/aws-lambda/handler.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/aws-lambda/handler.test.txt)                           | host-integration            |                23 |            0 |                            0 |
| [src/adapter/bun/conninfo.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/bun/conninfo.test.txt)                                       | host-integration            |                 6 |            0 |                            0 |
| [src/adapter/bun/server.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/bun/server.test.txt)                                           | host-integration            |                 1 |            0 |                            0 |
| [src/adapter/bun/websocket.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/bun/websocket.test.txt)                                     | host-integration            |                 8 |            0 |                            0 |
| [src/adapter/cloudflare-pages/conninfo.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/cloudflare-pages/conninfo.test.txt)             | host-integration            |                 2 |            0 |                            0 |
| [src/adapter/cloudflare-pages/handler.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/cloudflare-pages/handler.test.txt)               | host-integration            |                15 |            0 |                            0 |
| [src/adapter/cloudflare-workers/conninfo.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/cloudflare-workers/conninfo.test.txt)         | host-integration            |                 1 |            0 |                            0 |
| [src/adapter/cloudflare-workers/serve-static.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/cloudflare-workers/serve-static.test.txt) | host-integration            |                16 |            0 |                            0 |
| [src/adapter/cloudflare-workers/utils.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/cloudflare-workers/utils.test.txt)               | host-integration            |                 1 |            0 |                            0 |
| [src/adapter/cloudflare-workers/websocket.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/cloudflare-workers/websocket.test.txt)       | host-integration            |                 6 |            0 |                            0 |
| [src/adapter/deno/conninfo.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/deno/conninfo.test.txt)                                     | host-integration            |                 1 |            0 |                            0 |
| [src/adapter/deno/websocket.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/deno/websocket.test.txt)                                   | host-integration            |                 6 |            0 |                            0 |
| [src/adapter/lambda-edge/conninfo.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/lambda-edge/conninfo.test.txt)                       | host-integration            |                 1 |            0 |                            0 |
| [src/adapter/lambda-edge/handler.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/lambda-edge/handler.test.txt)                         | host-integration            |                16 |            0 |                            0 |
| [src/adapter/netlify/conninfo.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/netlify/conninfo.test.txt)                               | host-integration            |                 3 |            0 |                            0 |
| [src/adapter/service-worker/handler.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/service-worker/handler.test.txt)                   | host-integration            |                 5 |            0 |                            0 |
| [src/adapter/vercel/conninfo.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/vercel/conninfo.test.txt)                                 | host-integration            |                 1 |            0 |                            0 |
| [src/adapter/vercel/handler.test.ts](../tests/fixtures/hono-upstream/source/src/adapter/vercel/handler.test.txt)                                   | host-integration            |                 2 |            0 |                            0 |
| [src/client/client.test.ts](../tests/fixtures/hono-upstream/source/src/client/client.test.txt)                                                     | framework-programming-model |               108 |            0 |                            0 |
| [src/client/types.test.ts](../tests/fixtures/hono-upstream/source/src/client/types.test.txt)                                                       | type-contract               |                13 |            0 |                            0 |
| [src/client/utils.test.ts](../tests/fixtures/hono-upstream/source/src/client/utils.test.txt)                                                       | framework-programming-model |                32 |            0 |                            0 |
| [src/compose.test.ts](../tests/fixtures/hono-upstream/source/src/compose.test.txt)                                                                 | core-fetch-contract         |                32 |           30 |                            2 |
| [src/context.test.ts](../tests/fixtures/hono-upstream/source/src/context.test.txt)                                                                 | core-fetch-contract         |                56 |           40 |                           16 |
| [src/helper/accepts/accepts.test.ts](../tests/fixtures/hono-upstream/source/src/helper/accepts/accepts.test.txt)                                   | helper-component            |                13 |            0 |                           13 |
| [src/helper/adapter/index.test.ts](../tests/fixtures/hono-upstream/source/src/helper/adapter/index.test.txt)                                       | helper-component            |                 4 |            0 |                            4 |
| [src/helper/cookie/index.test.ts](../tests/fixtures/hono-upstream/source/src/helper/cookie/index.test.txt)                                         | helper-component            |                29 |            0 |                           29 |
| [src/helper/css/common.case.test.tsx](../tests/fixtures/hono-upstream/source/src/helper/css/common.case.test.txt)                                  | helper-component            |                22 |            0 |                           22 |
| [src/helper/css/index.test.tsx](../tests/fixtures/hono-upstream/source/src/helper/css/index.test.txt)                                              | helper-component            |                26 |            0 |                           26 |
| [src/helper/dev/index.test.ts](../tests/fixtures/hono-upstream/source/src/helper/dev/index.test.txt)                                               | helper-component            |                 8 |            0 |                            8 |
| [src/helper/factory/index.test.ts](../tests/fixtures/hono-upstream/source/src/helper/factory/index.test.txt)                                       | helper-component            |                17 |            0 |                           17 |
| [src/helper/html/index.test.ts](../tests/fixtures/hono-upstream/source/src/helper/html/index.test.txt)                                             | helper-component            |                 8 |            0 |                            8 |
| [src/helper/proxy/index.test.ts](../tests/fixtures/hono-upstream/source/src/helper/proxy/index.test.txt)                                           | proxy-contract              |                14 |           14 |                            0 |
| [src/helper/route/index.test.ts](../tests/fixtures/hono-upstream/source/src/helper/route/index.test.txt)                                           | helper-component            |                 8 |            0 |                            8 |
| [src/helper/ssg/plugins.test.tsx](../tests/fixtures/hono-upstream/source/src/helper/ssg/plugins.test.txt)                                          | helper-component            |                 9 |            0 |                            9 |
| [src/helper/ssg/ssg.test.tsx](../tests/fixtures/hono-upstream/source/src/helper/ssg/ssg.test.txt)                                                  | helper-component            |                51 |            0 |                           51 |
| [src/helper/ssg/utils.test.ts](../tests/fixtures/hono-upstream/source/src/helper/ssg/utils.test.txt)                                               | helper-component            |                 9 |            0 |                            9 |
| [src/helper/streaming/sse.test.tsx](../tests/fixtures/hono-upstream/source/src/helper/streaming/sse.test.txt)                                      | helper-component            |                19 |            0 |                           19 |
| [src/helper/streaming/stream.test.ts](../tests/fixtures/hono-upstream/source/src/helper/streaming/stream.test.txt)                                 | helper-component            |                 5 |            0 |                            5 |
| [src/helper/streaming/text.test.ts](../tests/fixtures/hono-upstream/source/src/helper/streaming/text.test.txt)                                     | helper-component            |                 1 |            0 |                            1 |
| [src/helper/testing/index.test.ts](../tests/fixtures/hono-upstream/source/src/helper/testing/index.test.txt)                                       | helper-component            |                 5 |            0 |                            5 |
| [src/helper/websocket/index.test.ts](../tests/fixtures/hono-upstream/source/src/helper/websocket/index.test.txt)                                   | helper-component            |                11 |            0 |                           11 |
| [src/hono.test.ts](../tests/fixtures/hono-upstream/source/src/hono.test.txt)                                                                       | core-fetch-contract         |               203 |           46 |                          157 |
| [src/http-exception.test.ts](../tests/fixtures/hono-upstream/source/src/http-exception.test.txt)                                                   | core-fetch-contract         |                 3 |            0 |                            3 |
| [src/jsx/base.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/base.test.txt)                                                              | framework-programming-model |                 6 |            0 |                            0 |
| [src/jsx/children.test.ts](../tests/fixtures/hono-upstream/source/src/jsx/children.test.txt)                                                       | framework-programming-model |                 6 |            0 |                            0 |
| [src/jsx/components.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/components.test.txt)                                                  | framework-programming-model |                34 |            0 |                            0 |
| [src/jsx/context-isolation.test.ts](../tests/fixtures/hono-upstream/source/src/jsx/context-isolation.test.txt)                                     | framework-programming-model |                20 |            0 |                            0 |
| [src/jsx/dom/client.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/dom/client.test.txt)                                                  | framework-programming-model |                 7 |            0 |                            0 |
| [src/jsx/dom/components.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/dom/components.test.txt)                                          | framework-programming-model |                11 |            0 |                            0 |
| [src/jsx/dom/context.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/dom/context.test.txt)                                                | framework-programming-model |                 6 |            0 |                            0 |
| [src/jsx/dom/css.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/dom/css.test.txt)                                                        | framework-programming-model |                 4 |            0 |                            0 |
| [src/jsx/dom/hooks/index.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/dom/hooks/index.test.txt)                                        | framework-programming-model |                 5 |            0 |                            0 |
| [src/jsx/dom/index.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/dom/index.test.txt)                                                    | framework-programming-model |               139 |            0 |                            0 |
| [src/jsx/dom/intrinsic-element/components.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/dom/intrinsic-element/components.test.txt)      | framework-programming-model |                60 |            0 |                            0 |
| [src/jsx/dom/server.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/dom/server.test.txt)                                                  | framework-programming-model |                16 |            0 |                            0 |
| [src/jsx/hooks/dom.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/hooks/dom.test.txt)                                                    | framework-programming-model |                27 |            0 |                            0 |
| [src/jsx/hooks/string.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/hooks/string.test.txt)                                              | framework-programming-model |                 3 |            0 |                            0 |
| [src/jsx/index.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/index.test.txt)                                                            | framework-programming-model |               127 |            0 |                            0 |
| [src/jsx/intrinsic-element/components.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/intrinsic-element/components.test.txt)              | framework-programming-model |                40 |            0 |                            0 |
| [src/jsx/jsx-runtime.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/jsx-runtime.test.txt)                                                | framework-programming-model |                 9 |            0 |                            0 |
| [src/jsx/streaming.test.tsx](../tests/fixtures/hono-upstream/source/src/jsx/streaming.test.txt)                                                    | framework-programming-model |                33 |            0 |                            0 |
| [src/jsx/utils.test.ts](../tests/fixtures/hono-upstream/source/src/jsx/utils.test.txt)                                                             | framework-programming-model |                27 |            0 |                            0 |
| [src/middleware/basic-auth/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/basic-auth/index.test.txt)                         | http-component              |                17 |            0 |                           17 |
| [src/middleware/bearer-auth/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/bearer-auth/index.test.txt)                       | http-component              |                48 |            0 |                           48 |
| [src/middleware/body-limit/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/body-limit/index.test.txt)                         | http-component              |                12 |            0 |                           12 |
| [src/middleware/cache/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/cache/index.test.txt)                                   | http-component              |                53 |            0 |                           53 |
| [src/middleware/combine/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/combine/index.test.txt)                               | http-component              |                15 |            0 |                           15 |
| [src/middleware/compress/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/compress/index.test.txt)                             | http-component              |                45 |            0 |                           45 |
| [src/middleware/context-storage/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/context-storage/index.test.txt)               | http-component              |                 3 |            0 |                            3 |
| [src/middleware/cors/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/cors/index.test.txt)                                     | http-component              |                25 |            0 |                           25 |
| [src/middleware/csrf/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/csrf/index.test.txt)                                     | http-component              |                31 |            0 |                           31 |
| [src/middleware/etag/digest.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/etag/digest.test.txt)                                   | http-component              |                 1 |            0 |                            1 |
| [src/middleware/etag/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/etag/index.test.txt)                                     | http-component              |                20 |            0 |                           20 |
| [src/middleware/ip-restriction/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/ip-restriction/index.test.txt)                 | http-component              |                 9 |            0 |                            9 |
| [src/middleware/jsx-renderer/index.test.tsx](../tests/fixtures/hono-upstream/source/src/middleware/jsx-renderer/index.test.txt)                    | http-component              |                16 |            0 |                           16 |
| [src/middleware/jwk/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/jwk/index.test.txt)                                       | http-component              |                57 |            0 |                           57 |
| [src/middleware/jwk/keys.test.json](../tests/fixtures/hono-upstream/source/src/middleware/jwk/keys.test.txt)                                       | http-component              |                 0 |            0 |                            0 |
| [src/middleware/jwt/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/jwt/index.test.txt)                                       | http-component              |                44 |            0 |                           44 |
| [src/middleware/language/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/language/index.test.txt)                             | http-component              |                34 |            0 |                           34 |
| [src/middleware/logger/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/logger/index.test.txt)                                 | http-component              |                15 |            0 |                           15 |
| [src/middleware/method-not-allowed/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/method-not-allowed/index.test.txt)         | http-component              |                20 |            0 |                           20 |
| [src/middleware/method-override/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/method-override/index.test.txt)               | http-component              |                12 |            0 |                           12 |
| [src/middleware/powered-by/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/powered-by/index.test.txt)                         | http-component              |                 3 |            0 |                            3 |
| [src/middleware/pretty-json/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/pretty-json/index.test.txt)                       | http-component              |                 6 |            0 |                            6 |
| [src/middleware/request-id/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/request-id/index.test.txt)                         | http-component              |                11 |            0 |                           11 |
| [src/middleware/secure-headers/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/secure-headers/index.test.txt)                 | http-component              |                24 |            0 |                           24 |
| [src/middleware/serve-static/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/serve-static/index.test.txt)                     | http-component              |                20 |            0 |                           20 |
| [src/middleware/serve-static/path.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/serve-static/path.test.txt)                       | http-component              |                 1 |            0 |                            1 |
| [src/middleware/timeout/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/timeout/index.test.txt)                               | http-component              |                 4 |            0 |                            4 |
| [src/middleware/timing/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/timing/index.test.txt)                                 | http-component              |                16 |            0 |                           16 |
| [src/middleware/trailing-slash/index.test.ts](../tests/fixtures/hono-upstream/source/src/middleware/trailing-slash/index.test.txt)                 | http-component              |                36 |            0 |                           36 |
| [src/preset/quick.test.ts](../tests/fixtures/hono-upstream/source/src/preset/quick.test.txt)                                                       | framework-programming-model |                 2 |            0 |                            0 |
| [src/preset/tiny.test.ts](../tests/fixtures/hono-upstream/source/src/preset/tiny.test.txt)                                                         | framework-programming-model |                 2 |            0 |                            0 |
| [src/request.test.ts](../tests/fixtures/hono-upstream/source/src/request.test.txt)                                                                 | core-fetch-contract         |                44 |           27 |                           17 |
| [src/router/common.case.test.ts](../tests/fixtures/hono-upstream/source/src/router/common.case.test.txt)                                           | router-contract             |                97 |           97 |                            0 |
| [src/router/linear-router/router.test.ts](../tests/fixtures/hono-upstream/source/src/router/linear-router/router.test.txt)                         | router-contract             |                 3 |            0 |                            3 |
| [src/router/pattern-router/router.test.ts](../tests/fixtures/hono-upstream/source/src/router/pattern-router/router.test.txt)                       | router-contract             |                 2 |            0 |                            2 |
| [src/router/reg-exp-router/prepared-router.test.ts](../tests/fixtures/hono-upstream/source/src/router/reg-exp-router/prepared-router.test.txt)     | router-contract             |                 7 |            0 |                            7 |
| [src/router/reg-exp-router/router.test.ts](../tests/fixtures/hono-upstream/source/src/router/reg-exp-router/router.test.txt)                       | router-contract             |                22 |            0 |                           22 |
| [src/router/smart-router/router.test.ts](../tests/fixtures/hono-upstream/source/src/router/smart-router/router.test.txt)                           | router-contract             |                 0 |            0 |                            0 |
| [src/router/trie-router/node.test.ts](../tests/fixtures/hono-upstream/source/src/router/trie-router/node.test.txt)                                 | router-contract             |                86 |            0 |                           86 |
| [src/router/trie-router/router.test.ts](../tests/fixtures/hono-upstream/source/src/router/trie-router/router.test.txt)                             | router-contract             |                 0 |            0 |                            0 |
| [src/types.test.ts](../tests/fixtures/hono-upstream/source/src/types.test.txt)                                                                     | type-contract               |               120 |            0 |                            0 |
| [src/utils/accept.test.ts](../tests/fixtures/hono-upstream/source/src/utils/accept.test.txt)                                                       | http-component              |                29 |            0 |                           29 |
| [src/utils/basic-auth.test.ts](../tests/fixtures/hono-upstream/source/src/utils/basic-auth.test.txt)                                               | http-component              |                 6 |            0 |                            6 |
| [src/utils/body.test.ts](../tests/fixtures/hono-upstream/source/src/utils/body.test.txt)                                                           | http-component              |                43 |            0 |                           43 |
| [src/utils/buffer.test.ts](../tests/fixtures/hono-upstream/source/src/utils/buffer.test.txt)                                                       | http-component              |                12 |            0 |                           12 |
| [src/utils/color.test.ts](../tests/fixtures/hono-upstream/source/src/utils/color.test.txt)                                                         | http-component              |                 3 |            0 |                            3 |
| [src/utils/concurrent.test.ts](../tests/fixtures/hono-upstream/source/src/utils/concurrent.test.txt)                                               | http-component              |                 2 |            0 |                            2 |
| [src/utils/cookie.test.ts](../tests/fixtures/hono-upstream/source/src/utils/cookie.test.txt)                                                       | http-component              |                47 |            0 |                           47 |
| [src/utils/crypto.test.ts](../tests/fixtures/hono-upstream/source/src/utils/crypto.test.txt)                                                       | http-component              |                 5 |            0 |                            5 |
| [src/utils/encode.test.ts](../tests/fixtures/hono-upstream/source/src/utils/encode.test.txt)                                                       | http-component              |                 2 |            0 |                            2 |
| [src/utils/filepath.test.ts](../tests/fixtures/hono-upstream/source/src/utils/filepath.test.txt)                                                   | http-component              |                 2 |            0 |                            2 |
| [src/utils/html.test.ts](../tests/fixtures/hono-upstream/source/src/utils/html.test.txt)                                                           | http-component              |                 1 |            0 |                            1 |
| [src/utils/ipaddr.test.ts](../tests/fixtures/hono-upstream/source/src/utils/ipaddr.test.txt)                                                       | http-component              |                12 |            0 |                           12 |
| [src/utils/jwt/jwa.test.ts](../tests/fixtures/hono-upstream/source/src/utils/jwt/jwa.test.txt)                                                     | http-component              |                 4 |            0 |                            4 |
| [src/utils/jwt/jwt.test.ts](../tests/fixtures/hono-upstream/source/src/utils/jwt/jwt.test.txt)                                                     | http-component              |                76 |            0 |                           76 |
| [src/utils/mime.test.ts](../tests/fixtures/hono-upstream/source/src/utils/mime.test.txt)                                                           | http-component              |                 5 |            0 |                            5 |
| [src/utils/stream.test.ts](../tests/fixtures/hono-upstream/source/src/utils/stream.test.txt)                                                       | http-component              |                14 |            0 |                           14 |
| [src/utils/types.test.ts](../tests/fixtures/hono-upstream/source/src/utils/types.test.txt)                                                         | type-contract               |                39 |            0 |                            0 |
| [src/utils/url.test.ts](../tests/fixtures/hono-upstream/source/src/utils/url.test.txt)                                                             | http-component              |                31 |            0 |                           31 |
| [src/validator/utils.test.ts](../tests/fixtures/hono-upstream/source/src/validator/utils.test.txt)                                                 | http-component              |                14 |            0 |                           14 |
| [src/validator/validator.test.ts](../tests/fixtures/hono-upstream/source/src/validator/validator.test.txt)                                         | http-component              |                50 |            0 |                           50 |

<!-- hono-inventory:end -->
