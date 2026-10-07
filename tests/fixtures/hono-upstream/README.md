# Pinned Hono test source

This corpus retains original test and test-input bytes from Hono 4.13.5, commit
`06880c4a2b04de9dd74217f26dd831209b9c01f1`, under Hono's MIT license. The complete source selection includes `.test.ts`,
`.test.tsx`, and `.test.json`; their retained names end in `.test.txt`. Preserve these bytes instead of formatting them.

Read [the coverage guide](../../../docs/hono-coverage.md) for the complete ledger, executable translations, and
remaining contract candidates. `manifest.json` owns source hashes. `inventory.json` derives syntax sites, assertion and
callback spans, input candidates, shared setup, and exact links to local executable tests. Registration-site counts are
not expanded test counts or execution receipts.

Recreate the corpus with `tools/hono-inventory.ts capture <pinned-checkout>`. After executable mappings change, run
`write`, then `check`. The source's relative imports, fixture helpers, Vitest environment, provider bindings and JSX
setup are preserved as text. This directory is not a runnable copy of Hono's complete repository.
