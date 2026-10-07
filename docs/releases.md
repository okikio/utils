# Releases

Deno source is canonical. Focused packages and the `@okikio/utils` umbrella publish to JSR. The npm projection is an
additional qualified artifact; automatic npm publication remains disabled until a deliberate publication decision.

## Release intent

Bumpy bump files in [`.bumpy/`](../.bumpy/) declare package-level semantic release intent. Use `none` when a changed
package is intentionally covered by a release check but does not need a version bump. Use patch, minor, or major when
the package's public behavior warrants it.

Bumpy's built-in formatter writes individual package changelogs and GitHub release notes. A focused package change can
cascade a matching version bump to the umbrella. There is no second implementation or custom umbrella changelog owner.

## Version authority

Bumpy writes `package.json` versions. JSR reads `deno.jsonc`. After Bumpy updates its generated version branch, the
release workflow runs `.bumpy/release.ts sync`, stages the corresponding JSR manifests, and amends that generated
commit. The synchronizer parses JSONC and replaces only the existing version value, preserving surrounding comments and
formatting.

`deno task release:versions` checks every package's registry name and version parity without changing files. The normal
verification pipeline includes that gate. Publication refuses mismatched registry names or versions.

## Candidate qualification

Before merging changes:

```sh
mise run release-check
mise run npm-verify
```

The first task runs source verification and Bumpy's strict change coverage check. The second builds separate npm staging
manifests, packs and extracts the actual artifacts, validates their metadata and declarations, installs them in a clean
consumer, executes both module formats, and checks selective consumer bundles. Source manifests remain unchanged.

A successful artifact check is not registry publication. Preserve the generated archive receipts when selecting exact
npm candidates for a later authorized publication. Do not publish canonical source `package.json` directly to npm: its
TypeScript export map describes the Deno source workspace rather than emitted npm JavaScript.

## JSR publication and retries

The custom Bumpy command invokes `.bumpy/release.ts publish` from the package directory. It checks the exact JSR version
before publishing. An immutable version already present on JSR is skipped, so Bumpy can complete missing tags after a
partial release. Other registry lookup failures stop publication instead of being treated as absent versions.

Bumpy may temporarily rewrite workspace ranges in `package.json` while publishing. The JSR source manifests remain the
source-native authority, and Deno performs the actual publication. The workflow verifies source and exact npm candidates
before reaching this external publication step. Local qualification never calls that step.
