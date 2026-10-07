# Utils: retained changes and verification

Standalone Utils remains the base for this change. It already has the stronger process, Worker, dispatch, clock and
workflow ownership model. Core contributes useful query, CSV, contract lookup and boundary fixes. MediaD contributes
application context for the same programming model. The changes below keep the useful behavior without replacing the
standalone runtime with an older copied tree.

Start with [Choose utilities by outcome](./outcomes.md). It maps all 41 focused packages to concrete problems and
follows an import from bounded CSV input through validation, resources, activities and workflow recovery. Each package
guide starts with a complete public-import example, expected output, extensions and ownership limits. HTTP and server
sub-guides also have runnable examples. Application sketches remain useful for composition but state the dependencies
that the application must supply.

## Sources and selection

The initial working-tree review compared Utils at `0b06c4985316b01a51e85a36b55ce84404f33262`, Core at
`ce669f83a81a16bec5984a9521fbc5da6def0e09`, and MediaD at `7fa950b15e336eb9e181ad205c33ec14ca6a388a`. Existing Core and
MediaD changes were reviewed as source and left in place. This implementation changes the standalone Utils repository.

The earlier detailed review is in MediaD at `docs/implementation/utils-review-20261006.md`; it includes the original
export inventory, comparative defect probes, PR history and proposed slices. The current
[comparison JSON](./utils-comparison-20261006.json) is reproducible with:

```sh
deno run -A tools/compare-utils.ts /path/to/Core/utils /path/to/mediad/utils > comparison.json
```

The tool parses every scanned TypeScript module with Oxc. It retains source hashes and normalized AST hashes, records
tests and benchmarks separately, rejects parse errors and ambiguous path normalization, and normalizes the known
`@utils/` import prefix. AST comparison omits comments and source positions so spacing changes do not masquerade as
behavior. Equal hashes help select files for review; they do not prove public compatibility, dependency identity or
runtime equivalence. Aggregate re-export modules remain visible in the JSON and inflate raw file counts.

The final snapshot contains 336 Core files, 264 MediaD files and 507 standalone files, including tests, benchmarks and
aggregate bridges. Production comparison excludes those tests, benchmarks and aggregate bridges:

| Result against standalone Utils   | Core | MediaD |
| --------------------------------- | ---: | -----: |
| Exact source                      |   21 |     24 |
| Same normalized AST               |   50 |     32 |
| Changed AST                       |  129 |    121 |
| Present only in the compared tree |   25 |      3 |
| Present only in standalone        |   35 |     58 |

The changed files include intentionally retained standalone capabilities. Their count is not a remaining port queue.

Relevant Core PRs were inspected alongside current source:

