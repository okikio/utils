# PostgreSQL queue contention

This experiment measures the cost of serializing terminal writes within a queue namespace. It does not claim the new
implementation is faster. The default workload creates 200 jobs, completes them with eight concurrent callers, and
retains three fresh Node-process reports.

## Run

Select a disposable PostgreSQL database explicitly through `UTILS_TEST_DATABASE_URL`, then run:

```sh
mise run bench:queue .tmp/artifacts/queue-candidate-1 --jobs=128 --concurrency=8 --samples=1
mise run bench:queue .tmp/artifacts/queue-parent-1 --source-root=/absolute/path/to/parent --jobs=128 --concurrency=8 --samples=1
```

Use new output directories for every invocation. The controller refuses to overwrite existing evidence. `--source-root`
selects the actual queue, Context, Schema and polyfill modules from that checkout; Node resolves their dependencies
through that checkout's package links. Install its frozen dependencies first. The parent source is never modified. The
same harness and Postgres.js driver from the current checkout serve both versions.

`mise run bench:queue --help` lists the controls. Jobs are bounded to 1–10,000, completion concurrency to 1–64 and no
more than the job count, and fresh samples to 1–20. `UTILS_BENCH_NODE` can explicitly select the Node executable. There
is no database URL fallback, and reports omit the URL, credentials and server address.

For a comparison, stop unrelated tests and builds first. Alternate parent and candidate order across at least three
fresh processes each, with identical jobs and concurrency. Measure concurrency one separately from contention, such as
concurrency eight. Keep failed samples and distinguish them from successful timing reports. There is no automatic speed
threshold or CI timing gate.

## What is timed

The harness connects, migrates explicitly, warms every completion-pool connection, prepares the inputs and claims all
jobs before starting the clock. Five-minute leases exceed the three-minute workload deadline. The timed batch invokes
the public `complete()` operation with a fixed number of concurrent callers. It records wall time for the whole batch
and elapsed latency for every completion, including waiting for the database and namespace lock.

All decoded outputs, queue state counts and the exact retained database row count are checked afterward. Retention
equals the job count, so no pruning pressure removes results. Both parent and candidate therefore perform equivalent
successful work; the experiment isolates the extra transaction/lock cost rather than rewarding the parent's incorrect
retention under pressure. Pool preparation, result verification and cleanup are outside timing. The first complete call
is not warmed up, which is the same condition for both versions.

This is a finite database workload rather than an adaptively calibrated Mitata microbenchmark. Adaptive calibration
would keep creating persistent jobs, vary the database state being measured, and obscure the individual operations
waiting on locks. The repository's ordinary Mitata benchmarks remain unchanged.

## Evidence and cleanup

Each output directory contains `meta.json`, one raw numbered JSON report per process, and each process's stderr. Reports
retain:

- source and common harness hashes before and after execution;
- runtime version, explicit flags, inherited Node-option presence, OS/CPU and container quotas;
- PostgreSQL version, fsync, synchronous commit, full-page writes and default isolation;
- job/concurrency/retention counts, raw completion latencies and wall time;
- correctness counts, error phase/name/code, namespace removal and pool closure status.

The metadata's empirical p50/p95/p99 summaries use nearest-rank observations from that finite batch. A batch with 128
jobs cannot establish production p99 latency or reliability. Independent process results, their variation and the
unchanged settings matter more than the fastest individual sample. No retained-memory, Crawl-throughput or
operating-cost claim follows from this experiment.

Every sample owns a UUID namespace. Its `finally` block closes its queue view, deletes only that namespace's rows and
policy, checks removal and closes the owned pool. Failed or partial work remains marked failed. An outer 240-second
process deadline requests cooperative termination, then allows 15 seconds before a hard kill; a forced process loss
cannot prove cleanup. The namespace remains in metadata for inspection if cleanup was not confirmed.

This task deliberately stays outside the database-free `bench:check` suite and CI benchmark correctness lane. Its
orchestrator uses the same explicit Deno `-A` permission model as the existing benchmark recorder because collecting
Linux cgroup limits requires access beyond Deno's ordinary read permission. Production packages acquire no new
permissions.
