---
'@okikio/authz': minor
'@okikio/capability': major
'@okikio/schema': minor
'@okikio/context': minor
'@okikio/http': minor
'@okikio/env': major
'@okikio/utils': major
---

Move entitlement checks to authz/entitlement, usage recording to capability/effect/meter, and codecs to schema/codec.
Retire the three standalone packages and their old umbrella paths. Entitlement checks retain trusted definitions,
ordered policy batches, denial errors, and limits from the Core scenario.

Use env.define() and resource.document() instead of their redundant aliases. Share cancellation observation and snapshot
validation across worker transports. See docs/maintenance/04-consolidation.md for migration steps and ownership limits.
