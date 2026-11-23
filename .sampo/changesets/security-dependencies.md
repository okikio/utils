---
npm/@okikio/telemetry: patch
npm/@okikio/hono: patch
npm/@okikio/schema: patch
npm/@okikio/env: patch
npm/@okikio/scheduler: patch
npm/@okikio/storage: patch
npm/@okikio/workflow: patch
---

Raise dependency floors past published advisories. Telemetry moves to OpenTelemetry 2.12.1 (the 0.223.2 experimental packages), which fixes unbounded W3C Baggage parsing in `@opentelemetry/core` (GHSA-8988-4f7v-96qf), and replaces the deprecated `@opentelemetry/sdk-trace-node` and `@opentelemetry/sdk-trace-base` with `@opentelemetry/sdk-trace`. Hono requires 4.13.19, past the `serveStatic`, `hono/jsx`, `csrf()`, `validator('form')`, RegExpRouter, `mount()` and `css` advisories. Zod requires 4.6.6 or later, past the unbounded array-issue allocation (GHSA-mrhx-c7xc-m3w5).
