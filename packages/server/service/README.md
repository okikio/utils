`@okikio/server/service`
=======================

`@okikio/server/service` compiles one independently deployable HTTP service and
creates its framework-neutral Fetch runtime. The utility knows service
composition, request lifecycle, middleware placement, resource ownership,
resilience staging, and generic requirement dispatch. It does not implement
identity providers, authorization databases, subscriptions, billing ledgers,
quotas, or requirement-family policy.

Definitions preserve every requirement family even when a host does not implement it. Active unknown families reject by
default. Ignoring a family requires an explicit host policy.

```text
static definitions + runtime bindings
                 |
                 v
          service.compile()
                 |
       +---------+----------+
       |                    |
       v                    v
effective operations   generated artifacts
       |                    |
       v                    +-- routes
 service.create()           +-- resource graph
       |                    +-- requirements
       v                    +-- problems/responses
   Fetch runtime            `-- resilience inventory
```

Define, implement, compile, create
----------------------------------

```ts
const EnrichmentService = service.define({
	id: 'enrichment',
	path: '/api/enrichment/v1',
	environment: EnrichmentEnvironment,
	middleware: [RequestDiagnostics],
	resources: [Postgres, ObjectStorage],
	endpoints: [Imports],
	workflows: [ProcessImport],
	requirements: [entitlement.require(Enrichment)],
});

const EnrichmentImplementation = service.implement(EnrichmentService, {
	endpoints: [CreateImportHandler, ListImportsHandler],
	middleware: [RequestDiagnosticsHandler],
	resources: resource.implementations(
		PostgresImplementation,
		ObjectStorageImplementation,
		ImportRepositoryImplementation,
	),
	workflows: [ProcessImportHandler],
});

const compiled = service.compile(EnrichmentImplementation);

await using runtime = service.create(compiled, {
	host: { deploymentId },
	concerns: {
		authenticate,
		requirements: {
			interpreters: {
				permission: permissions.interpreter(permissionChecker),
				entitlement: entitlements.interpreter(entitlementProvider),
			},
			unknown: 'reject',
		},
		resilience: resilienceHost,
	},
});
```

What compilation means
----------------------

Compilation is graph linking and partial evaluation, not TypeScript transpilation. It:

1. flattens endpoint/group/selection trees;
2. calculates full paths;
3. gathers service, policy, group, endpoint, operation, and middleware contributions;
4. closes each resource dependency graph;
5. preserves direct requirements separately from the complete reachable requirement set;
6. normalizes middleware lanes and resilience policies;
7. binds exact imported definitions to exact implementations;
8. rejects missing, duplicate, conflicting, unreachable, or unsafe combinations;
9. produces immutable per-operation plans and JSON-safe manifests.

```text
service definition
  |
  +-- service requirements/resources
  +-- targeted policy requirements/resources
  +-- endpoint/group contributions
  +-- middleware contributions
  `-- reachable resource requirements
                 |
                 v
      EffectiveServiceOperation
                 |
                 +-- handler
                 +-- middleware plan
                 +-- requirements[]             direct admission
                 +-- reachableRequirements[]    runtime declaration scope
                 +-- resource closure
                 +-- response/problem envelope
                 `-- resilience plan
