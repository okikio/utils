# Releases and changelogs

The workspace uses one release declaration as the source for semantic versions, package changelogs, the `@okikio/utils` aggregate history, git tags, and GitHub release notes.

## Change flow

```text
package behavior changes
        |
        v
.bumpy/<change>.md
        |
        +--> leaf semantic version
        +--> dependent version propagation
        +--> leaf CHANGELOG.md
        `--> @okikio/utils aggregate CHANGELOG.md
                    |
                    v
             version PR
                    |
         sync deno.json[c] version
                    |
                    v
             JSR publication
                    |
          package@version git tag
```

Bumpy 1.18.1 is pinned because the release behavior depends on its current bump-file, dependency propagation, formatter, version-PR, and custom-publish contracts.

## Changelog policy

A changelog entry answers what changed for the package user and why it matters. It does not reproduce commit history. Prefer one coherent outcome per bump file. Include migration or configuration steps when a release requires them.

Leaf packages receive only bump-file summaries that directly apply to them. `@okikio/utils` is the single-install release digest: when leaf releases propagate into the umbrella, its formatter includes the actual contributing leaf summaries rather than a list of opaque "updated dependency" lines.

Bumpy's file-level `$changelog: false` and package-level `changelog: false` controls are preserved for internal changes that need a version but should not appear in public notes.

## Initial release

The repository starts at `0.0.0` with one pending `minor` declaration for each focused utility. The first version PR therefore creates `0.1.0` changelogs through the same mechanism future releases use. The umbrella reaches `0.1.0` through the focused-package cascade rule.

## JSR-only publication

Package `package.json` manifests remain private. They exist for Node-compatible tooling, workspace dependency discovery, and Bumpy's version graph; they are not npm publication manifests.

JSR package identity and exports live in `deno.json[c]`. The publish wrapper validates version parity and runs:

```sh
deno publish --check=all
```

Before publishing, Bumpy calls `.bumpy/check-jsr-published.mjs`, which reads JSR package metadata and treats any exact existing version—including a yanked version—as already published. This makes partial-release retries registry-idempotent rather than tag-dependent.

A publish job must have GitHub OIDC `id-token: write` permission for JSR trusted publishing.
