# Work on Utils

Read [README.md](README.md) for the programming model and [tools/README.md](tools/README.md) for repository workflows.
Before editing a package, read its README, public export map, nearby tests and the matching guide linked from [the package directory](docs/01-packages.md).
Guides may be single files or topic folders; use that directory rather than guessing a path.
Explain behavior for a reader who knows a basic JavaScript Hello World example. Do not assume protocol or scheduling
knowledge. Document important private invariants and examples as carefully as public APIs.

## Ownership and commands

- `packages/<name>/` owns a utility, its unit tests and focused benchmarks. Root `tests/` and `bench/` own composed workflows.
- Package `package.json` owns source exports, identity, version and npm ranges. Deno manifests own source publication,
  JSR imports and runtime settings. `tools/packages/exports.ts` checks or projects the shared export decisions.
- Mise owns pinned tools and task families. Use `mise run test -- --project <name> --runtime <deno|node|bun>` and
  `mise run bench -- --check --project <name>`. Do not add one task or CI job per package.
- `tools/` is a private workspace package. Its substantive programs are TypeScript; `.mise/tasks/ops/` selects native tools.
- Sampo owns changesets, semantic versions and changelogs. Read `docs/maintenance/03-releases.md` before changing releases.
- npm ships ESM JavaScript and declarations. JSR ships TypeScript source. Preserve public inference and check actual
  installed consumers with `mise run test -- --suite packages` when changing packaging.

Use conventional names: checks, linting, formatting, tests and benchmarks. Keep a single owner for each workflow.
Keep temporary work and evidence under `.tmp/`, and preserve existing evidence and unrelated worktree changes.
Do not publish, push, commit or rewrite history without user authorization. Infrastructure tests are explicit: read the
test ownership listing before starting database, Docker or long-running soak workloads.

Run focused checks first, then the gates appropriate to the changed contract. `mise run check` checks source contracts;
`mise run check -- --kind jsr` performs a source-publication dry run. A dry run is not a published release. State what was
actually tested and which external settings or environments remain unverified. Review the changed artifact as a new
reader before handing it off, including failure and recovery instructions.
