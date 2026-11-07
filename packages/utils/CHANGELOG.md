# @okikio/utils

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
- [9db605a](https://github.com/okikio/utils/commit/9db605ab14a6b042425c2759da37e4a4ef79aca1) Move entitlement checks to authz/entitlement, usage recording to capability/effect/meter, and codecs to schema/codec.
  Retire the three standalone packages and their old umbrella paths. Entitlement checks retain trusted definitions,
  ordered policy batches, denial errors, and limits from the Core scenario.
  
  Use env.define() and resource.document() instead of their redundant aliases. Share cancellation observation and snapshot
  validation across worker transports. See docs/maintenance/04-consolidation.md for migration steps and ownership limits.

### Patch changes

- Updated dependencies: @okikio/activity@1.0.0, @okikio/authz@0.1.0, @okikio/capability@1.0.0, @okikio/collection@1.0.0, @okikio/context@1.0.0, @okikio/dispose@0.1.0, @okikio/duration@0.1.0, @okikio/env@1.0.0, @okikio/format@1.0.0, @okikio/hash@0.1.0, @okikio/hono@0.1.0, @okikio/http@1.0.0, @okikio/input@1.0.0, @okikio/pool@0.1.0, @okikio/query@1.0.0, @okikio/result@1.0.0, @okikio/runtime@1.0.0, @okikio/scheduler@1.0.0, @okikio/schema@1.0.0, @okikio/server@1.0.0, @okikio/storage@1.0.0, @okikio/streams@0.1.0, @okikio/task@0.1.0, @okikio/telemetry@0.1.0, @okikio/worker@1.0.0, @okikio/workflow@1.0.0

