# Maintain repository workflows

`@okikio/tools` is the private workspace package that builds and checks Utils. A contributor chooses an owner through
native package filtering, then runs that owner's declared command. Mise selects pinned tools and composes repository
checks, resource fixtures and release operations. There is no separate package-selector or task-dispatch language.

After changing how Streams releases a reader, start with its own check and the runtime that exposed the problem:

```sh
mise run prepare
pnpm --filter ./packages/streams --fail-if-no-match run check
pnpm --filter ./packages/streams --fail-if-no-match run test:node
pnpm --filter ./packages/streams --fail-if-no-match run bench:check
pnpm --filter @okikio/tools --fail-if-no-match run test:bun
mise run check:lint -- packages/streams
mise run build:exports
mise run release
```

Package names are optional selectors. pnpm also accepts paths, globs, dependencies and dependents. For example,
`pnpm --filter '@okikio/server...' --fail-if-no-match --no-sort run check` checks Server and its workspace dependencies.
`pnpm --filter '...{./packages/http}' --fail-if-no-match --no-sort run check` checks HTTP and its workspace consumers.
The source checks consume the available source graph and do not emit prerequisites for another package. `--no-sort`
therefore allows deliberate cycles introduced by test consumers without deleting those dependency declarations.

Each public `package.json` owns `check`, `test`, `test:deno`, `test:node`, `test:bun`, `build`, `bench` and `bench:check`.
The generator copies those commands into `deno.jsonc`; it does not replace a local check with the root aggregate.
`deno task --cwd packages/http check` uses the same owner. Deno's named `--filter` can exit successfully with no matching
task, and recursive pnpm `run` can skip a missing script when another selected member has it. CI validates task
declarations with `check:packages`, then uses `pnpm --filter <selector> --fail-if-no-match --no-sort -r exec pnpm run <task>`
so every selected owner must execute its required script. CI also sets `verifyDepsBeforeRun=error`; dependency preparation
owns installation. A real task failure remains a failure in both runtimes. Member Deno checks, including the private tools owner, supplement the complete
repository TypeScript-native check. A selected package without an authored benchmark fails explicitly instead of
reporting an empty measurement as success.

| Owner | Responsibility |
| --- | --- |
| `tools/package.json`, `tools/deno.jsonc` | Private tooling dependencies, imports and native tasks. |
| `tools/workspace/ci/plan.ts` | Exact Git changes and resource-lane policy; pnpm supplies dependency reachability. |
| `tools/workspace/ci/execute.ts` | Execute an admitted CI lane through native package commands and Mise resource tasks. |
| `tools/workspace/ci/result.ts` | Require successful results for the exact selected candidate and lanes. |
| `tools/packages/` | Source metadata, Deno/umbrella projections, npm ESM/declarations and installed artifacts. |
| `tools/releases/` | Sampo planning, npm-to-JSR version projection and validated publication. |
| `tools/testing/` | Native test-file discovery, host/resource admission and actual execution receipts. |
| `tools/bench/` | Fixture correctness, retained measurements, comparisons and profiling. |

The small `packages/source.ts` adapter reads pnpm's JSON listing. It validates the returned identities and selects public
source owners from that result, including nested packages and excluding private manifests. It does not crawl the workspace
or rebuild dependency traversal. `packages/exports.ts`
then reads the selected manifests and projects only declared public paths and scripts. Private source files never become
exports merely because a file finder saw them. `packages/npm.ts` builds ESM and declarations, strips repository scripts
from distribution manifests, packs archives and tests clean installed consumers. Rebuilding a selected package removes
only that package's generated stage, including temporary files left by an interrupted build.

`testing/run.ts` remains because tests have real host and resource contracts. Native file globs find authored tests;
the owner classifies Node, Deno, Web Worker, PostgreSQL and container requirements, launches the actual runtime and
retains its output and exit status. A package task passes its working directory. CI also retains root compositions,
tool tests and comparisons after selecting affected packages. Use `mise run test:list` to inspect ownership. Database
and container tasks fail when their required environment is absent; they do not become successful empty suites.

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

