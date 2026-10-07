# Standards review, 2026-10-07

This review corrected stale documentation against the current Utils exports and owners. It inventories all 28 local
skill entrypoints and all nine top-level Markdown guides, then routes their applicable rules to this library. It does
not turn an unrelated UI guide into a server requirement or a source review into runtime qualification.

The input catalog is `/Users/okikio/Documents/Notes/Guides/skills & guides/`. The catalog contains 13 general skills, 15
design skills and nine root Markdown guides; `.DS_Store` is filesystem metadata. Input hashes and the scoped before-edit
documentation snapshots are retained outside the checkout at `/private/tmp/utils-standards-review-20261007/`. Counts
describe this review snapshot, not an invariant for future releases.

Every skill's applicability and reference routing was inspected. Applicable library, API, workflow and ecosystem rules
were followed into their relevant references and current implementation. Top-guide sections were reviewed for their
applicable rules. Unrelated renderer, animation, database deployment and CLI product references were excluded. This is
an applicability review, not a claim that every nested reference or every UI rule was exercised.

## Corrections and their evidence

| Finding                                                                                    | Correction                                                                                                                                               | Controlling evidence and limit                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The environment comparison table taught `env.require()`, which is not a public export.     | Name `definition.parse()` / `parseSync()`, matching the executable example.                                                                              | `packages/env/mod.ts`, `standard.ts`, `definition.ts` and `types.ts`; invalid configuration belongs to the definition's parsing contract. No new API was added.                                       |
| Duration still named the previous Temporal provider.                                       | Link `temporal-polyfill` and explain the `full/implementation` calendar entry and explicit installer cost.                                               | `packages/duration/temporal.ts`, `polyfill.ts`, `deno.jsonc` and `package.json` select `temporal-polyfill@1.0.5`. Ordinary imports do not install globals.                                            |
| Gateway prose promised unconditional completion tracking and byte accounting.              | Explain the deadline/terminal-observer condition and continued caller abort propagation.                                                                 | `packages/server/gateway/runtime.ts` keeps `abortableResponse()` and conditionally adds `response.onComplete()`. No throughput claim follows from this source observation.                            |
| Gateway transport documentation omitted compression metadata and custom-fetch assumptions. | Document exact single-`gzip`/`br`, body-presence and nonzero wire-length normalization; preserve the normal header sanitation rules for other responses. | `forwardedResponse()`, `copyResponseHeaders()` and redirect rewriting in the same runtime. A custom fetch returning raw compressed bytes does not satisfy the assumed native Fetch decoding contract. |
| Process documentation described group signaling as preventing orphaning.                   | Explain that group shutdown targets descendants and the host still owns reaping.                                                                         | `packages/process/README.md` distinguishes direct-child and POSIX group ownership. Sending a signal does not perform the host's wait/reaping work.                                                    |
| Root orientation repeated the same installation-facade explanation.                        | Keep one opening statement before the complete CSV example.                                                                                              | `README.md`; the example, output, memory limit explanation and public import remain intact.                                                                                                           |

