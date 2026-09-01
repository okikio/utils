# Package inventory

| Package | Internal dependencies |
| --- | --- |
| `@okikio/activity` | `@okikio/catalog`, `@okikio/context`, `@okikio/effect`, `@okikio/failure`, `@okikio/fault`, `@okikio/permission`, `@okikio/pool`, `@okikio/process`, `@okikio/requirement`, `@okikio/resilience`, `@okikio/resource`, `@okikio/result`, `@okikio/schema`, `@okikio/worker`, `@okikio/workflow` |
| `@okikio/capacity` | `@okikio/record`, `@okikio/schema` |
| `@okikio/catalog` | `@okikio/fault` |
| `@okikio/codec` | `@okikio/record`, `@okikio/schema` |
| `@okikio/concurrency` | None |
| `@okikio/context` | `@okikio/dispose` |
| `@okikio/css` | None |
| `@okikio/csv` | `@okikio/record` |
| `@okikio/deno` | `@okikio/context` |
| `@okikio/dispose` | None |
| `@okikio/duration` | None |
| `@okikio/effect` | `@okikio/catalog`, `@okikio/context`, `@okikio/schema`, `@okikio/queue` |
| `@okikio/email` | `@okikio/csv` |
| `@okikio/entitlement` | `@okikio/catalog`, `@okikio/requirement` |
| `@okikio/env` | `@okikio/fault`, `@okikio/record` |
| `@okikio/failure` | `@okikio/catalog`, `@okikio/schema` |
| `@okikio/fault` | `@okikio/record` |
| `@okikio/hash` | None |
| `@okikio/hono` | `@okikio/server` |
| `@okikio/html` | None |
| `@okikio/http` | `@okikio/catalog`, `@okikio/record` |
| `@okikio/meter` | `@okikio/catalog`, `@okikio/effect` |
| `@okikio/permission` | `@okikio/catalog`, `@okikio/requirement`, `@okikio/context`, `@okikio/schema` |
| `@okikio/pool` | `@okikio/observables`, `@okikio/context` |
| `@okikio/process` | `@okikio/observables`, `@okikio/context`, `@okikio/failure`, `@okikio/fault`, `@okikio/schema` |
| `@okikio/query` | `@okikio/record` |
| `@okikio/queue` | `@okikio/observables`, `@okikio/context`, `@okikio/failure` |
| `@okikio/record` | None |
| `@okikio/requirement` | `@okikio/catalog`, `@okikio/context` |
| `@okikio/resilience` | None |
| `@okikio/resource` | `@okikio/catalog`, `@okikio/context`, `@okikio/dispose`, `@okikio/env`, `@okikio/record`, `@okikio/requirement` |
| `@okikio/result` | None |
| `@okikio/robots` | None |
| `@okikio/schema` | None |
| `@okikio/server` | `@okikio/catalog`, `@okikio/context`, `@okikio/env`, `@okikio/http`, `@okikio/query`, `@okikio/record`, `@okikio/requirement`, `@okikio/resilience`, `@okikio/resource`, `@okikio/workflow`, `@okikio/fault` |
| `@okikio/sitemap` | None |
| `@okikio/streams` | None |
| `@okikio/task` | `@okikio/context`, `@okikio/dispose`, `@okikio/requirement`, `@okikio/resource` |
| `@okikio/version` | None |
| `@okikio/worker` | `@okikio/observables`, `@okikio/context`, `@okikio/failure`, `@okikio/fault`, `@okikio/schema` |
| `@okikio/workflow` | `@okikio/catalog`, `@okikio/context`, `@okikio/dispose`, `@okikio/effect`, `@okikio/failure`, `@okikio/fault`, `@okikio/queue`, `@okikio/requirement`, `@okikio/resilience`, `@okikio/result`, `@okikio/schema`, `@okikio/record` |
| `@okikio/utils` | All focused packages |
