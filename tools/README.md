# Maintain repository workflows

`@okikio/tools` is a private workspace package. It owns the programs used to inspect, build and test Utils, rather than
another set of library APIs. Mise is the local and CI entry point. Start with a task family and select the package or
runtime you need. For example, after changing how Streams releases a reader, run its tests on the runtime that exposed
the problem. Benchmark only after the tests establish the expected result. If you changed an exported path, check the
workspace first; use the export write operation when you intend to update the derived manifests and forwarders.

```sh
mise run check
mise run test -- --project streams --runtime node
mise run test -- --project tools --runtime bun
mise run bench -- --check --project streams --runtime deno
mise run build -- --target exports --write
mise run release -- --operation plan
```

`--project` accepts a short name or `@okikio/name`. Test selection accepts repeated projects. Benchmark measurements
keep one project per report so a result has an unambiguous owner. Adding an ordinary package or test does not require
adding a new Mise task. `mise run test -- --help` explains selectors, and `mise run test -- --suite list` explains test
ownership. Choosing one package's tests does not narrow the workspace type check, which checks types that callers
receive across package boundaries.

```text
tools/
├── package.json        private npm workspace and direct dependencies
├── deno.jsonc          Deno workspace boundary and private imports
├── workspace/          task selection and affected-CI planning
├── packages/           source exports, npm projection and package contracts
├── releases/           npm-to-JSR version projection and GitHub release notes
├── testing/            test discovery, runtime adapters and installed consumers
└── bench/              fixture checks, measurements, comparisons and profiling
```

`workspace/run.ts` validates selectors and delegates to hidden `.mise/tasks/ops/` operations. Those shell entrypoints
establish the native tool, environment and permissions. TypeScript owns substantive orchestration. Mise owns pinned
runtimes and dependency order; package scripts and Deno tasks delegate to these same families.

`packages/exports.ts` projects the focused package export maps into Deno exports and umbrella forwarders. It has explicit
check and write modes. The public subpaths in package manifests are deliberate API decisions: discovering every `.ts`
file would expose private implementation details. `packages/npm.ts` uses those same maps to stage ESM artifacts with
stable tsdown, preserve external dependencies and build declarations. It packs real archives and tests clean consumers.
`tests/npm-consumer.mjs` deliberately runs JavaScript without a TypeScript loader.

Tests remain next to their package; composed workflows remain in root `tests/`. Package benchmarks remain next to the
package, and cross-package measurements remain in root `bench/`. Tools select these programs without duplicating their
assertions. External-resource tests declare their database, browser or container needs; ordinary portable tests are
discovered automatically. Fixed upstream fixture inventories record provenance, not a second editable source tree.

Repository-owned generated artifacts and execution evidence live in `.tmp/`. Existing evidence is preserved. Installed
consumers use isolated directories so this checkout's workspace dependencies cannot conceal a missing dependency.
These locations are internal test details, not application layout recommendations.

CI installs pinned tools with the official Mise action and caches pnpm downloads and Deno modules. Each job shows its
setup directly. Restoring downloads does not skip tests, reuse an unverified build or imply a passing check. The release
workflow reuses exact tested artifacts at the same revision.

Read [testing](../docs/maintenance/01-testing.md), [packaging](../docs/maintenance/02-packaging.md),
[releases](../docs/maintenance/03-releases.md) and [artifact ownership](../docs/maintenance/05-artifacts.md) for the contracts
behind these commands. JSR renders API reference from public source comments; longer explanations belong in `docs/`.
