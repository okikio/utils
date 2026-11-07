# @okikio/query

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

- [d1f378e](https://github.com/okikio/utils/commit/d1f378e49417fcda06cf6671281e1f0c1f2e669b) Compose filters with and, or, none, nor, nand, binary xor and xnor using the existing bounded expression representation. Preserve all/any aliases, URL encoding and SQL NULL semantics; document repeated exclusive leaf costs.
- [9db605a](https://github.com/okikio/utils/commit/9db605ab14a6b042425c2759da37e4a4ef79aca1) Introduced the first shared Okikio utility release, reconciling duplicate implementations and regression fixes from the
  existing Platform, Crawl, and MediaD utility trees into one maintained source.

### Patch changes

- [92873c6](https://github.com/okikio/utils/commit/92873c6e7182fce275a225701ed78d51122a90ac) Preserve authored AND groups and child order in encoded URLs. Return structured validation issues when implicit AND exceeds filter depth or sibling limits.
- Updated dependencies: @okikio/collection@1.0.0, @okikio/duration@0.1.0, @okikio/hash@0.1.0, @okikio/schema@1.0.0

