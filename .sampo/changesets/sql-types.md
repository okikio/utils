---
npm/@okikio/sql: minor
---

New PostgreSQL types: `smallint` and `real`, `date` (`Temporal.PlainDate`), `time` (`Temporal.PlainTime`), `interval` (months, days and microseconds, each with its own sign), `bytea` (`Uint8Array`), one-dimensional `array(element)` and `composite(name, fields)` for existing composite types. Every type has a text form (`encode`), which arrays and composites build on, so their elements are as exact as single values under any `TimeZone`, `DateStyle`, `IntervalStyle` or `bytea_output`. `integer` and `smallint` refuse out-of-range values before sending. The types module is split into a folder by kind.
