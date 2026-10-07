# Tests, benchmarks and repository tools review

This review checks whether the verification machinery protects useful contracts without making prose, formatting or
performance improvements fail correctness gates. It also checks that generated exports and recorded measurements retain
their actual source authority. It accompanies [the test inventory](test-review.md),
[the qualification catalogue](qualification.json) and [the challenger review](http-challengers-review-20261007.md).

## Guide applicability

The controlling guide directory is `/Users/okikio/Documents/Notes/Guides/skills & guides/general-skills/`. The user's
explicit request and current source take precedence over its defaults. Relevant entrypoints and references were read for
this pass; an applicable guide is not a claim that every rule has been proved by execution.

| Guide                | Applied surfaces and references                                                                                                   | Resulting review rule                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deliver-software`   | `base`, `standards`, `general`, `workflow`, `typescript`, `testing`, `benchmarks`, `review`, `comments`, `docs`                   | Independent expectations, inference probes, explicit ownership, meaningful internal documentation and separate source, artifact and runtime proof. |
| `build-devtools`     | Toolchain, generated-artifact, performance and hygiene references; generators, checker tools, tasks and measurement controllers   | Check without writes, preserve authored regions, retain input identities and raw failures, and use the selected tool owners.                       |
| `build-clis`         | Entry point, testing, benchmarking and lifecycle references; benchmark/profiler arguments, streams and child ownership            | Separate machine reports from diagnostics; join native children, bound failure handling and verify actual invocation behavior.                     |
| `build-libraries`    | Verification and resource/performance references; selective imports, package metadata, consumer fixtures and benchmark operations | Qualify actual consumer behavior and retained capability graphs; distinguish warm operations, startup and cleanup.                                 |
| `explore-ecosystems` | Entry point; comparator identity and adapter selection                                                                            | Use pinned public exports and explicit compatibility evidence. An upstream name or preserved source archive does not prove interoperability.       |
| `use-okikio`         | Entry point; current package exports, composition and ownership                                                                   | Current exports and executable consumers outrank remembered APIs or target designs.                                                                |
| `deno-software`      | Entry point; current Deno manifests and task authority                                                                            | Authored JSONC must remain valid; source tests and packed Node qualification establish different facts.                                            |

`build-apis` and `build-workflows` apply to the HTTP and orchestration contracts under test. Their production reviews
belong to the corresponding implementation owners. `build-data`, `build-web`, `build-sites` and `build-web-apps` do not
introduce database, renderer or deployment requirements into these repository tools. Optique, c12, defu and LogTape
examples in the CLI guide do not require adding those dependencies to small existing repository commands.

## Concrete changes

The fragile-test audit previously rejected an exemption explanation containing fewer than 30 characters. Length cannot
establish whether a real native observation is necessary. [The audit](../tools/audit-fragile-tests.ts) now requires
nonempty text while retaining its exact file, rule, function, operation and occurrence-count restrictions. The existing
controls accept a concise explanation, reject a blank explanation without exempting the finding, and still reject stale
or duplicate authority. Explanation quality remains a manual review responsibility.

[The umbrella generator](../tools/sync-utils-exports.ts) previously parsed `deno.jsonc` with `JSON.parse` and serialized
the whole manifest. A valid comment could break synchronization, while whole-file serialization would erase authored
comments. It now validates JSONC with the already-selected standard parser and uses the already-selected Oxc parser to
locate only the top-level generated values. Documentary strings cannot select an owned field. Missing or duplicate owned
fields fail. The generator validates all proposed files before changing any destination, sorts focused identities and
subpaths, and replaces each changed file with a same-directory rename. Bridges are written before their advertising
manifests.

The default invocation checks drift without writes. `--write` explicitly publishes generated files. A malformed second
manifest must leave the first manifest and not-yet-created bridges untouched. The
[existing selective controls](../tools/check-selective.test.ts) also check Unicode comments, CRLF text, unknown fields,
explicit setup bridges, directory-order independence, read-only checks and write/check/write convergence. These checks
protect generated ownership, rather than a particular minifier byte count or private diagnostic sentence.

The documentation gate, documentation inventory test and fresh-import benchmark also read authored Deno manifests. Their
JSON-only reads now use the existing JSONC parser. Actual `package.json`, CPU graphs, native Mitata output and
qualification JSON retain their JSON parsers. The release tool already used a JSONC parser for Deno manifests.

The generator does not delete unrelated or obsolete files from a dirty worktree. Its contract covers the current
advertised exports and generated bridge contents. Atomic replacement applies to one file; it does not make two manifests
a filesystem transaction. After interruption, rerun the read-only check and complete the explicit write.

## Tests and benchmark interpretation

Literal assertions are appropriate when they protect authored input, protocol output, source preservation or
caller-supplied failure propagation. For example, the upstream inventory must retain the exact source slice it indexed,
and an admission test must distinguish the accepted byte limit from one extra byte. Those are different contracts from
freezing private English diagnostics, Markdown wrapping or elapsed time.

The qualification catalogue maintains evidence references and package/test ownership. Its successful validation cannot
prove that a referenced suite ran. The fragile audit rejects selected syntactic mistakes; it cannot determine whether an
oracle is independent, whether a gate reaches the intended operation or whether a resource is actually released. Those
questions require semantic review and runtime evidence.

Selective-import checks execute consumer bundles and compare retained capability graphs. Bundle bytes remain
informational. Valid constant folding and additional output chunks can preserve a correct consumer. Packed
import/declaration checks prove availability and type relationships; installed semantic scenarios prove their selected
behavior. Neither establishes every possible package composition or browser deployment.

The challenger matrix requires all four candidates in all four named workloads. Eight fresh-process means remain paired
by trial, with balanced candidate positions and immediate predecessors. Its individual confidence intervals are not
simultaneous confidence for the entire matrix. Unresolved differences do not prove equivalence, and one host does not
establish universal rankings.

Each timed challenger operation creates identical requests and consumes complete response bodies. API timings are for a
35-request batch; routing timings are for an eight-request batch. These include dispatch, parameter extraction, response
construction and observation. They cannot be presented as router lookup alone. Setup and compilation are outside warm
callbacks. Elysia and Vixeny use their actual compiled routes; authored decoding, body admission, HEAD and middleware
policies are described as adaptations. Matching selected wire responses does not establish equivalent compiled service
schemas, output validation, resource authority or lifecycle APIs.

Current controller source prevents reused output directories from preserving stale comparisons, closes profile
applications even if stdin cleanup fails, and owns Bun child stdin errors. Profiler output bounds count chunks before
line buffering so a missing newline cannot bypass admission. These repairs require fault-path execution evidence,
independently of successful timing runs.

The source-variant controller now resolves both source roots to their physical paths before accepting a pair. Two
symlink names for one tree cannot constitute independent projections. Package metadata and Mise tool configuration are
exact control inputs. Deno runtime configuration is compared as parsed JSONC data, excluding only tasks, formatting and
linting; dependency aliases, compiler options and other runtime fields remain controls. This permits new check/write
tasks without confusing a runtime change with the Utils treatment.

The existing comparison test file exercises the real controller with tiny authored native reports. A valid pair
completes all eight source pairs and forwards its workload selector. Independent faults reject reused evidence, aliased
roots, dependency changes, tool changes and Deno interpretation changes before a trial starts. A native failure must
settle its child and both streams, preserve complete raw output and record a failed trial. These synthetic reports prove
controller transport and rejection behavior; they do not qualify framework correctness or measure performance. Their
watchdog bounds a broken control and makes no assertion about acceptable benchmark speed.

## Verification handoff

No compiler, runtime suite, bundler, benchmark or profiler was run on the host during this review. The changed generator
and audit controls must run in the repository's serial isolated lane, followed by the canonical final source gate.
Record their actual commands, exit statuses and receipts in the final qualification report. Prior passing runs remain
evidence for their recorded snapshots; they do not automatically qualify these later source changes.

Required focused checks are the existing `tools/check-selective.test.ts`, `tools/audit-fragile-tests.test.ts` and
`bench/challenger-compare.test.ts` suites, formatter/linter checks on the changed code, the actual umbrella check, the
fragile audit and qualification check. Source review of CI and Mise tasks establishes their selected owners, not a new
GitHub Actions execution. Merge and release authority remains with the delivery owner; this review does not claim a
merge, registry publication or deployed recovery.
