# @okikio/scheduler

## 1.0.0 — 2026-11-07

### Major changes

- [9db605a](https://github.com/okikio/utils/commit/9db605ab14a6b042425c2759da37e4a4ef79aca1) Consolidate 37 utility packages into 27 with shared contracts and explicit subpaths. Capability owns effects,
  requirements, resilience and resources; Collection owns catalogs and records; Scheduler owns capacity, concurrency and
  queues. Result owns failure and fault APIs. Format owns CSV and Sitemap. Runtime replaces Deno, Storage replaces
  Postgres, and Worker owns thread and process protocols. Consumers must update package dependencies and imports.
  
  Use native Schema builders and explicit codecs for application-to-wire conversions across failures, effects, workflows,
  HTTP and storage. Keep Zod as an optional adapter. Preserve exact catalog selections and truthful record enumeration.
  Expand Input for structural browser mocks and native browser types. Support richer duration inputs and explicit clock
  ownership.
  
  Add bounded PostgreSQL queues with shared admission, deduplication, leased claims, expiry fencing, retry and retention.
  Join cancellation and cleanup work, roll back failed codec operations, preserve stream cleanup outcomes, and retain
  progress and instrumentation without giving observers authority over completed work.

### Minor changes

- [9db605a](https://github.com/okikio/utils/commit/9db605ab14a6b042425c2759da37e4a4ef79aca1) Introduced the first shared Okikio utility release, reconciling duplicate implementations and regression fixes from the
  existing Platform, Crawl, and MediaD utility trees into one maintained source.

### Patch changes

- [9db605a](https://github.com/okikio/utils/commit/9db605ab14a6b042425c2759da37e4a4ef79aca1) Bounded queue, ordered mapping, and unordered mapping now retain the exact first mapper failure after cancelling and
  joining admitted siblings. A mapper that throws `undefined` previously rejected with the native abort `DOMException`; it
  now rejects with `undefined`. Null, string, object, and Error failures retain their original values and identity. No
  caller API changes are required.
  
  Ordered mapping now joins admitted work even when closing the input iterator fails. When operation and source cleanup
  both fail, an `AggregateError` retains both values in that order and keeps the operation failure as its `cause`. A
  source cleanup failure alone is rethrown unchanged.
- Updated dependencies: @okikio/collection@1.0.0, @okikio/context@1.0.0, @okikio/duration@0.1.0, @okikio/result@1.0.0, @okikio/schema@1.0.0, @okikio/telemetry@0.1.0

