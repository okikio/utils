# Consumer scenarios

Start with a problem owned by an application. Compose the focused utility contracts around that problem, and keep the
external provider, cancellation owner, and terminal result visible. The examples in [composition.md](composition.md)
teach executable public-import flows. This catalogue explains their source provenance and the limits of the test
evidence.

The canonical machine-readable selections live in [qualification.json](qualification.json). A selection is a recipe for
verification. It is not a record that a command ran or a claim that a deployment has recovered.

## crm-import

Stage CRM file streams, preserve original columns/row occurrences, then classify domain evidence.

Failure cases: Late explicit headers, malformed rows, byte/row/cell bounds, and chunk splits cannot silently alter
original cells.

Ownership: CSV owns the reader until iteration/disposal. The application deliberately materializes rows for editable
drafts.

Proof level: Reconstructed generic import composition and exact generated-cell oracles; no browser UI or IndexedDB
recovery claim.

Consumer source:

- `okikio/kaiju-platform`: `apps/frontend/src/routes/(product)/_app/(import)/-csv.ts`

Executable evidence:

- [tests/discovery.test.ts](../tests/discovery.test.ts)
- [packages/csv/properties.test.ts](../packages/csv/properties.test.ts)
- [packages/email/mod.test.ts](../packages/email/mod.test.ts)

## crawl-discovery

Parse robots/Sitemap routes and inspect HTML/CSS references before admitting bounded crawl work.

Failure cases: Namespaces, malformed/hostile documents, producer cancellation, and exhausted capacity must retain their
distinct outcomes.

Ownership: The parser owns only source iteration; the collector owns Fetch/browser providers and application admission
policy.

Proof level: Public-import reconstruction plus protocol-scale parser and bounded-admission tests, without executing
remote crawl workloads.

Consumer source:

- `okikio/kaiju-crawl`: `packages/discovery/src/sitemap.ts`
- `okikio/kaiju-crawl`: `packages/assets/src/resource/index.ts`
- `okikio/kaiju-crawl`: `packages/page/src/source.ts`
- `okikio/kaiju-crawl`: `packages/browser/src/capture.ts`

Executable evidence:

- [tests/discovery.test.ts](../tests/discovery.test.ts)
- [packages/sitemap/mod.test.ts](../packages/sitemap/mod.test.ts)
- [packages/concurrency/bounded.test.ts](../packages/concurrency/bounded.test.ts)
- [packages/capacity/mod.test.ts](../packages/capacity/mod.test.ts)

## crawl-processes

Bound waiting archive/browser work, exchange framed requests, and replace invalid native providers before retry.

Failure cases: Native process loss, output/frame limits, cancelled waiting work, and stale completion cannot leak
ownership or corrupt the result.

Ownership: Applications select adapters/launch arguments; generic process and pool capabilities own child/lease
disposal.

Proof level: Real Deno child replacement and native Node child/group tests plus deterministic coordination; no WACZ or
Chrome implementation claim.

Consumer source:

- `okikio/kaiju-crawl`: `packages/archive/src/wacz/process/pool.ts`
- `okikio/kaiju-crawl`: `packages/browser/src/process/pool.ts`
- `okikio/kaiju-crawl`: `packages/browser/src/lighthouse/process/client.ts`

Executable evidence:

- [tests/coordination.test.ts](../tests/coordination.test.ts)
- [tests/process-orchestration.test.ts](../tests/process-orchestration.test.ts)
- [packages/process/mod.test.ts](../packages/process/mod.test.ts)
- [packages/process/node.test.ts](../packages/process/node.test.ts)
- [packages/process/channel/mod.test.ts](../packages/process/channel/mod.test.ts)

## media-jobs

Run a downloadable or conversion job under one Task/context and acquire storage only when required.

Failure cases: Cancellation releases cooperative pauses; late acquisition closes; primary and cleanup failures both
remain observable.

Ownership: Task owns local execution cleanup; resource owns an acquired filesystem; progress/logging remain
observational application concerns.

Proof level: Generic lifetime/cleanup contracts exercised through the public API. Media codecs, remote resume, and
browser OPFS remain the consumer repos qualification.

Consumer source:

- `okikio/mediad`: `packages/media/download/download.ts`
- `okikio/mediad`: `packages/media/convert/convert.ts`
- `okikio/mediad`: `packages/media/storage/resource.ts`

Executable evidence:

- [packages/task/mod.test.ts](../packages/task/mod.test.ts)
- [packages/context/mod.test.ts](../packages/context/mod.test.ts)
- [packages/resource/mod.test.ts](../packages/resource/mod.test.ts)
- [packages/dispose/mod.test.ts](../packages/dispose/mod.test.ts)

## platform-services

Compile exact service definitions, validate request input, mount service routes, and reconstruct upstream trust
metadata.

Failure cases: Missing authority/handler coverage, failed readiness, malformed framing, untrusted headers, and
total-body timeout fail safely.

Ownership: Definitions import without acquisition; runtime owns request resources; host owns listeners, routing origins,
and logging configuration.

Proof level: Generic Fetch/Hono/gateway compositions and schema/query contracts; no PostgreSQL, deployed gateway, or
application identity integration claim.

Consumer source:

- `okikio/kaiju-platform`: `services/reports/definition.ts`
- `okikio/kaiju-platform`: `services/gateway/mod.ts`
- `okikio/kaiju-platform`: `packages/db/postgres/src/collection.ts`
- `okikio/kaiju-platform`: `packages/list/src/import.ts`

