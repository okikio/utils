# Keep source separate from run evidence

A checkout should contain the code, fixtures, and instructions needed to reproduce a capability. A test receipt records
what happened during one run; it is not a dependency of the capability it describes. Keeping these roles separate makes
reviews smaller and prevents an old successful run from being mistaken for proof of current source.

New temporary work belongs in `.tmp/`, including Codex reports, JSON, logs and diagnostic programs. A fresh checkout
reproduces tests from tracked source; it does not need these local records. Preserve useful failure and recovery runs
there without overwriting them. Generated build and benchmark outputs also belong under `.tmp/`, in the directories
owned by their reproduction tasks. Native CI reports and container test dumps use the same boundary.
Maintained guides explain current behavior without requiring a local run report.

## Decide what belongs in Git

| Path or material                                                                | Owner and purpose                                                                        | Retention                                                                                        |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/`, `tests/`, `bench/*.bench.ts`, `bench/fixtures/`                    | Authored behavior, executable scenarios, and benchmark inputs                            | Track and review with the code they test.                                                     |
| `tools/`, `.mise/tasks/`, `.github/workflows/`                                  | Reproduction, validation, and CI orchestration                                           | Track. Commands must not require an old local evidence folder.                                   |
| `tests/fixtures/hono-upstream/`                                                 | Pinned upstream comparison corpus with revision, license, and source hashes              | Track under its explicit corpus policy; it is not a cache.                                       |
| Package-local fixture files                                                     | Inputs deliberately owned by a test or benchmark                                         | Track when the consumer needs their exact bytes. Size alone does not make them disposable.       |
| `.tmp/artifacts/bench/freeze/`                                                      | Current generated treatment modules, inventory, verification, new samples, and summaries | Ignore. Prepare from current source before correctness checks or timing.                         |
| `.tmp/tests/`, `.tmp/tests/recovery/`                                    | New native receipts, test logs, SQL dumps and temporary diagnostics                     | Ignore locally; selected CI jobs upload run artifacts with retention.                            |
| `.tmp/artifacts/history/20261104/`                                                  | Preserved prior verification records, freeze experiment, and dated delivery reports      | Local historical evidence. Copy to durable artifact storage before deleting the local directory. |
| `.tmp/docs/history/`, `.tmp/docs/design/` | Local research, plans and dated implementation ledgers | Ignore. Preserve useful records locally; put current consumer instructions in maintained docs. |
| `node_modules/`, package stores, editor state, local environment files | Installed dependencies, caches and machine configuration                       | Ignore; never use them as source evidence or commit credentials.                                 |
| `.sampo/`                                                                       | Sampo changesets and release configuration                                        | Track according to release policy. It is not an arbitrary scratch folder.                        |

Generated source can belong in Git when a real consumer requires committed bytes and a deterministic generator checks
drift. That is a specific contract, not permission to retain every JSON dump or benchmark run alongside source.

Repository-owned programs use TypeScript. The npm JavaScript consumer fixture deliberately exercises emitted exports
without a TypeScript loader, and the small `.mise/tasks/ops/` shell entrypoints let Mise own native command dependencies.
Neither exception creates a second implementation of the utilities. Browser source bundles stay in repository
`.tmp/tests/browser/`. Installed-consumer bundles and copied scenarios use that consumer's `.tmp/`, outside the checkout,
so workspace dependency resolution cannot conceal an incomplete package archive.

## Use the freeze benchmark from a fresh checkout

Install the declared tools and frozen dependencies, then prepare the treatment modules explicitly:

```sh
mise install
mise run prepare -- --kind deps
mise run prepare -- --kind freeze
mise run bench -- --operation freeze --check
```

Preparation writes only current outputs under `.tmp/artifacts/bench/freeze/`. The check validates source and dependency
hashes, treatment equivalence, successful outputs, invalid inputs, identity, and mutation behavior. It records no timed
samples and does not refresh a stale checkpoint silently. CI prepares the treatments before its benchmark correctness
task.

Select new sample names and run measurements sequentially on an otherwise idle machine:

```sh
mise run bench -- --operation freeze -- --output .tmp/artifacts/bench/freeze/node-1701.json --seed 1701
mise run bench -- --operation freeze -- --output .tmp/artifacts/bench/freeze/node-1702.json --seed 1702
mise run bench -- --operation freeze:summarize -- .tmp/artifacts/bench/freeze/node-1701.json .tmp/artifacts/bench/freeze/node-1702.json
```

Raw measurements refuse an existing output filename. Summaries belong to the prepared inventory and reject mismatched
source checkpoints. Preparing after a source change does not turn old measurements into new evidence. The
[experiment guide](../../bench/freeze/README.md) explains treatments, limitations, and alternate runtimes.

## Find and preserve the old evidence

The November 4 restructure preserved the complete old `verification/` tree at
`.tmp/artifacts/history/20261104/verification/`, including locally present logs and temporary probe files. The original
`bench/freeze/` tree is at `.tmp/artifacts/history/20261104/bench-freeze/`; its historical ZIPs and raw measurements remain
there. Earlier root reports are in the sibling `reports/` directory. A `manifest.json` records preserved file paths,
byte sizes, and SHA-256 digests. These paths are local and are intentionally absent from a fresh clone.

The November 5 delivery also preserved the 15 removed historical reports exactly as they appeared at Git revision
`a7dbcf107331a897a7a07e64c8566efa8e898ea3`, under `.tmp/artifacts/history/20261105/head-reports/`.
Its separate `manifest.json` records the source revision and exact byte hashes. These copies differ from the earlier
working-tree archive; keep both when investigating how a report changed before removal.

The pre-change tracked-file hashes, source copies, status, and index backup are under
`.tmp/artifacts/docs-restructure-20261104/`. That backup is a recovery aid for this edit, not a portable dependency or a new
source tree to maintain.

Before removing local history, copy the full history directory to durable storage, verify each file against its
manifest, and record where it can be retrieved. Only then decide whether the local copy is expendable. Re-running tests
can produce new evidence, but cannot recreate the historical run's process identity, timing, or output bytes.

An ignored file is still on disk. Removing a path from Git's index is also different from deleting it locally.
Conversely, adding an ignore rule does not remove files already staged. Inspect the staged diff before committing so
removed evidence does not enter the next source commit accidentally.

Verify the preserved local bytes from the repository root with this read-only command. A missing or changed file throws
before the success message:

```sh
node --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = '.tmp/artifacts/history/20261104';
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
for (const entry of manifest) {
    const bytes = await readFile(`${root}/${entry.path}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.bytes || hash !== entry.sha256) {
        throw new Error(`Changed evidence: ${entry.path}`);
    }
}
console.log('Verified retained evidence.');
JS
```

## Diagnose a failure without rewriting the evidence

- A missing treatment module means preparation has not completed. Run the explicit prepare task, then check.
- A source or dependency hash mismatch means the prepared checkpoint is stale. Preserve any run you need, prepare a new
  checkpoint, and record new measurements with new names.
- A correctness failure needs investigation of source and treatment behavior. Do not replace an old report to make it
  appear green.
- A sample mismatch means the inputs do not describe one experiment checkpoint. Select matching samples explicitly
  rather than combining historical and current numbers.

For source, host, database, browser, and package validation, use [Testing](./01-testing.md). Passing benchmark
correctness does not establish performance, crash recovery, production availability, or human understanding of the docs.
