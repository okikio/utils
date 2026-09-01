# Qualification model

This directory records what the utility workspace claims and how those claims are verified.
It is not a coverage-percentage dashboard. A package can have many executed lines and still miss
the failure, cancellation, ownership, or runtime boundary that matters in production.

The repository uses three complementary test views:

- **capability tests** prove the public programming model a package claims to expose;
- **behavior tests** prove observable happy, failure, cancellation, limit, and cleanup contracts;
- **scenario tests** compose utilities the way real consumers such as Kaiju Platform, Kaiju Crawl,
  and MediaD used them.

`packages.json` is the machine-readable register. It records every publishable package, its runtime
posture, existing package tests, representative scenario groups, and benchmark ownership. Runtime
values are conservative: `candidate` is not a compatibility claim.

## Fragile-test rule

Canonical tests must synchronize on observable state, messages, promises, test clocks, or explicit
latches. They must not sleep for an arbitrary wall-clock duration to "give work time" to happen.
OS integration tests may poll an external process only when no event/handle can express the condition;
such cases require an inline `qualification-allow-timing:` explanation so the exception remains visible.

The qualification audit also rejects snapshot-test APIs for contracts that are clearer as structural
assertions. Durable *data snapshots* such as `record.snapshot()` and `context.snapshot()` are ordinary
public behavior and are not snapshot testing.

## Performance rule

A benchmark exists to answer a physical performance question. A small definition-only package does
not need a fake microbenchmark merely to satisfy a count. Packages with meaningful hot paths either
own a direct benchmark or participate in a representative scenario benchmark. Every benchmark must
consume its result, keep setup outside the measured operation where practical, and state the workload
it represents.
