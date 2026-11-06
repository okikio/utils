# Releases

Deno source is canonical. Focused packages and the `@okikio/utils` umbrella publish to JSR. The npm projection is an
additional tested artifact; automatic npm publication remains disabled until a deliberate publication decision.

## Release intent

Bumpy bump files in [`.bumpy/`](../../.bumpy) declare package-level semantic release intent. Use `none` when a changed
package is intentionally covered by a release check but does not need a version bump. Use patch, minor, or major when
the package's public behavior warrants it.

Bumpy's built-in formatter writes individual package changelogs and GitHub release notes. A focused package change can
cascade a matching version bump to the umbrella. There is no second implementation or custom umbrella changelog owner.

## Version authority

Bumpy writes `package.json` versions. JSR reads `deno.jsonc`. After Bumpy updates its generated version branch, the
release workflow runs `.bumpy/release.ts sync`, stages the corresponding JSR manifests, and amends that generated
commit. The synchronizer parses JSONC and replaces only the existing version value, preserving surrounding comments and
formatting.

`mise run check -- --kind versions` checks every package's registry name and version parity without changing files. The normal
verification pipeline includes that gate. Publication refuses mismatched registry names or versions.

## Candidate checks

Before merging changes:

```sh
mise run verify
mise run test -- --suite packages
UTILS_TEST_DATABASE_URL=postgres://fixture:fixture@127.0.0.1:5432/utils_test mise run test -- --suite postgres
mise run test -- --suite containers
mise run bench -- --check
mise run release -- --check
```

The source, npm, recovery, and benchmark tasks provide separate checks. The release task checks Bumpy's strict change
coverage without repeating source tests. The npm task builds separate staging manifests, packs and extracts the actual
artifacts, validates their metadata and declarations, installs them in a clean consumer, executes both module formats,
and checks selective consumer bundles. Source manifests remain unchanged.

### Required hosted checks

The release workflow's `tested` job calls [the shared quality workflow](../../.github/workflows/quality.yml) after
`plan` selects `publish`. That workflow runs the same source, Deno/Node/Bun, browser, installed-package, PostgreSQL,
container and benchmark-correctness checks as ordinary CI. It receives only `contents: read`, without inherited
publication secrets. The version-PR path keeps its own permissions and does not run this publication-only gate.

Both the local reusable-workflow reference and each quality checkout select the caller's commit. The `publish` job
requires successful `plan` and `tested` jobs, then explicitly checks out that same `github.sha`. Failure,
cancellation or a skipped check blocks publication. The publish job retains `mise run verify` and
`mise run test -- --suite packages` so its exact local candidates are checked again before invoking the publication command.
Write/OIDC permissions remain confined to the publish job.

This dependency is part of the workflow itself; it does not depend on a separate CI run finishing first. GitHub
documents the
[same-commit behavior of local reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
and the
[successful-dependency requirement of `needs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds).

A successful artifact check is not registry publication. Preserve the generated archive receipts when selecting exact
npm candidates for a later authorized publication. Do not publish canonical source `package.json` directly to npm: its
TypeScript export map describes the Deno source workspace rather than emitted npm JavaScript.

## JSR publication and retries

The custom Bumpy command invokes `.bumpy/release.ts publish` from the package directory. It checks the exact JSR version
before publishing. An immutable version already present on JSR is skipped, so Bumpy can complete missing tags after a
partial release. Other registry lookup failures stop publication instead of being treated as absent versions.

Bumpy may temporarily rewrite workspace ranges in `package.json` while publishing. The JSR source manifests remain the
source-native authority, and Deno performs the actual publication. The workflow verifies source and exact npm candidates
before reaching this external publication step. Local checks never call that step.