Executable evidence:

- [tests/host.test.ts](../tests/host.test.ts)
- [packages/server/service/compile.test.ts](../packages/server/service/compile.test.ts)
- [packages/server/service/runtime.test.ts](../packages/server/service/runtime.test.ts)
- [packages/server/gateway/mod.test.ts](../packages/server/gateway/mod.test.ts)
- [packages/hono/mod.test.ts](../packages/hono/mod.test.ts)

## signed-callback

Retain exact callback bytes, authenticate before JSON parsing, and lazily acquire optional signing material.

Failure cases: Invalid signatures, oversized bodies, cancelled reads, and missing provider configuration cannot invoke a
trusted handler.

Ownership: Request runtime owns the body; application supplies signing configuration and durable acceptance policy.

Proof level: Published webhook vector and generic raw-byte service scenario; no production callback delivery or database
commit claim.

Consumer source:

- `okikio/kaiju-platform`: `services/enrichment/endpoints/research/result.ts`

Executable evidence:

- [packages/http/webhook/mod.test.ts](../packages/http/webhook/mod.test.ts)
- [packages/server/service/runtime.test.ts](../packages/server/service/runtime.test.ts)
- [tests/provider.test.ts](../tests/provider.test.ts)

## provider-lazy

Describe capabilities and OpenAPI without opening optional providers; acquire only on a requiring operation.

Failure cases: Failed acquisition preserves unrelated routes and can be retried; stale values close if disposal wins.

Ownership: Definition creation borrows metadata only; acquired values transfer disposal to the collection.

Proof level: Independent provider double qualifies acquisition isolation; physical OPFS providers are qualified by their
own library.

Consumer source:

- `okikio/mediad`: `packages/media/storage/resource.ts`

Executable evidence:

- [tests/provider.test.ts](../tests/provider.test.ts)
- [packages/resource/mod.test.ts](../packages/resource/mod.test.ts)
- [tests/imports.test.ts](../tests/imports.test.ts)

## workflow-recovery

Run activities through Worker/process hosts, retain durable-shaped completions, replace scheduler/provider replicas, and
replay.

Failure cases: Expired claims, replaced host generations, lost worker/process execution, and changed fingerprints cannot
replace terminal authority.

Ownership: Scheduler/dispatch owns leases; provider owns host execution; external effect sink owns idempotent
acceptance.

Proof level: Core exposes the programming model, but no concrete deployed durable scheduler consumer was found.
Repository scenarios use real Worker/process hosts and an in-memory shared history/effect sink; they prove replica
recovery, not persisted crash recovery.

Consumer source:

- `okikio/Core`: `tools/intelligence-runtime/entry.ts`

Executable evidence:

- [tests/restartable-worker.test.ts](../tests/restartable-worker.test.ts)
- [tests/process-orchestration.test.ts](../tests/process-orchestration.test.ts)
- [tests/workflow.test.ts](../tests/workflow.test.ts)
- [packages/workflow/scheduler.test.ts](../packages/workflow/scheduler.test.ts)
- [packages/workflow/dispatch.test.ts](../packages/workflow/dispatch.test.ts)

## core-authority

Declare target-aware identity/billing requirements and project accepted measurements through explicit owner
capabilities.

Failure cases: Absent/malformed checker authority fails closed; duplicate definitions cannot silently merge unrelated
requirements.

Ownership: Applications own provider authorization and billing interpretation. Generic definitions remain import-safe
and meters announce facts only.

Proof level: Definition/batch/measurement composition tested with independent authority doubles; no live billing or
identity-provider policy claim.

Consumer source:

- `okikio/Core`: `packages/identity/core/src/service.ts`
- `okikio/Core`: `packages/identity/core/src/permissions.ts`
- `okikio/Core`: `packages/billing/core/src/meters.ts`
- `okikio/Core`: `packages/billing/core/src/entitlements.ts`

Executable evidence:

- [packages/permission/mod.test.ts](../packages/permission/mod.test.ts)
- [packages/requirement/mod.test.ts](../packages/requirement/mod.test.ts)
- [packages/entitlement/mod.test.ts](../packages/entitlement/mod.test.ts)
- [packages/meter/mod.test.ts](../packages/meter/mod.test.ts)

## repository-failures

Carry declared failures and bounded diagnostics across schema, provider, and observation boundaries.

Failure cases: Unsafe accessors, unknown identities, invalid nested data, reporter errors, and circular diagnostics
remain bounded without executing caller code.

Ownership: Live causes remain local; encoded data belongs to transports; reporter output is never terminal authority.

Proof level: Focused public contracts and generic lifecycle projections are strongest current evidence; no historical
deployment dependency is invented.

Consumer source:

- `okikio/utils`: `packages/failure/mod.ts`
- `okikio/utils`: `packages/fault/mod.ts`
- `okikio/utils`: `packages/codec/mod.ts`
- `okikio/utils`: `packages/telemetry/lifecycle.ts`

Executable evidence:

- [packages/failure/mod.test.ts](../packages/failure/mod.test.ts)
- [packages/fault/mod.test.ts](../packages/fault/mod.test.ts)
- [packages/codec/mod.test.ts](../packages/codec/mod.test.ts)
- [packages/telemetry/lifecycle.test.ts](../packages/telemetry/lifecycle.test.ts)