`pnpm` owns the installed workspace dependencies. When manifest membership changes, update Deno's resolution with
`deno install --lockfile-only --frozen=false`, inspect the lock diff, then keep ordinary checks frozen. A plain
`deno install` can replace pnpm-owned optional dependency links even with the workspace's manual module setting;
use `pnpm install --frozen-lockfile` to restore the declared installed graph after such an invocation.

CI installs pinned tools with the official Mise action and caches pnpm downloads and Deno modules. Check tools are lazy
in `mise.toml`, so each one downloads the first time its task runs. The source lane runs these repository checks:

- `check:actions` runs jactionlint, zizmor and pinact on the workflows and local actions. zizmor and pinact use their
  online audits only in GitHub Actions; local runs stay offline.
- `check:shell` runs shellcheck on every shell script, and `check:tasks` validates the Mise task graph.
- `check:secrets` runs gitleaks on the Git history. Each exception in `.gitleaksignore` is one exact fingerprint with a
  comment that says why it is not a secret. Never allow a whole file or a whole rule.

`check:security` runs `deno audit` and osv-scanner in the advisory lane. Advisory databases change without a commit,
so this check never reuses an earlier pass. An exception goes in `osv-scanner.toml` with a reason and an `ignoreUntil`
date, and the check fails when an exception has expired. `mise run actions .github/workflows/ci.yml --event workflow_dispatch`
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

Every job has a 10-minute limit. Ordinary PRs and the top of a native GitHub stack run every affected lane; the top
compares its combined candidate with the ultimate stack base. Lower stack layers run only the source checks. A PR
that joins a native stack after its last push is reselected on its next push or a rerun. Formatting and lint
feedback run on main or manual requests. Dispatching CI runs all lanes on the selected branch.

Three changes keep the long lanes inside the limit:

- **Shards.** The PostgreSQL and container suites run one test file at a time, so CI splits their files across
  parallel jobs: two for PostgreSQL and three for containers (`--shard <index>/<total>`). Files are sorted by path
  and dealt in turn, so each file runs in exactly one shard. Only the container shard that runs a browser test
  installs the Playwright engines.
- **Images.** `tests/fixtures/images.ts` pins every image the tests start, including the testcontainers Ryuk
  sidecar. The container and PostgreSQL jobs load them from one Actions cache entry keyed by that file, and pull
  only what the archive did not restore (`.github/actions/image-cache`). The PostgreSQL job starts its database
  from that image after the result cache check, so a job whose inputs already passed pulls and starts nothing.
- **Documentation.** The README example check runs one document per CPU core. Each document keeps its own
  temporary directory and runs its examples in order.

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

A push to `main` selects work changed since the last commit whose CI passed, not since the previous push.
`tools/workspace/evidence.ts baseline` reads the passing main-push runs and takes the newest one whose commit is an
ancestor of the pushed commit. So when one push fails, the next push still selects the failed changes, until a run
passes. When there is no such commit, or GitHub cannot be read, the plan selects all work. This baseline and the
result cache answer two different questions. The baseline decides what a push must check. The result cache skips a
selected lane whose exact inputs already passed.

Automatic CI runs replace an older run for the same PR or branch. Ordinary manual CI uses the exact source SHA
as its concurrency identity, so an automatic PR update cannot interrupt a complete manual check. The single
pending slot coalesces ordinary requests with the same inputs; it does not skip a request already running or
reuse its test result. Each **fresh** attempt has its own identity and executes independently. Changeset checks
also restore and save the shared dependency download stores.

Read [testing](../docs/maintenance/01-testing.md), [packaging](../docs/maintenance/02-packaging.md),
[releases](../docs/maintenance/03-releases.md) and [artifact ownership](../docs/maintenance/05-artifacts.md) for the contracts
behind these commands. JSR renders API reference from public source comments; longer explanations belong in `docs/`.
