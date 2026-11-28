# Use shared guidance in Utils

Start with the [repository rules](../AGENTS.md), [programming model](../README.md) and
[workflow owner](../tools/README.md). Use [START.md](START.md) to select a capability and
[GUIDANCE.md](GUIDANCE.md) to understand the roles of skills, guides, references, the playbook and the handbook.
This directory adopts the complete connected collection from [okikio/skills](https://github.com/okikio/skills).

## Bind the method to this repository

Utils supplies focused public libraries and the `@okikio/utils` umbrella. Start with the caller's operation,
then inspect the owning package, its public exports and the composed workflows that consume it.

| Project contract | Current owner |
| --- | --- |
| Package behavior and public API | `packages/<name>/README.md`, source and `package.json`; start at [the package directory](../docs/01-packages.md) |
| Runtime and dependency versions | [mise.toml](../mise.toml), package manifests, `deno.lock` and `pnpm-lock.yaml` |
| Source, exports and release ownership | [repository rules](../AGENTS.md) and [release procedure](../docs/maintenance/03-releases.md) |
| Checks, tests, build output and temporary evidence | [tools/README.md](../tools/README.md), `.mise/tasks/`, `tools/` and `.tmp/` |
| Active work and publication authority | The current request, actual Git branch and revision, working changes and relevant PR |

The current package determines its supported hosts and resource ownership. Select browser, worker, database and
container checks when the changed contract requires them. Examples in this collection do not select a framework,
provider or runtime for a package. The project-specific rules and commands above govern implementation.

Use `build-libraries` for public contracts, `build-devtools` for repository tooling and `deno-software` for Deno or JSR
decisions. Add the relevant domain owner, such as `build-data` or `build-apis`, when its decisions change. A `use-utils`
reference helps locate an API; inspect current source and the exact installed release before relying on that API.

## Choose a command for the changed contract

Run these commands from the repository root. Mise owns the pinned tools and native task prerequisites.

| Purpose | Existing command |
| --- | --- |
| Inspect test ownership and external prerequisites | `mise run test:list` |
| Test one package on a selected runtime | `pnpm --filter ./packages/sql --fail-if-no-match run test:node` |
| Check workspace types | `mise run check:types` |
| Check one package's formatting or lint | `mise run check:format -- packages/sql` or `mise run check:lint -- packages/sql` |
| Check the complete repository | `mise run check` |
| Build, pack and exercise installed consumers, including the browser artifact | `mise run test:packages` |
| Inspect source publication without uploading | `mise run check:jsr` |

Replace `sql` with the affected package and select the required Deno, Node or Bun runtime. Native pnpm filters accept
package names, paths and dependency relations; Deno supports `deno task --cwd=packages/sql check`. A member check follows
that member's source graph. `mise run check:types` separately checks the full workspace and its inference fixtures.
Read test ownership before starting external services. Record actual results and
missing prerequisites separately; source, installed-artifact and browser checks support different claims.

## Keep the collection reproducible

[source.json](source.json) records the upstream commit, copied paths, sizes and SHA-256 values. It covers `START.md`,
`GUIDANCE.md`, `LICENSE`, `guides/`, `references/`, `skills/` and `handbook/`. This local profile and provenance record
belong to Utils. Change reusable guidance in its upstream owner, then refresh the connected collection and manifest
from a verified commit. Compare the old manifest before removing retired files and preserve other local agent work.

Run the collection's `deno task check`, `deno task validate`, `deno task test` and `deno task bundle` in an upstream
skills checkout. Those maintenance commands are not Utils tasks. Check copied hashes and links, review the local
profile, and exercise a fresh task through `AGENTS.md` and `START.md` after an update. Copied examples retain upstream
formatting and validation ownership; local agent programs keep the repository's checks.

The guidance is development material outside package build and publication inputs. Inspect the actual npm archives
and JSR dry-run output when those inputs change. Keep project observations and temporary evidence in their existing
owners, separate from the copied reusable methods.
