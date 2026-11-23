---
npm/@okikio/telemetry: minor
npm/@okikio/context: patch
npm/@okikio/duration: patch
npm/@okikio/http: patch
npm/@okikio/scheduler: patch
npm/@okikio/server: patch
npm/@okikio/storage: patch
---

Move dependencies to their latest releases. Telemetry's optional OpenTelemetry packages move to the 3.1.1 stable line, the 0.301.2 exporters and API 1.10.0; callers that pass their own OpenTelemetry 2.x providers or exporters should upgrade them too. LogTape keeps its own OpenTelemetry logs tree. Duration uses `temporal-polyfill` 1.0.8, storage uses `postgres` 4.1.1, and the `@std/async` and `@std/http` floors move to 1.5.1 and 1.1.4.
