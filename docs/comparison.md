# Why the utility copies differ

Standalone Utils reconciles mechanisms that also exist in Core and MediaD. A newer copied file is evidence to inspect,
not authority to replace a different programming model. The retained [2026-10-06 review](./utils-review-20261006.md)
records the exact source revisions, earlier PR states, comparison counts, behavioral probes, and validation limits.
Those historical counts and PR labels describe that review, not a fresh scan or current GitHub status.

The comparison used exact source and normalized TypeScript AST hashes to locate changes. Equal ASTs ignore comments and
formatting; they do not establish dependency identity, runtime compatibility, public export parity, or artifact
behavior. Changed AST counts also include intentionally retained standalone capabilities, so they are not a port queue.
The [comparison JSON](./utils-comparison-20261006.json) retains file identities; the original MediaD analysis is at
`mediad/docs/implementation/utils-review-20261006.md`.

## Retained behavior and deliberate boundaries

| Area                                          | Reconciliation decision and reason                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query                                         | Retained bounded Boolean grammar, lossless URL values, explicit adapter support, and pagination helpers. Kept standalone wire-schema projection; a flat-only adapter must reject unsupported groups.                                                                                                                   |
| CSV                                           | Retained the maintained grammar, source-occurrence/writer features, and ownership fixes. Kept standalone header normalization and explicit header selection. A copy's single-column delimiter policy is a compatibility decision, not an automatic parser fix. Product column roles stay in the importing application. |
| Catalog, requirements, permissions, resources | Retained narrow static lookup/identity features and definition subpaths. Exact imported definitions remain authoritative; runtime permission interpretation, resource acquisition, and application policy remain with their existing owners.                                                                           |
| Task, fault, process, disposal                | Retained narrow fixes for thrown `undefined`, native error names, termination/output settlement, and cleanup precedence, then qualified them against standalone contracts. Copied validation receipts are provenance, not standalone proof.                                                                            |
| Worker and pool                               | Preserved standalone admission, clock, cancellation, and ownership architecture. Standalone qualification found additional admission/health-check/drain races and repaired their actual owner.                                                                                                                         |
| HTTP and server                               | Retained bounded transport/forwarding behavior and attachment disposition. Preserved prepared routing, mount behavior, effect declarations, observer contracts, and independent Fetch/service ownership instead of adopting a wholesale service/concern reshape.                                                       |
| Resilience and duration                       | Preserved inspectable policy owner/stage, retry/idempotency boundaries, and explicit time/global setup. Draft polling's limited tests did not justify adding cadence, retry, cancellation, or fairness guarantees.                                                                                                     |
| Standalone parsers and composition utilities  | Preserved concurrency, HTML, CSS, robots, sitemap, telemetry, version, and installation exports. Their absence in a copy is not a proposal to delete them.                                                                                                                                                             |

## Capabilities not copied wholesale

The earlier review treated endpoint-owned HTTP clients, roles, AWS signing, internal gateway policy, optional schema
adapters, and the uncommitted polling draft as separate capabilities. Endpoint clients need a deliberate public API and
stream/lifetime integration. Signing needs protocol oracles and reviewed trust policy. Polling needs cadence,
cancellation, exhaustion, and fairness qualification. Renamed schema aliases alone add no independent behavior.

Account enrichment, research, billing, permissions policy, provider choice, and global logging configuration remain
application concerns. A utility can expose the neutral mechanism those applications use without importing their domain
tables, SDK selection, or deployment configuration.

Use the full historical review when tracing a specific delta. Use [the scenario catalogue](./scenarios.md) for current
qualification intent and [composition](./composition.md) for executable public-import examples. A future reconciliation
must recheck the exact revisions and observable contract before replacing any retained decision.

## Refresh of source and PR provenance

The 2026-10-07 read-only refresh compared standalone `0b06c4985316b01a51e85a36b55ce84404f33262`, Core
`b29f327b2db5f926ff62f12235c52dc954c37750`, and MediaD `7fa950b15e336eb9e181ad205c33ec14ca6a388a`, including their
working files. Against the retained comparison, MediaD had no source delta; Core removed its Hono module and test. There
was no additional changed Core production AST to port. Standalone retains the Hono adapter because it provides an
independently useful Fetch middleware seam and now has direct-Hono benchmark and consumer coverage. A copy removing an
adapter does not invalidate that standalone capability.

The latest 20 Core PR file lists were checked through authenticated read-only GitHub access. The newer account/frontend
and repository-boundary PRs contain no direct `utils/` changes. Utility changes remain in the previously reviewed
[#290](https://github.com/Kaiju-Ind/Core/pull/290)/[#288](https://github.com/Kaiju-Ind/Core/pull/288),
[#276](https://github.com/Kaiju-Ind/Core/pull/276), the one server fixture in
[#286](https://github.com/Kaiju-Ind/Core/pull/286), and the older [#282](https://github.com/Kaiju-Ind/Core/pull/282)
client/resource draft. That draft overlaps the deliberate endpoint-client boundary described above; it supplies no
reason to copy a different runtime owner wholesale.

All 13 currently open Core PRs were also enumerated to catch active work outside that latest-20 window. The five older
open PRs, #273, #268, #259, #256 and #255, contain no direct `utils/` changes. Their evidence, research and frontend
changes remain application behavior rather than additional utility ports.

The still-open [#279](https://github.com/Kaiju-Ind/Core/pull/279) also contains the process output-settlement and denied
signal changes. Its concrete invariant is useful: a denied shutdown signal proves no exit until adapter status confirms
it, and cleanup must join termination without repeating a handled output-limit error. Standalone already retains those
behaviors in its existing Process owner, with deterministic status/signal gates and native Node regressions. Keeping the
behavior does not require copying Core's closure implementation or its real-time test delays.