The provider identity is also supported by the
[Temporal maintainer's repository](https://github.com/fullcalendar/temporal-polyfill). The container ownership limit
matches [Docker's process and init documentation](https://docs.docker.com/engine/containers/multi-service_container/).
Neither upstream page supplies a Utils benchmark result or proves a deployed application.

## General skill disposition

Names below identify `general-skills/<name>/SKILL.md` under the input catalog. “Applied” describes review criteria, not
a completed runtime or publication gate.

| Skill                | Disposition in this repository                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deliver-software`   | Applied: explicit scope, source-first findings, narrow corrections, preserved dirty work, separate validation and final qualification. Base, standards, implementer, docs and review rules govern this pass. Git delivery remains with the coordinating owner.                                                         |
| `build-libraries`    | Applied: public imports, useful first operation, explicit data shape and materialization, ownership, selective adoption, optional adapters and truthful recovery guarantees. Architecture, data-flow and recovery rules govern the package explanations.                                                               |
| `build-apis`         | Applied to HTTP/server/Hono/gateway guides: imported contract versus runtime versus listener, schema validation, credential policy, response failures, streaming lifetime and observers. Runtime guidance distinguishes in-process Fetch outcomes from deployed transport behavior.                                    |
| `build-workflows`    | Applied to activity, queue, task and workflow descriptions: local cancellation is transient; memory history/dispatch disappears with the process; durable execution requires authoritative storage, fenced claims and recovery. Durability guidance prevents a retry/replay example from implying persistent recovery. |
| `explore-ecosystems` | Applied to dependency/provenance statements: selected source and manifest identity, direct public APIs, explicit divergence and exact proof level. Evidence guidance separates published behavior, inspected source and current documentation. Temporal provider attribution was corrected.                            |
| `deno-software`      | Applied to documentation boundaries: Deno source is canonical, adapters are explicit, permissions belong to executables, JSR publication and Node artifact qualification are different claims. Manifest/tool execution is delegated to the qualification owner.                                                        |
| `use-okikio`         | Applied to historical comparison and consumer provenance. The standalone utilities and copied consumer patterns are distinguished in `comparison.md` and `scenarios.md`; remembered APIs are not evidence. Backend and workflow patterns remain source-specific.                                                       |
| `build-devtools`     | Applicable, delegated: tooling, generated outputs, exports, artifact provenance and release mechanics are reviewed by their owner. This pass preserves packaging links and makes no new build or release assertion.                                                                                                    |
| `build-clis`         | Limited: applications own argv, prompts, output presentation and global logging. This suite exposes reusable mechanisms; it does not acquire a CLI product grammar merely because repository tasks exist. Tool command contracts are delegated.                                                                        |
| `build-data`         | Limited: query definitions describe capabilities and normalization; providers own query execution, persistence and atomicity. Memory stores are not database adapters. No ORM migration or deployed data projection is claimed.                                                                                        |
| `build-web`          | Limited: Web Request/Response, cookie, webhook and parser contracts apply. Fetch composition does not prove a browser application, hydration, accessibility or native networking adapter.                                                                                                                              |
| `build-sites`        | Excluded: this workspace ships Markdown/package documentation, not an Astro/CMS publishing surface. No site build, SEO or deployment was introduced.                                                                                                                                                                   |
| `build-web-apps`     | Excluded: there is no reviewed product UI, renderer, session cache, form or navigation state in this documentation change.                                                                                                                                                                                             |

## Design skill disposition

Each row identifies `design-skills/<name>/SKILL.md`. All entries were routed; their downstream UI references were not
loaded as library implementation requirements. Parsing HTML/CSS and forwarding HTTP are not rendered product interfaces.

| Skill                           | Disposition and applicability reason                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interface-design`              | Excluded: no dashboard, admin panel or interactive product layout.                                                                                                                     |
| `frontend-design`               | Excluded: no frontend page, component or visual artifact creation.                                                                                                                     |
| `baseline-ui`                   | Excluded: no rendered actions, navigation, forms or design-system integration.                                                                                                         |
| `accessibility`                 | Excluded from runtime claims: no browser UI or assistive-technology flow was exercised; readable Markdown is reviewed by documentation guidance.                                       |
| `fixing-accessibility`          | Excluded: no interactive HTML controls, focus management or ARIA implementation changed.                                                                                               |
| `fixing-motion-performance`     | Excluded: no layout animation or scroll-linked motion; server CPU profiling is a different workload.                                                                                   |
| `12-principles-of-animation`    | Excluded: no animation timing, easing, staging or physics.                                                                                                                             |
| `emil-design-eng`               | Excluded: no component polish, gesture or motion design.                                                                                                                               |
| `make-interfaces-feel-better`   | Excluded: no typography styling, surface treatment, hover or visual micro-interaction.                                                                                                 |
| `modern-web-guidance`           | Excluded from its frontend trigger: this pass changes library Markdown and backend transport explanations, not HTML/CSS or client-side UI code.                                        |
| `vercel-composition-patterns`   | Excluded: no React components, render props or component context. Generic library composition is governed by `build-libraries`.                                                        |
| `vercel-react-best-practices`   | Excluded: no React/Next renderer, data-fetching waterfall or re-render contract.                                                                                                       |
| `vercel-react-native-skills`    | Excluded: no Expo, React Native, mobile lists or native UI modules.                                                                                                                    |
| `vercel-react-view-transitions` | Excluded: no React ViewTransition, browser navigation animation or shared-element motion.                                                                                              |
| `web-design-guidelines`         | Excluded: no rendered UI review. Its current routing points to `./AGENTS.md`; it must not be treated as a fetched upstream web policy or applied to this server library by name alone. |

## Top-level guide disposition

All nine root Markdown guides are accounted for. Current engineering standards take precedence over historical examples,
while current implementation decides what exists.

| Guide                                                         | Applied decision or exclusion                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `okikio-engineering-standards-20260819.md`                    | Governs authority, placement, import safety, borrowed resources, cancellation versus disposal, observation versus authority, schemas/types, deliberate exports, plain prose, scoped formatting and layered evidence. Source findings were corrected without changing API architecture.                                  |
| `library_first_architecture_guidebook.md`                     | Governs use-case-first public examples, focused adoption, arrays versus streams, optional integrations, narrow lifetimes and recovery taxonomy. Definitions and facades do not imply provider startup. Artifact and workload proof remains separate from source shape.                                                  |
| `kaiju-naming-and-folder-structure-guide.md`                  | Applied with local layout: coherent operation namespaces may shorten runtime calls; schema/type imports stay direct where appropriate. Existing focused packages are not mechanically moved into nested `src/` folders. No speculative rename or compatibility alias was added.                                         |
| `kaiju-code-formatting-guide.md`                              | Applied: narrow semantic Markdown patches preserve existing wrapping and runnable blocks. No repository-wide mechanical rewrite accompanies the corrections.                                                                                                                                                            |
| `kaiju-readable-markdown-plain-technical-english-handbook.md` | Applied: complete example first, gradual explanations, defined terminology, connected ownership and failure prose, intact Markdown fences. Its formal controlled dictionary and sentence word limits are not default library requirements.                                                                              |
| `how-to-justify-decisions-properly.md`                        | Applied: each correction names a concrete false/stale statement and controlling contract. Optimizations protect behavior first; source-based removable work does not establish a speed guarantee. Shared middleware and proxy comparisons must preserve the same inputs and explicitly record stronger ownership costs. |
| `cli-guidelines-audit-and-expansion.md`                       | Limited: library results and telemetry are not CLI stdout/stderr products. Applications own grammar, configuration discovery, prompts, logging setup, signals and consent. No Optique/c12/defu layer is introduced into utility imports.                                                                                |
| `prd-guide.md`                                                | Limited: outcome, consumers, acceptance, risks and exclusions inform this review. No new product PRD or roadmap is necessary for correcting public documentation.                                                                                                                                                       |
| `general-skill-list.md`                                       | Catalog/composition authority: one discovery pass, domain owners and one final verdict. Its skill-evaluation commands qualify a skills repository, not Utils; no claim that Utils ran those evals.                                                                                                                      |

## Library documentation and workflow review

The documentation surface contains the root README and 52 package/subpath READMEs. This pass reviewed their opening
contracts, progressive usage, ownership/recovery statements and comparison vocabulary, with deeper export/runtime
inspection for the findings above. The table accounts for every package guide without claiming a new exhaustive source
or test audit. Existing executable examples remain the acceptance mechanism; prose counts are not a gate.

| Package README group                                                                                        | Reviewed behavior and disposition                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity`, `capacity`, `concurrency`, `context`, `pool`, `queue`, `resource`, `task`, `worker`, `workflow` | Preserve declared operations versus live execution, cooperative cancellation, owned/borrowed lifetimes and bounded admission. Context timeout creates a child owner, not a callback runner. Queue/history examples explicitly retain state only in memory. No additional durable provider was invented. |
| `catalog`, `codec`, `env`, `failure`, `fault`, `query`, `record`, `result`, `schema`                        | Preserve exact definition identity, schema validation, transformed values, expected failure versus diagnostics, query descriptions versus provider execution, shallow wrapping and application redaction. Environment's stale table operation was corrected.                                            |
| `effect`, `entitlement`, `meter`, `permission`, `requirement`, `resilience`, `telemetry`                    | Preserve declaration versus enforcement/delivery, application-owned interpreters, stable effect keys, explicit retry/idempotency limits and observation without terminal authority. No policy definition is described as provider acceptance.                                                           |
| `css`, `csv`, `email`, `html`, `robots`, `sitemap`, `streams`, `version`                                    | Preserve parser output versus acquisition/product policy, collecting versus incremental consumption, input budgets, source evidence and exact version scheme semantics. Parser success is not browser execution, mailbox verification, network acquisition or trusted software identification.          |
| `deno`, `dispose`, `duration`, `process`, `utils`                                                           | Preserve explicit runtime adapters, local ponyfills versus global installation, selective public entries, output capture bounds and native ownership. Duration provider identity and process reaping ownership were corrected.                                                                          |
| `hono`, `http`, `server`                                                                                    | Preserve reusable protocol/service owners versus framework adapter and executable listener. A native Fetch handler can be composed without asserting production-network or renderer equivalence.                                                                                                        |
| `http/cookie`, `http/problem`, `http/request`, `http/response`, `http/webhook`                              | Preserve signed raw bytes, bounded request reads, distinct repeated cookies, declared responses, public problem data and application-owned access/replay policy.                                                                                                                                        |
| `server/endpoint`, `server/gateway`, `server/http`, `server/middleware`, `server/service`                   | Preserve imported contracts, compile-time preparation, request-local state and trust decisions. Gateway's completion and transport assumptions were updated. Runtime and adapter gates remain the executable proof owner.                                                                               |

The root CSV example produces normalized keys and original string cells immediately; the bounded import composition adds
streaming, schema validation and bounded callbacks only when those mechanisms are needed. The local workflow example
produces `hello` through declared activity dispatch and in-memory stores. Neither example is promoted to a deployed
database import or persistent process-loss recovery. These are concrete consumer-oriented explanations, not a
requirement that ordinary parsing construct a workflow engine.

The current architecture, outcome and runtime explanations were reviewed in `composition.md`, `outcomes.md`,
`runtime.md`, `server.md` and `comparison.md`. Historical comparison provenance and counts remain dated. No benchmark,
tool or test implementation was edited in this pass; their standards review belongs to the parallel owner.

## Validation and completion boundary

The coordinating owner subsequently assigned a separate production review of eight families: workflow, activity, worker,
process (including channel), context, queue, CSV and query. This review traced the dirty changes and current
cancellation/admission, timing, fencing, cleanup, parser occurrence and query-capability paths. It includes the new CSV
engine modules and split query modules rather than treating untracked source as generated debris. It does not replace
strict inference controls, runtime execution, persistent recovery qualification or native process-host checks.

| Family/control path                                                      | Review disposition                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Context creation, clock waits and disposal                               | Found a pre-existing early-expiry defect for deadlines beyond the native timer maximum. Authorized correction rechecks the absolute deadline after each bounded slice and joins the deadline task at disposal. Contexts without a deadline retain a synchronous finalizer.                                         |
| Process channels, framed admission and child controls                    | Found pre-existing parent same-ID admission races and child validation blocking cancel/close frames. Authorized correction reserves IDs/lifetimes before external validation, observes validation under cancellation, and leaves the child frame reader available for controls.                                    |
| CSV engine, collection/stream parsing and occurrence metadata            | Found a regression from dropping empty physical records inside the selected parser engine. Authorized correction retains those records until structural output policy, preserving source coordinates while blank output remains skipped by default.                                                                |
| Workflow executor/provider cancellation                                  | Found pre-existing unobserved asynchronous cancellation-hook rejection. Authorized correction retains hook promises separately from fenced provider runs, joins hooks before provider disposal, and reports exact failures through the existing aggregate shutdown error.                                          |
| Workflow dispatch mutation/close waits                                   | Found pre-existing sleeps that survived waiter removal and uncapped long delays that native timers could reduce to immediate retries. Assigned to the separate production owner; this review does not claim that owner's implementation or qualification.                                                          |
| Query effective sort/capability metadata                                 | Found the effective stable tiebreaker could add one order beyond `maximumSorts` while adapter requirements still advertised only the requested budget. Assigned to the coordinating owner; this review does not claim that owner's implementation or qualification.                                                |
| Activity definitions and local/Worker/process/remote transport providers | Traced definition versus live provider ownership, schema boundaries, attempt correlation and cancellation. No additional confirmed defect was reported from those reviewed paths. Provider fencing does not establish external-effect idempotency or deployed recovery.                                            |
| Worker protocol, process runtime/adapters and queue/FIFO                 | Compared reserved Worker admission with channel admission, child status/capture/stop ownership, and queue expiry/waiter ownership. The channel correction reuses the established Worker cancellation pattern. This source review alone cannot qualify native signals, compiler inference or all provider failures. |

The logical-clock context regressions cover two maximum slices plus a remainder, exact expiry timestamps, parent
cancellation at a slice handoff, disposal, zero active waits after close and independent clock failure. Channel gates
cover duplicate parent IDs and cancellation/close during parent admission, child request validation and child response
validation. The gates are released and joined even on failure. CSV regressions use literal logical row coordinates,
blank records, an explicit header after blank preamble, quoted multiline cells and three-byte stream chunks. Executor
regressions replace a host while its old run remains gated, require the replacement result, then check cancellation hook
completion before provider disposal and exact asynchronous/synchronous cleanup failures, including thrown `undefined`.
No elapsed-time thresholds or timing claims were added.

Focused formatting, linting and whitespace checks passed for the separately owned corrections. Their fresh runtime
qualification belongs to the coordinating owner. The native timer limit is supported by the
[Node timer contract](https://nodejs.org/api/timers.html); CSV empty-record behavior is explicit in the
[maintained parser option](https://csv.js.org/parse/options/skip_empty_lines/).

The focused
`git -c core.fsmonitor=false diff --check -- README.md packages/env/README.md packages/duration/README.md
packages/server/gateway/README.md packages/process/README.md`
check passed. A read-only fence scan of all 53 reviewed READMEs found no unclosed fences. That structural check does not
prove code snippets or rendered accessibility. No runnable block changed. Guide and README input hashes, review baseline
copies and structural counts are outside the repository; no generated review debris or temporary dependency source was
added to public package exports.

This documentation and source-review pass ran no runtime suite, compiler, benchmark, artifact build, registry
publication or Git delivery. The coordinating owner must report fresh qualified source/artifact/workload results for the
final snapshot and perform the authorized rebase/merge. Existing reports are evidence for their own recorded revisions,
not proof that this review performed those jobs again. The separately authorized production corrections must receive
focused and final runtime checks before the final delivery verdict.

The coordinating owner subsequently qualified the combined corrections. See
[the closure report](./http-performance-closure-20261007.md) for the final source identity, native test counts, profile
boundaries and paired timing conclusions. The earlier pass-specific limits above remain its original evidence scope.
