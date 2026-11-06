# Package release intent

Add a changeset with the same change that needs a package release:

```sh
mise run release -- --operation add --project streams --bump patch --message 'Stop reading when the consumer cancels.'
mise run release -- --operation plan
```

Sampo reads `changesets/*.md`, selects dependent bumps, and writes changelogs during version preparation. Review the
plan before merging. Private tools and documentation-only edits do not require an invented package bump. Package names
in frontmatter include their ecosystem, for example `npm/@okikio/streams`.

See [the release guide](../docs/maintenance/03-releases.md) for version PRs, npm and JSR publication, external setup and
partial-release recovery. Do not edit generated versions independently in npm and Deno manifests.
