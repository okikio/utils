# Release management

Bumpy owns release intent, semantic version propagation, individual package changelogs, version PRs, tags and GitHub
release notes. JSR remains the source-native registry. See [the release guide](../docs/maintenance/03-releases.md) for
the complete candidate and publication sequence.

Every user-facing focused package change needs a `.bumpy/*.md` note describing an outcome:

```md
---
'@okikio/format': patch
---

Preserve an explicit header row beyond the automatic discovery scan window.
```

Frontmatter keys name packages, such as `@okikio/format`; API subpaths such as `@okikio/format/csv` belong in the note
body. List each package once and retain the strongest bump when several subpaths change.

Use patch for a fix, minor for compatible capability and major for an intentional breaking change. `none` covers a
changed package without claiming a release-worthy behavior change. Focused changes cascade their versions into the
umbrella; the built-in formatter keeps each package's changelog independently owned.

`.bumpy/release.ts sync` copies Bumpy's package versions to the existing JSR version fields without rewriting JSONC. The
generated version PR workflow commits that synchronization. `check` verifies parity. `published` reads the exact JSR
version for Bumpy's retry check, and `publish` is reserved for the authorized release workflow.

npm build and package checks stage separate manifests under `.tmp/artifacts/npm`. These are tested candidates;
Bumpy's `skipNpmPublish` remains enabled. Canonical TypeScript source manifests must not be used as npm artifacts.
