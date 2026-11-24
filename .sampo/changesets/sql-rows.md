---
npm/@okikio/sql: patch
npm/@okikio/utils: patch
---

Insert and update rows leave out columns marked `.computed()` or `.identity()` and reject unknown keys, so these mistakes fail to type-check instead of failing when the statement is built.
