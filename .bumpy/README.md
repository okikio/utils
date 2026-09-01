# Release management

Bumpy owns release intent, semantic version propagation, package changelogs, the version PR, git tags, and GitHub release notes. JSR remains the registry authority and is invoked through an explicit custom publish command.

## Add a release note

Every user-facing package change needs a `.bumpy/*.md` file. Describe the outcome for the package user, not the implementation activity.

```md
---
'@okikio/csv': patch
---

Preserve an explicit header row even when it lies beyond the automatic discovery scan window.
```

Use `minor` for backward-compatible capability, `patch` for fixes, and `major` for breaking changes. Use Bumpy's `none` or `$changelog: false` forms for changes that intentionally do not belong in public release history.

Do not normally add `@okikio/utils` when a leaf package changes. Each focused package cascades its bump into the umbrella with matching severity and its changelog formatter aggregates the leaf summaries automatically.

## Version authority

Bumpy writes `package.json` versions. JSR reads `deno.json[c]` versions. `.bumpy/sync-deno-versions.mjs` copies Bumpy's exact version into the JSR manifest without rewriting JSONC comments.

The release workflow amends the generated version commit after this synchronization. Publishing refuses a package whose two versions differ.

## Registry safety

Every package keeps `package.json.private = true`, so an accidental `npm publish` is blocked. Bumpy still manages private package versions and invokes `.bumpy/publish-jsr.mjs` explicitly. Deno/JSR ignores the npm `private` flag.

The publish wrapper also reverses Bumpy's temporary `workspace:` rewrite before `deno publish`, keeping the published source and git tag aligned. Bumpy checks JSR registry metadata before publishing, so a retry after a partial release skips immutable versions that already exist even if a prior job failed before pushing their git tags.
