# Measure the cost of Object.freeze without changing production

`Object.freeze()` prevents changes to an object's own properties. This experiment asks what that protection costs in
Result, Collection record and catalog, and Task progress. It generates a second version of each selected module without
the freeze calls. Both versions must return the same outputs in the workload, but the plain versions deliberately allow
changes that production code prevents.

Read `freeze.bench.ts` for the code the benchmark measures. The commands in `tools/bench/freeze/` prepare and run
the comparison. They keep the generated copies, checks, samples, and summaries under `.tmp/artifacts/bench/freeze/`,
outside Git.

## Prepare and check one source checkpoint

From the repository root:

```sh
mise install
mise run prepare -- --kind deps
mise run prepare -- --kind freeze
mise run bench -- --operation freeze --check
```

Preparation reads the abstract syntax tree (AST), the parser's structured representation of the source, to locate
actual `Object.freeze` calls. It creates four frozen/plain pairs. Both Progress copies omit the
unmeasured effect registration and its effect import. Shared dependencies retain production behavior. The inventory
hashes source, generated modules, declarations, the workspace runtime import closure, relevant manifests, locks,
compiler identity, and measurement controls. The **runtime import closure** is the set of workspace modules reachable
through imports needed to run the experiment. Hashing those dependencies prevents unchanged workload files from hiding a
changed implementation.

Each stage consumes the previous stage's evidence:

| Stage | Input | Output or observation |
| --- | --- | --- |
| `prepare -- --kind freeze` | Current source and toolchain | Generated frozen/plain pairs, inventory hashes, verification receipt |
| `bench -- --operation freeze --check` | Prepared files and current source | Read-only agreement checks; no timing samples |
| `bench -- --operation freeze` | Matching prepared checkpoint and a seed | A fresh raw measurement JSON file |
| `bench -- --operation freeze:summarize` | Compatible raw files from independent runs | `summary.json` and readable `RESULTS.md` |

The first two rows establish what was measured. The last two measure and summarize it; a successful check alone is not
a performance result.

The check is read-only after preparation. It verifies those hashes, emitted-code equivalence after the documented
substitution, successful-output agreement, invalid-input behavior, identity, and mutation differences. It takes no timed
samples. To save the derived verification receipt deliberately, run `mise run bench -- --operation freeze:verify -- --write`;
preparation already does this.

## Record and summarize independent runs

Run processes sequentially on an idle machine and choose new filenames. Raw output refuses to overwrite an existing
file.

```sh
# Collect two independent Node processes against the same prepared checkpoint.
mise run bench -- --operation freeze -- \
  --output .tmp/artifacts/bench/freeze/node-1701.json \
  --seed 1701
mise run bench -- --operation freeze -- \
  --output .tmp/artifacts/bench/freeze/node-1702.json \
  --seed 1702

# Keep runtime-specific samples separate; Deno gets only the permissions shown.
mise exec -- deno run \
  --frozen \
  --no-check \
  --allow-read \
  --allow-write=.tmp/artifacts/bench/freeze \
  --allow-env \
  --allow-sys \
  bench/freeze/freeze.bench.ts \
  --output .tmp/artifacts/bench/freeze/deno-1701.json \
  --seed 1701
mise exec -- bun bench/freeze/freeze.bench.ts \
  --output .tmp/artifacts/bench/freeze/bun-1701.json \
  --seed 1701

# Summarize these two Node trials without pooling unlike runtimes.
mise run bench -- --operation freeze:summarize -- \
  .tmp/artifacts/bench/freeze/node-1701.json \
  .tmp/artifacts/bench/freeze/node-1702.json
```

The summarizer writes `summary.json` and `RESULTS.md` under `.tmp/artifacts/bench/freeze/`. Without explicit filenames
it scans recognized runtime sample names in that directory. It rejects mixed inventory hashes, missing or duplicate
samples, mismatched pairs, and duplicate raw bytes. Runtime versions remain separate groups.

The harness is a standalone paired experiment rather than a Mitata or Deno.bench suite. It retains produced values and
consumes a checksum, constructs read-only inputs before timing, calibrates and warms up, and records randomized pairs
plus actual runtime and machine details. It checks prepared hashes before and after timing.

## Interpret the result within its limits

Measurements describe synchronous batch averages, not service-tail latency or Crawl throughput. Process-level ranges
keep independent runs visible. A five-percent investigation threshold is a triage rule, not a significance test or
authorization to weaken mutation contracts. These fixtures establish neither retained-memory bounds nor distributed
reliability.

Changing source or a shared dependency requires a new prepared checkpoint and new measurements. Do not combine a
refreshed inventory with retained timings from another revision. Earlier ZIP checkpoints, reports, generated modules,
and raw measurements were preserved locally under `.tmp/artifacts/history/20261104/bench-freeze/`, with file hashes in
the history manifest. See [artifact ownership](../../docs/maintenance/05-artifacts.md) before moving or deleting local
evidence.
