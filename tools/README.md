# Maintain repository workflows

`@okikio/tools` is a private workspace package. It owns the programs used to inspect, build and test Utils, rather than
another set of library APIs. Mise is the local and CI entry point. Start with a task family and select the package or
runtime you need. For example, after changing how Streams releases a reader, run its tests on the runtime that exposed
the problem. Benchmark only after the tests establish the expected result. If you changed an exported path, check the
workspace first; use the export write operation when you intend to update the derived manifests and forwarders.

```sh
mise run check
mise run check -- --kind lint --project streams
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

`workspace/run.ts` checks options such as `--project`, then calls the matching task under `.mise/tasks/`.
Those shell tasks select the runtime, set its environment, and pass permissions. The TypeScript programs run the
steps. Mise chooses the pinned runtime versions and runs prerequisites first. Package scripts and Deno tasks
call the same task families.

`packages/exports.ts` reads each package's public paths, then checks or writes the matching Deno exports and
`@okikio/utils` re-exports. Only paths listed in a package manifest become public. Finding every `.ts` file
would also expose private code.

`packages/npm.ts` reads the same paths to build ESM JavaScript and TypeScript declarations with stable tsdown.
It keeps external dependencies separate. It packs npm archives and installs them into clean projects for testing.
For example, `tests/npm-consumer.mjs` runs the installed JavaScript without a TypeScript loader.

Tests remain next to their package; composed workflows remain in root `tests/`. Package benchmarks remain next to the
package, and cross-package measurements remain in root `bench/`. Tools select these programs without duplicating their
assertions. External-resource tests declare their database, browser or container needs; ordinary portable tests are
discovered automatically. Fixed upstream fixture inventories record provenance, not a second editable source tree.

The worker scan-retry test advances each runtime's native `node:test` timers through the complete twelve-attempt
policy. It checks both sides of every backoff delay, then verifies the terminal error and resource cleanup. A real
watchdog still detects a stuck worker. This checks the actual retry behavior without spending 7,240 milliseconds
waiting for time to pass on each runtime; service expiry tests keep their real clocks.

Repository-owned generated artifacts and execution evidence live in `.tmp/`. Existing evidence is preserved. Installed
consumers use isolated directories so this checkout's workspace dependencies cannot conceal a missing dependency.
These locations are internal test details, not application layout recommendations.

CI installs pinned tools with the official Mise action and caches pnpm downloads and Deno modules. `mise run check:actions`
runs the same workflow validation as CI (actionlint). `mise run actions .github/workflows/ci.yml --event workflow_dispatch`
runs one workflow locally with act, which needs Docker. Each job shows its setup directly. Restoring downloads does not skip tests, reuse an unverified build or imply a passing check. The release
workflow reuses exact tested artifacts at the same revision.

Successful work now writes the download cache explicitly. A read-only planner does not save a partially warmed
store before the test jobs can populate it. Cache identity includes the operating system, CPU architecture, actual
tool versions and native lockfiles; frozen installation still verifies dependencies after a restore. Every job runs on
GitHub's hosted `ubuntu-latest` runner. The local actions under `.github/actions/` own the dependency download cache,
the Deno compiler cache and native stack selection, so each workflow step names what it restores or saves.

Browser, installed-package and container jobs also restore native Playwright downloads. Keys include the installed
Playwright version, operating system release, architecture and selected browser set. Chromium has its own cache;
the existing package and container preparation share an all-browser cache. Each native installer still runs with
`--with-deps`, then each selected test runs against the current source. The cache does not contain Ubuntu packages,
browser profiles or test results. Successful trusted runs can save downloads under GitHub's ordinary ref scope;
PR cache writes cannot populate main or release caches. Cache failures fall back to normal installation.

Automatic PR checks keep source contracts on every layer. Chromium, benchmark correctness and example checks run
on ordinary PRs and the top of a native GitHub stack. The top compares its combined candidate with the ultimate
stack base. A PR that joins a native stack after its last push is reselected on its next push or a rerun. The planner reports
runtime, installed-package, PostgreSQL, container and documentation jobs as deferred
because their measured complete jobs exceeded the 120-second automatic budget. Formatting and lint feedback run
on main or manual requests. Main pushes retain all affected lanes, and dispatching CI runs all lanes on the selected
branch. This changes how often costly work runs; it does not establish that those tests became faster.

Benchmark correctness and copyable examples now share one hosted runner because neither needs PostgreSQL,
Chromium or a separate service. Mise installs the native toolchain and prepares the frozen package graph once.
The benchmark correctness step runs when selected; the copyable examples run on Deno, Node and Bun when selected.
The latter steps continue after a preceding failed check unless the job is cancelled. A failure in any selected step
fails the shared job. `Required checks` verifies the selected benchmark and example lanes against that one result;
it never considers a skipped or failed combined job successful.

Sharing setup may reduce billed seconds; it does not guarantee lower wall-clock time. Measure a successful hosted run
and check the repository's protected required check names before merging, because the individual
`Benchmark correctness` and `Copyable examples` job names become one combined status.

For complete checks before landing a stack, dispatch **CI** on its exact top branch. A lower layer reports its
expensive checks as deferred and skips the required aggregate. It does not certify a passing top. The selected top's
aggregate requires actual success from every selected lane and rejects missing, failed, cancelled or unexpectedly
skipped work. Before landing only a lower prefix, dispatch the complete checks on that prefix. Repository branch
rules must enforce the intended stack landing policy; this workflow does not change those rules.

Affected runtime checks use package manifests to include changed packages and their transitive runtime, peer,
optional and development consumers. Root compositions, tool tests, benchmarks and library comparisons remain in
the selection. Empty owner lists mean all packages. Full checks and release checks retain the complete runtime
matrix and the exact tested npm candidate handoff.

Tests and fixtures declare their cross-package imports as native development dependencies. The import-ownership
test parses the actual source and verifies that the planner retains each observed consumer, including type imports
and literal dynamic imports. Computed module addresses require a complete runtime selection. Git renames retain
both the old and new paths so moving a file cannot hide its previous package's consumers. These development edges
do not change the runtime dependency graph used to build or publish npm candidates.

The source, runtime and documentation cohorts also use the native Deno compiler cache (`.github/actions/deno-cache`). It stores only Deno's
module analysis, compiler databases and generated code, separately from dependency downloads. Deno still checks
current source and executes each selected command. Full CI and release checks reuse this state by default. Select
**fresh** when dispatching CI or Release to bypass compiler-state restore and save during a diagnostic run.
Selecting all checks and rebuilding compiler state are separate choices. This cache is neither a test-success
receipt nor a release artifact.

The lane result cache (`.github/actions/result-cache`) is the one test-success receipt. After every step of a lane
passes in a trusted run, the lane records a pass under a key built from the commit's tree hash, the lane and runtime,
its selected projects and the runner image release (its date, not its build number). A later run with the same key skips that lane's remaining steps and
prints a notice that links the run which passed. The tree hash covers every tracked file, including tests,
lockfiles, `mise.toml` and the workflows, and container images are pinned by digest, so a key changes whenever an
input can change. The commit message and the base commit are not inputs, so a rerun, a merge that leaves the tree
unchanged, or Release checking a commit that its main push already tested, runs nothing twice. Release still runs
the installed-package lane, because publication uses the npm candidates that lane builds. Only trusted refs record,
and a PR records only in its own merge-ref scope. **fresh** bypasses this cache as well, for example to retry a
suspected flaky test.

Automatic CI runs replace an older run for the same PR or branch. Ordinary manual CI uses the exact source SHA
as its concurrency identity, so an automatic PR update cannot interrupt a complete manual check. The single
pending slot coalesces ordinary requests with the same inputs; it does not skip a request already running or
reuse its test result. Each **fresh** attempt has its own identity and executes independently. Changeset checks
also restore and save the shared dependency download stores.

Read [testing](../docs/maintenance/01-testing.md), [packaging](../docs/maintenance/02-packaging.md),
[releases](../docs/maintenance/03-releases.md) and [artifact ownership](../docs/maintenance/05-artifacts.md) for the contracts
behind these commands. JSR renders API reference from public source comments; longer explanations belong in `docs/`.
