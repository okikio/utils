# Releases

Deno source is canonical. Focused packages and the `@okikio/utils` umbrella publish to JSR; npm publication is disabled.

## Release intent

Bumpy bump files in [`.bumpy/`](../.bumpy/) declare package-level semantic release intent. Use `none` when a changed package is intentionally covered by a release check but does not need a version bump. Use patch, minor, or major only when the package's published contract warrants it.

Bumpy generates **individual package changelogs** and GitHub release notes. The umbrella may receive a cascaded version bump when focused packages change, but it does not aggregate leaf changelog prose through a custom formatter.

## Version PR

Bumpy versions `package.json` files and changelogs in its generated version PR. The release workflow then synchronizes each changed package version into that package's JSR `deno.json` or `deno.jsonc` manifest before finalizing the generated release commit. The synchronizer validates JSONC with `@std/jsonc` and preserves the existing manifest formatting.

## Publication

Bumpy invokes the JSR publish command from the package directory. The custom command first checks whether the exact JSR version already exists, so a partially completed release can be retried and Bumpy can repair a missing git tag without republishing an existing version.

Before merging ordinary changes:

```sh
mise run release-check
```

That runs repository verification plus Bumpy's strict change coverage check.
