---
'npm/@okikio/activity': major
'npm/@okikio/authz': patch
'npm/@okikio/capability': major
'npm/@okikio/collection': major
'npm/@okikio/context': major
'npm/@okikio/dispose': patch
'npm/@okikio/duration': minor
'npm/@okikio/env': patch
'npm/@okikio/format': major
'npm/@okikio/http': major
'npm/@okikio/input': major
'npm/@okikio/pool': patch
'npm/@okikio/query': major
'npm/@okikio/result': major
'npm/@okikio/runtime': major
'npm/@okikio/scheduler': major
'npm/@okikio/schema': major
'npm/@okikio/server': major
'npm/@okikio/storage': major
'npm/@okikio/streams': minor
'npm/@okikio/task': minor
'npm/@okikio/telemetry': minor
'npm/@okikio/utils': major
'npm/@okikio/worker': major
'npm/@okikio/workflow': major
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
