---
npm/@okikio/sql: patch
npm/@okikio/storage: patch
npm/@okikio/utils: patch
---

Preserve every row in inserts that use only database defaults, including identity, generated and zero-column tables.
Generate valid table definitions for reserved or colliding binding names and catalog text containing comment terminators
or line breaks, while preserving the database identifiers and columns named `__proto__`. Custom types named
`constructor`, `__proto__` or `toString` keep their schema-qualified codecs instead of selecting inherited object
properties. Accept both supported Temporal constructor families.
The Drizzle adapter now uses update factories for inserts only when no database or application default exists.

PostgreSQL state saves explicitly select READ COMMITTED isolation through the generic database adapter. Competing
versioned saves return one successful replacement and one conflict even when the pool defaults to stronger isolation.
