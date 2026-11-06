---
'@okikio/activity': major
'@okikio/authz': patch
'@okikio/capability': major
'@okikio/collection': major
'@okikio/context': major
'@okikio/dispose': patch
'@okikio/duration': minor
'@okikio/env': patch
'@okikio/format': major
'@okikio/http': major
'@okikio/input': major
'@okikio/pool': patch
'@okikio/query': major
'@okikio/result': major
'@okikio/runtime': major
'@okikio/scheduler': major
'@okikio/schema': major
'@okikio/server': major
'@okikio/storage': major
'@okikio/streams': minor
'@okikio/task': minor
'@okikio/telemetry': minor
'@okikio/utils': major
'@okikio/worker': major
'@okikio/workflow': major
---

Consolidate 37 utility packages into 27 with shared contracts and explicit subpaths. Capability owns effects,
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
