# Cross-project merge ledger

The initial extraction was a package-by-package forensic merge, not a copy of one repository. The three input archives and their SHA-256 hashes are recorded in `.agents/research/provenance.json`.

## Rules used

1. Compare shared package file trees and TypeScript declarations.
2. Compare test names and regression coverage across projects.
3. Preserve a source wholesale only when the competing source has no unique behavior or test that remains valid.
4. Merge independent fixes when different projects repaired different failure modes.
5. Keep product-specific policy out of this repository.

## Confirmed cross-project merges

### CSV

Platform added regression coverage for valid one-column imports. MediaD separately extracted shared structural parsing and fixed explicit `headerRow` so automatic `headerScanRows` does not cap an explicit row. The consolidated package retains both behaviors and both regression tests.

### Deno

Platform supplies the newer permission parser and signal-listener lifecycle API. Crawl contributes generic atomic file replacement and ephemeral TCP-port discovery. The consolidated package exposes all four focused subpaths and adds lifecycle tests for the Crawl additions.

### Process

Platform supplies the newer POSIX process-group ownership, process channel protocol, and Node Web-Stream byte handling. Crawl contributes the regression that discarded Deno stdio must not access stream getters. The old Crawl expectation that process groups are unsupported is intentionally not retained because the newer implementation provides that guarantee on POSIX hosts.

### Pool and queue

Platform supplies the current implementations and stronger concurrency tests. MediaD's compatible Mitata benchmarks are retained so performance regressions remain visible in the canonical package.

## Test-set evidence

Across Platform and MediaD, MediaD has one regression test not present in Platform: the CSV explicit-header case merged above. Platform has additional regressions in environment parsing, HTTP body ownership/trust, resilience timing, server typing/trust, worker cleanup, and workflow durability/structured concurrency; those Platform implementations are retained.

Across Platform and Crawl shared packages, Crawl has two process tests not present in Platform. The still-valid discarded-stdio regression is merged. The unsupported-tree test is superseded by Platform's tested POSIX process-group implementation. Platform otherwise has additional strictness/concurrency tests for capacity, catalog, codec, context, failure, process, queue, result, and schema.

## Excluded copies

- `base64`: use maintained `@std/encoding/base64` directly.
- Crawl `metrics`: owns Kaiju process-tree and `.kaiju/scratch` policy.
- Crawl `records`: owns Kaiju-specific LogTape category policy.

The machine-readable per-package provenance is in `.agents/research/provenance.json`.