| Source                                                                                                                      | Useful behavior and decision                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#275](https://github.com/Kaiju-Ind/Core/pull/275), merged                                                                  | Retain bounded Boolean query grammar, lossless URL values, explicit adapter capability and pagination helpers.                                                                                           |
| [#276](https://github.com/Kaiju-Ind/Core/pull/276), merged                                                                  | Reviewed endpoint-owned HTTP clients and finite request lifetimes. Keep these as a separate future capability: their stream ownership and endpoint integration require a deliberate public API addition. |
| [#288](https://github.com/Kaiju-Ind/Core/pull/288), superseded by merged [#290](https://github.com/Kaiju-Ind/Core/pull/290) | Retain selected CSV, task, fault, forwarding, static-definition and process-settlement behavior. The merged delivery supplies provenance; copied PR validation is not standalone proof.                  |
| [#241](https://github.com/Kaiju-Ind/Core/pull/241), merged                                                                  | Database-authoritative lease time is a precedent for persistent adapters, not a guarantee supplied by the in-memory reference stores.                                                                    |
| [#286](https://github.com/Kaiju-Ind/Core/pull/286), open at review                                                          | Utility changes mainly affect server fixtures. No replacement of the standalone server ownership model.                                                                                                  |

Roles, AWS signing, internal gateway policy, schema adapters and the uncommitted polling draft were assessed as separate
capabilities. They are not copied wholesale here. In particular, polling's original two tests did not establish retry
exhaustion, cadence changes, cancellation or fairness. Exact-definition identity, compiled routing, effect observers,
executor generations and activity claim fencing remain owned by the standalone implementations.

## Behavioral fixes

| Trigger before the change                                                                                                                          | Result after the change                                                                                                                                                                        | Evidence                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Work throws `undefined`, then owned cleanup fails. The task's old sentinel loses the work failure.                                                 | A separate failure flag preserves both failures through `SuppressedError`. Completion is reported after cleanup, and cancellation/disposal joins cleanup even after the operation returns.     | Task regression tests use explicit operation and cleanup gates.                                             |
| A Worker schema validates asynchronously. A duplicate request can enter before the first becomes active; cancellation can fault the entire server. | Admission reserves the request ID before validation. Parent admission and server execution track cancellation, shutdown and cleanup. Recent terminal requests accept legitimate late controls. | Deterministic parent/server race tests plus native Worker restart.                                          |
| An idle pool value leaves the idle list during an asynchronous health check. Another caller sees apparent spare capacity.                          | Reservations count health checks, creation handoff, return and close against maximum capacity. Cancellation after health checking closes the value and wakes a waiting borrower.               | A strengthened coordination benchmark caught the capacity violation; pool tests hold the health check open. |
| Drain begins while a returning pool value is checked. The original test only checks that drain settles.                                            | Release rechecks pool state before retaining an idle value. The test also requires one close and an empty idle set.                                                                            | A logical clock and explicit health gate qualify both joining and resource release.                         |
| Forwarding removes a fixed header list but retains fields nominated by `Connection`.                                                               | The reusable header projection removes both fixed and nominated hop fields before credential trust policy applies. Repeated cookies and caller input remain intact.                            | Header tests and a forwarding integration test include nominated Authorization.                             |
| Ordinary native `TypeError` diagnostics become `Error`; reading arbitrary accessors would be unsafe.                                               | Data-descriptor lookup retains native error names, with narrowly guarded native stack access and bounded diagnostic projection.                                                                | Native error cases and hostile name/message/stack accessors.                                                |
| Captured output exceeds its limit, and process stop waits through the already-failed result promise.                                               | Native exit and output pumps have a separate settlement barrier. Stop/disposal can join actual cleanup after result failure. Permission-denied liveness remains conservative for trees.        | Controllable adapter tests, native Deno children and native Node descendants.                               |
| A disposal callback throws `undefined`.                                                                                                            | Both disposal paths remember that failure and still attempt every registered callback.                                                                                                         | Fresh-runtime compatibility tests exercise the explicit disposal polyfill.                                  |

CSV streaming also releases the original byte-reader lock at EOF and on discovery failure. Explicit disposal cancels
pending reads before joining the active row iterator; the old order could wait indefinitely on the read it needed to
cancel. Repeated disposal joins one cleanup promise. Native stream regressions cover natural exhaustion, a blocked
iterator, empty or missing headers, and a source failure.

Connection-specific header removal follows
[RFC 9110 section 7.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1). That forwarding fix does not change
the application's explicit credential or external-origin decisions.

## Capabilities and compatibility

Query now represents bounded `all`, `any` and `not` expressions, lossless scalar/value serialization and canonical
normalization. A flat-only adapter rejects an unsupported expression instead of silently discarding its meaning.
Standalone `.wireSchema()` remains available. The query guide shows a runnable before/after wire example. Applications
that persist query text should review the canonical wire change before migrating saved values.

CSV uses the maintained parser/stringifier with browser conditional imports. Collection and streaming retain the
standalone normalized-header policy, explicit header selection and structure helpers. `rawHeader` retains the actual
source text; `preserveBlankRows` and source occurrence APIs make discarded source information an explicit choice. Cell
and record writing provide matching output. Stream parsing rejects unsupported `maximumCharacters` rather than silently
ignoring it. The original fixture corpus remains authoritative, alongside split-byte, pressure, cancellation and writer
tests. The CSV guide contains a runnable source-occurrence example in addition to the initial parsing example.

Catalog adds exact-ID lookup, exact-object membership and typed ID projections. Requirement and permission definition
subpaths allow contract discovery without loading execution machinery. Interned requirements preserve exact-object
identity. The runtime permission interpreter stays in its original owner. Both Deno and Node manifests, plus aggregate
re-exports, expose each added entrypoint.

`duration/temporal` is a local ponyfill: callers can use Temporal without installing a global. `duration/polyfill` is
the explicit application setup entrypoint: it installs Temporal only when missing and preserves an existing
implementation. The matching `utils/duration/*` entries provide the same choice through the installation facade. This
enables deadlines, logical clocks, queue expiry and workflow timing on a host without global Temporal. Each Worker and
process needs its own setup because each has a separate realm. Ordinary utility imports do not perform that
installation. The [Temporal guide](../packages/duration/README.md) explains calendar anchors, local use and executable
setup.

HTTP response helpers also provide safe attachment disposition for Unicode and untrusted filenames. The projection
removes path and control data while retaining an encoded Unicode name. It is a response boundary helper, not a
filesystem path resolver.

The workspace's formatter was applied broadly because spacing and formatting were part of the request. Those edits
include existing documentation, fixtures, manifests and release configuration. Formatting changes are separate from the
behavioral fixes above. Existing exported names were retained rather than renamed to satisfy a naming preference.

## Tests that prove behavior

Documentation tests compile and run marked examples through public package exports and compare their observable output.
They do not enforce heading wording, line counts, prose fragments or a fixed number of examples. Package inventory is
derived from manifests and compared with the installation facade. A documentation rewrite can change explanation text
without failing a behavior test; an invalid import or wrong example result fails the test.

Static-import tests inspect actual dependency graphs rather than matching source strings. Fresh runtime probes confirm
that generic imports do not install optional globals, static definitions work without execution globals, server imports
do not bind a listener, and telemetry records events without assuming one platform's globals. Consumer type fixtures
qualify inference without requiring an exact `Object.freeze` spelling.

Validation assertions now use error classes and structured transport issue codes instead of incidental explanation text.
Callback-owned messages remain distinct from product prose. CSV blank-row and UTF-8 limits assert their stable parse
codes, and workflow child-limit tests derive the declared budget rather than freezing an implementation number.

Concurrent tests use explicit entered/release promises or a logical clock where scheduling and expiry are the subject.
The Worker restart test advances lease time only after the first external effect is observed and the replacement exists.
Its timeout remains a diagnostic bound for a stalled native operation, not a performance assertion. Native stream tests
collect all chunks because operating-system reads need not match writes. Port discovery checks range and actual use,
retrying only an address-in-use race because discovery returns a released port rather than reserving it.

## Benchmarks that measure useful work

Every registered benchmark runs untimed fixture validation first. `deno task bench:check` invokes those oracles without
timing; `deno task bench` runs seven explicit programs in fresh Deno processes. The previous recursive workspace task
could invoke the root benchmark task again. The explicit runner stops on a failed program, and Mitata is configured to
throw on a failed case.

The [benchmark guide](./benchmarks.md) documents exact measured boundaries. CSV checks every field across 10,000
records; coordination checks every result and final ownership; dispatch checks actual inputs/results; discovery checks
complete URL and resource sets. HTTP separates response headers from body consumption, and routing compares 16, 256 and
4,096 routes with an independent linear reference. Workflow identity verifies determinism and changed-input sensitivity
while measuring hashing and planning only. Primitive baselines such as array shifting and direct reads are labeled with
the ownership and fencing semantics they omit.

No timing threshold is a correctness assertion. A faster implementation passes if its results and ownership still meet
the contract. This run establishes that the suite completes and its oracles hold; it does not establish a speedup, peak
memory bound, cross-host ranking or stable timing baseline.

## Verification and limits

Validation uses the real locked dependency graph, Deno 2.9.7, Node 26.10.0 and the repository's TypeScript 7.0.2
compiler gate.

| Check                            | Observed result                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Frozen dependency installation   | Passed offline with the final lockfile; dependency scripts disabled.                                   |
| Format, lint and compiler        | Passed, including consumer type fixtures and repository tools.                                         |
| Public declaration documentation | No missing workspace comments across 152 focused public entrypoints.                                   |
| Deno runtime suite               | 162 test groups, 696 steps passed; the Node-only process group is intentionally ignored here.          |
| Native Node selection            | 121 tests across 24 suites passed, including native process descendants; registered in `verify`.       |
| Teaching examples                | All 55 examples across 52 package and subpackage guides compiled and ran through public imports.       |
| Packaging and tree shaking       | Manifest/export parity and focused-versus-aggregate consumer checks passed.                            |
| Benchmark oracles                | All registered untimed oracles passed and run in `verify`.                                             |
| Full measuring command           | All seven benchmark programs completed successfully after the final pool and CSV ownership fixes.      |
| Browser conditional CSV consumer | Self-contained browser-selected bundle preserved Unicode, quotes, newlines and one-byte source chunks. |

The raw native outputs are retained locally in `docs/evidence/utils-20261006/`; log files are ignored by Git. The
verification task now includes the native Node selection and `docs:check`, in addition to the existing runtime,
compiler, packaging, tree-shaking, benchmark and consumer checks.

The complete public-subpath documentation scan still reports 103 distinct renderer type diagnostics: 62 private/imported
references and 41 missing explicit types. Two of those references belong to dependencies. The Temporal dependency also
contributes 259 missing-comment diagnostics in its own declaration file. Those are reported separately from the now-zero
missing workspace comments. Runtime-derived constant types were not replaced just to satisfy the renderer, and
dependency declarations were not edited. Compiler correctness and the accuracy of an explanation remain separate checks:
comment presence alone cannot establish that documentation teaches the right behavior.

Native Worker and process tests qualify validated attempts, generation/claim fencing, replacement and cancellation. The
restart scenario copies serialized history into a fresh in-process reference store. It does not qualify a deployed
database, independent persistent process restart, cross-computer transport, or Kubernetes admission. Placement metadata
selects a registered executor; it does not move a live JavaScript stack, streams or handles to another thread. External
effects still need provider-owned idempotency, as the duplicate external-effect recovery scenario demonstrates.

The browser conditional CSV bundle is built for the browser and round-tripped in a native Web API host without external
runtime imports. It qualifies that selected build and byte-boundary behavior. A deployed browser UI, published npm/JSR
release, and other native operating systems remain outside this run's proof.
