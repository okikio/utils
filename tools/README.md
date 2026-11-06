# Repository tools

Mise is the local and CI entry point. Its nine public workflows are configured in `mise.toml`.
`tools/workspace/run.ts` validates selectors and composes private operation recipes; those recipes
preserve host and permission contracts without creating another public task per operation.
Run `mise run test -- --help` for the command grammar and `mise run test -- --suite list` for test ownership.

| Owner                   | Programs and purpose                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.ts`                | Build emitted ESM/CommonJS, declarations and archives; install and test clean external consumers                                                                       |
| `sync-utils-exports.ts` | Generate or check umbrella forwarders against focused package export maps                                                                                                 |
| `packages/`             | Package structure, focused/umbrella bundles and browser-selected module graphs                                                                                            |
| `testing/`              | Deterministic test discovery, native-runtime execution, portable type profiles, real browser/installed consumers, runnable documentation and pinned Hono source inventory |
| `bench/`                | Competitor preparation, isolated measurement, report validation, balanced comparisons and native profiling                                                                |

Authored test scenarios remain beside their package or in `tests/`; focused benchmarks remain in `packages/*/`; composed
workloads live in `bench/`. Tools orchestrate those scenarios without inventing a second test implementation. Generated
outputs live under `.tmp/artifacts/`, and fixture data lives with the test that owns it. Bumpy's release integration remains
under `.bumpy/`.

Use `prepare`, `check`, `test`, `bench`, `build`, `verify`, `release`, `ci:plan`, and `ci:run`.
For example, `mise run bench -- --check --project streams --runtime bun` checks one package's
benchmark fixtures, while `mise run test -- --runtime node --project server` runs its source tests.
`--project` accepts a short name or `@okikio/name` and rejects unknown names. Type checking still
checks the full public inference graph; selecting a package does not weaken that contract.

Package `package.json` files own source exports and npm dependency ranges. Export generation
projects focused Deno exports, package command aliases, and umbrella bridges from those inputs.
Deno retains JSR-only aliases, compiler settings, and package permissions. The pnpm and Deno
locks describe different resolution graphs and both remain frozen in CI.

See [testing](../docs/maintenance/01-testing.md), [packaging](../docs/maintenance/02-packaging.md) and
[benchmarks](../docs/benchmarks/01-running.md) for commands, evidence and limits. JSR renders API reference
documentation from public source comments; longer explanations belong in `docs/`.

See [artifact ownership](../docs/maintenance/05-artifacts.md) for the tracked-source policy, current freeze preparation,
and location of preserved historical evidence. Fresh checkouts prepare generated benchmark inputs explicitly; checks
never depend on the old verification folder.