```

Generic requirements
--------------------

Requirements are the extensibility seam. The server compiler preserves them; it does not know what a permission, entitlement,
quota, consent, compliance rule, or future family means. Meters use required effect delivery rather than admission requirements.

A requirement interpreter is supplied under its immutable family name:

```ts
const runtime = service.create(compiled, {
  host,
  concerns: {
    requirements: {
      interpreters: {
        permission: permissions.interpreter(permissionChecker),
        entitlement: entitlements.interpreter(entitlementProvider),
      },
      unknown: 'reject',
    },
  },
});
```

Active requirement families fail closed when no interpreter exists. A host that deliberately treats unknown families as observational metadata can select `unknown: 'ignore'`; omission never silently disables policy.

Compilation keeps each operation's direct requirements separate from its reachable requirements. After input validation, the runtime binds reachable family scopes so a handler can perform dynamic checks such as `permissions.check(ctx, ReadAsset, { assetId })`. It then applies the operation's direct active requirements before the handler runs. A target-bearing permission is therefore available to the handler without being eagerly checked before its concrete target exists.

Configured interpreters receive authored order within each family. The service utility coordinates the lifecycle but does not implement an authorization graph, subscription database, quota ledger, durable effect sink, or provider SDK.

Provider-neutral request state
------------------------------

Identity remains a separate prerequisite because it establishes the actor/request identity used by later requirement families. Application code can specialize `ServiceConcernValues` with exact domain types:

```ts
interface EnrichmentConcerns extends service.ServiceConcernValues {
	readonly authentication: Authentication;
	readonly principal: Principal;
	readonly membership: OrganizationMembership;
	readonly requirements: {
		readonly permission?: Authorization;
		readonly entitlement?: EntitlementSnapshot;
		readonly meter?: UsageObservation;
	};
}
```

The endpoint handler receives the accumulated requirement state without depending on provider SDK sessions.

Request lifecycle
-----------------

```text
raw Request
|
+-- establish request ID, trace, cancellation, absolute deadline
+-- enforce native body limit
|
+-- wholeRequest middleware
|   |
|   +-- beforeValidation middleware
|       |
|       +-- authentication
|       +-- bounded wire parsing
|       +-- Standard Schema validation
|       |
|       +-- afterValidation middleware
|           |
|           +-- admission resilience
|               |
|               +-- requirement-family interpreters
|               |
|               +-- operation resilience
|                   |
|                   +-- aroundOperation middleware
|                       `-- endpoint handler
|
+-- verify returned response/problem definition
+-- validate successful response body
+-- finalize pagination/envelopes/metadata
+-- materialize as native Response
`-- observe body completion/cancel/error
```

Direct requirement interpretation happens after input validation, so a host can evaluate policies against typed request inputs.
Reachable requirements are bound first so a handler can activate a declared target-bearing permission only after the target is
known. Admission happens inside admission resilience and outside operation retries by default, so a retry does not accidentally
duplicate admission-side reservations or policy decisions.

Resources
---------

The service creates one `@okikio/resource` collection from the compiled resource implementations. Resources remain lazy. Handlers and middleware receive narrowed resolvers that expose only the definitions admitted by their compiled operation.

Resource definitions can contribute requirements, but those requirements are not promoted into eager endpoint admission. The
compiled operation records them as reachable. Actor-specific resource requirements run on every public borrow, and concrete
implementation requirements run once during acquisition. This prevents a cached resource created under one actor from being
reused under another actor's authority without a new check.

Injected host/provider resources follow `@okikio/resource` ownership. A concrete resource implementation can own its own handles with `ctx.use()`, `ctx.adopt()`, and `ctx.defer()`. The generic server does not quietly dispose caller-owned external infrastructure unless ownership was transferred through the resource implementation contract.

Resilience
----------

Timeout and body limits are native generic behaviors. Other resilience policies may require a host implementation. Admission and operation stages remain separate so rate/admission controls can surround one request while retries can surround individual operation attempts.

`aroundOperation` middleware is inside operation retry. This lets each retry get a fresh transaction/unit of work instead of reusing a failed transaction.

Validation
----------

| Time | Validation | Examples |
| --- | --- | --- |
| Definition creation | Local authoring invariants | canonical path, non-empty ID, compatible body slots |
| Service compilation | Whole graph integrity | route collisions, missing handlers, resource cycles, conflicting policies |
| Runtime creation | Mandatory host capability coverage | missing authentication or resilience runtime when explicitly required |
| Wire parsing | Bounded HTTP syntax | header bytes, duplicate cookies, malformed JSON, body size |
| Standard Schema | Endpoint input semantics | IDs, dates, enums, transformed query values |
| Requirement stage | Host-selected contract interpretation | permission, entitlement, quota, consent, or another family |
| Handler return | Declared result membership | undeclared problem/response, raw response without opt-in |
| Response body | Output schema | handler produced an invalid payload |
| Transport finalization | Request-aware HTTP behavior | content negotiation, pagination links, conditional response |

Raw responses
-------------

An operation must opt into `rawResponse: true` before its handler may return a native `Response`. Use that for WebSockets, SSE, transparent proxying, byte ranges, or provider-native streams. Ordinary handlers return declared response/problem results so membership, schemas, OpenAPI, and instrumentation remain inspectable.
