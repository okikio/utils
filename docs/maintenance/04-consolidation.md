# Consolidate capability ownership

Entitlement checks moved to Authz, effect meters moved to Capability, and codecs moved to Schema. Update the
import paths in your code and the dependency names in your manifests. The old packages no longer provide
compatibility imports.

| Former import         | Current import                    | Dependency           |
| --------------------- | --------------------------------- | -------------------- |
| `@okikio/entitlement` | `@okikio/authz/entitlement`       | `@okikio/authz`      |
| `@okikio/meter`       | `@okikio/capability/effect/meter` | `@okikio/capability` |
| `@okikio/codec`       | `@okikio/schema/codec`            | `@okikio/schema`     |

The matching `@okikio/utils/authz/entitlement`, `@okikio/utils/capability/effect/meter`, and
`@okikio/utils/schema/codec` paths forward those same implementations. Their `types` subpaths move with them. Existing
meter IDs and effect IDs retain their meaning. Codec decode and encode types stay independent.

Entitlements remain different from member permissions. Core's richer entitlement contracts informed the trusted
definitions, requirement catalogs, checker batching, denial errors, and limits now available here. This repository
contains the generic mechanism. Application plan policy and persistence remain outside it. Core, Intelligence, and
Signals have not been migrated by this change.

Use `env.define()` to create environment definitions. The redundant `env.environment()` spelling is removed, including
from the Zod and Valibot adapters. Use `resource.document()`; its `manifest` alias is removed. Environment manifests
remain `env.manifest()` because that operation projects deployment metadata and is not the removed resource alias.
Catalog facades remain where they preserve definition types, literal IDs, selected keys, or useful domain vocabulary.

## Keep observation separate from control

Context now owns `isSnapshot()` and `observe(signal, promise)`. Process channels and Worker transports use those
contracts. `observe()` stops waiting when cancelled and rejects with the exact signal reason. It removes its listener
and consumes late rejection. It does not stop the underlying validator or wait for that validator's cleanup. `waitFor()`
remains a different operation for registered callbacks and cooperative checkpoints.

Effect and Failure use `record.is()` to inspect inert envelopes, then validate their different required fields. HTTP
forwarding and response-header configuration use one dense string-list snapshot. That operation permits prefixes; it is
not header-name validation. Environment adapters share normalization and secret-example rules, while each adapter
retains its schema metadata reader and its own identity cache.

## Retain Task for the behavior it supplies

Task controls one local operation: cooperative pause/resume, cancellation, joined cleanup, and progress observation.
Workflow now imports its standard `ProgressEffect`. The executable Task examples and tests demonstrate pause and resume
at checkpoints. Removing it would remove that behavior, rather than just a package boundary. Durable workflows do not
need a second Task scheduler. Their saved jobs and retry policy remain authoritative.

The older review found little direct Task usage in application copies. That does not justify deleting a now-used
standalone capability or modifying application repositories during this consolidation. A later application migration can
remove unused copies after tracing its actual imports.

## Migrate deliberately

Run the portable tests and Deno tests for the moved capabilities. Run package/export checks and README examples. Worker
and process-channel tests protect cancellation and transport behavior. Basic schema imports must not pull in codecs;
static entitlement declarations must not pull in checker execution. These are import-graph checks, not claims of
measured bundle-size or startup improvements.

No billing accounting behavior, external entitlement wiring, or copied application deployment is proven merely by moving
these modules. Verify those flows when migrating their owners.
