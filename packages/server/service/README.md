`@okikio/server/service`
=======================

`@okikio/server/service` compiles one independently deployable HTTP service and
creates its framework-neutral Fetch runtime. The compiler resolves endpoint
contracts, middleware order, resources, requirements, effects, resilience,
observers, and route ownership before traffic starts.

The package coordinates these parts. It does not implement provider identity,
a permission graph, a billing ledger, a metrics backend, or a rate-limit store.
The application supplies those live capabilities through explicit runtime
adapters, resources, effect emitters, and observer handlers.

Define, implement, compile, create
----------------------------------

A service has four separate steps. Definitions stay import-safe. Implementations
bind runtime behavior. Compilation resolves the complete service graph. Runtime
creation acquires service resources and returns a Fetch handler.

~~~~ typescript
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
  adapters: {
    authenticate,
    requirements: {
      interpreters: {
        permission: permission.interpreter(permissionChecker),
        entitlement: entitlement.interpreter(entitlementProvider),
      },
      unknown: 'reject',
    },
    resilience: resilienceAdapter,
  },
});
~~~~

Service extensions
------------------

A *service extension* is a reusable mechanism that adds policy, runtime data,
required consequences, observation, or execution behavior without moving that
behavior into endpoint business logic. Some extension mechanisms are direct
compiler inputs. Others attach typed capabilities to the execution context.

| Extension mechanism | What it means | Typical examples |
| ------------------- | ------------- | ---------------- |
| Request values | Typed application values added while a request runs | authentication, principal, membership |
| Requirements | Open families of rules that can become active | permission, entitlement, quota, consent, compliance |
| Effects | Typed announcements that an externally visible side effect occurred | usage event, meter reading, billing outbox record |
| Observers | Non-authoritative lifecycle observation | metrics, logs, traces |
| Resilience | Request protection and failure behavior | timeout, idempotency, rate limit, retry |
| Resources | Live runtime capabilities | graph client, database, cache, billing ledger |
| Query contracts | Dedicated request/data contracts | filters, sorting, fieldsets, pagination |

These mechanisms can grow independently. A new permission model implements the
existing `permission` requirement family instead of adding a server field. A new
metrics exporter handles observer events instead of becoming request policy. A
	usage meter announces an effect instead of pretending that measurement is an
admission check. Query stays a dedicated endpoint/data contract because its
parsing and generated documentation have different semantics again.

A future capability that does not fit one of these mechanisms should define its
own contract and lifecycle explicitly. The compiler can then add that extension
class without turning all extensions into one generic runtime object.

### Adding a new extension class

Before adding a service-level field, determine whether an existing mechanism has
the required semantics. A new graph authorization provider is a permission
interpreter. A new usage sink is an effect owner. A new metrics exporter is an
observer handler. A new cache or database client is a resource.

Add a new extension class only when those semantics are insufficient. The new
class should provide:

 -  an import-safe definition or contract
 -  a composition rule across service, policy, group, path, and operation when
    those locations are relevant
 -  compiler validation and provenance
 -  deterministic manifest/documentation data
 -  one explicit runtime ownership model
 -  tests for ordering, failure, cancellation, and missing runtime behavior

Do not add an arbitrary callback to `adapters` only to avoid defining the
semantics. Runtime adapters execute compiler-known contracts. They do not replace
the compiler's contract model.

Runtime adapters and request values
-----------------------------------

`ServiceRuntimeAdapters` contains live behavior that the generic server must call
during request execution. The current adapters are authentication, requirement
	interpretation, optional effect ownership, and adapter-owned resilience.

Authentication can add provider-neutral request values. Endpoint handlers keep
the exact application types without depending on a provider SDK.

~~~~ typescript
interface EnrichmentRequestValues extends service.ServiceRequestValues {
  readonly authentication: Authentication;
  readonly principal: Principal;
  readonly membership: OrganizationMembership;
  readonly requirements: {
    readonly permission?: Authorization;
    readonly entitlement?: EntitlementSnapshot;
  };
}

const CreateImportHandler = endpoint.handler<
  typeof CreateImport,
  endpoint.EmptyEndpointHost,
  EnrichmentRequestValues
>(CreateImport, async ({ principal, membership, input }) => {
  // principal and membership retain their application types here.
  return ImportResponses.Accepted.create(...);
});
~~~~

The runtime stores these values separately from the middleware context store.
`requestValues` contains typed application values. `values` remains the
identity-keyed middleware context store. Runtime adapters cannot replace the
Request, host, validated input, resource resolver, execution context, or compiled
operation.

Requirements and complex permission models
------------------------------------------

Requirements are the open policy-family mechanism. The compiler preserves the
family, action, exact definition identity, and where the requirement came from.
It does not implement the policy engine.

A permission interpreter can therefore use any authorization model:

 -  a local role or ACL check
 -  a database-backed object permission table
 -  a relationship graph
 -  Zanzibar-style tuples
 -  SpiceDB or another remote graph service
 -  a product-specific evaluator

The endpoint contract remains the same:

~~~~ typescript
requirements: [
  permission.require(AccountPermissions.Read),
]
~~~~

The composition root supplies the interpreter:

~~~~ typescript
adapters: {
  requirements: {
    interpreters: {
      permission: permission.interpreter(graphPermissionChecker),
    },
    unknown: 'reject',
  },
}
~~~~

Direct requirements apply before the endpoint operation runs. Reachable
requirements describe rules that a declared resource or handler path can activate
later when the concrete target becomes known. This distinction allows an object
permission check to wait for an object ID without removing the requirement from
the compiled service contract.

Effects, usage, and billing
---------------------------

An effect declares that code in an execution may announce an externally visible
side effect. The declaration does not mean every request produces that effect.
Calling `effect.emit()` announces one occurrence and requires an authoritative
effect owner to accept responsibility.

~~~~ typescript
const UsageCommitted = effect.define({
  id: 'usage.committed',
  value: UsageCommittedSchema,
});

const EnrichCompany = endpoint.post({
  id: 'companies.enrich',
  path: '/companies/:companyId/enrich',
  effects: [UsageCommitted],
  responses: [Accepted],
});

const EnrichCompanyHandler = endpoint.handler(EnrichCompany, async ({ ctx, input }) => {
  const result = await enrichCompany(input.param.companyId);

  await effect.emit(ctx, UsageCommitted, { units: result.units }, {
    key: `${result.researchId}:usage`,
  });

  return response.create(Accepted, result);
});
~~~~

The compiler carries exact effect definitions from service, policy, group, path,
operation, and middleware contributions into each effective operation. A service
can start without `adapters.effect` because a declaration only says that runtime
code may announce an effect. An actual `effect.emit()` still requires an emitter,
and emitting an undeclared effect still fails.

`@okikio/meter` announces measurements through `@okikio/effect`. Billing, usage,
audit, notification, or webhook-delivery systems can own those announcements
without becoming generic service callbacks.

Retry safety depends on the occurrence key. Retries representing the same logical
side effect must reuse the same key so a durable owner can deduplicate it.

Effect acceptance does not make a domain mutation and an outbox write atomic. If
they must commit together, the application must use one transaction or another
authoritative handoff that covers both.

Observers, metrics, and logging
-------------------------------

Observers receive credential-free lifecycle events. They are observational.
An observer failure cannot change the service response, cancellation, or cleanup.

~~~~ typescript
const Diagnostics = service.observer.define({
  id: 'enrichment.diagnostics',
  description: 'Observe enrichment request lifecycle.',
});

await using runtime = service.create(compiled, {
  host,
  observers: [serverTelemetry.service(Diagnostics, telemetryScope)],
});
~~~~

The event sequence distinguishes response headers from body completion:

~~~~ text
started
   |
   +--> failed                 execution failed before a response
   |      |
   |      `--> response        server produced a problem response
   |
   `--> response              response headers are ready
           |
           +--> completed      response body reached EOF
           +--> aborted        consumer cancelled the body
           `--> failed         response body errored
~~~~

Metrics, logs, and traces can derive from these events without becoming
application authorization or billing authority.

Resilience
----------

Resilience has two independent dimensions.

| Question | Values | Meaning |
| -------- | ------ | ------- |
| Who executes the policy? | `server`, `adapter` | Whether the generic server has enough state to execute it itself |
| When does the policy run? | `request`, `admission`, `operation` | Which part of the request lifecycle the policy protects |

`@okikio/resilience` exposes `owner(policy)` and `stage(policy)` so tooling can
inspect both dimensions. The [resilience package](../../resilience/README.md)
contains the full policy map.

Request lifecycle
-----------------

The service runtime uses this order:

~~~~ text
Request
  |
  +-- request correlation and deadline
  +-- server-owned request resilience
  |     body limit / timeout
  |
  +-- wholeRequest middleware
  |     |
  |     +-- beforeValidation middleware
  |           |
  |           +-- authentication adapter
  |           +-- bounded HTTP parsing
  |           +-- Standard Schema validation
  |           |
  |           +-- afterValidation middleware
  |                 |
  |                 +-- adapter-owned admission resilience
  |                 |     idempotency / rate limit / bulkhead
  |                 |
  |                 +-- direct requirement interpretation
  |                 |
  |                 +-- adapter-owned operation resilience
  |                       retry / circuit breaker
  |                       |
  |                       +-- aroundOperation middleware
  |                             transaction / unit of work
  |                             |
  |                             `-- endpoint handler
  |
  +-- verify declared response or problem
  +-- validate successful response body
  +-- create the native Response
  `-- observe body completion, cancellation, or failure
~~~~

Admission resilience runs once for the logical HTTP request. Operation resilience
wraps endpoint execution. A retry can therefore recreate `aroundOperation`
middleware for each attempt without repeating authentication or direct
requirement interpretation.

What compilation means
----------------------

Compilation is graph linking and partial evaluation. It does not transpile
TypeScript.

The compiler:

1.  Flattens endpoint groups, selections, and endpoint definitions.
2.  Calculates canonical service paths.
3.  Merges service, policy, group, endpoint, and operation contributions.
4.  Resolves the complete resource graph.
5.  Keeps direct requirements separate from reachable requirements.
6.  Resolves exact effect declarations available to each execution.
7.  Normalizes middleware and resilience plans.
8.  Binds exact imported definitions to exact runtime implementations.
9.  Rejects missing, duplicate, conflicting, unreachable, or unsafe contracts.
10. Produces immutable operation plans and JSON-safe service artifacts.

Each effective operation contains the handler, middleware plan, request inputs,
requirements, effect declarations, resource closure, response/problem definitions,
and prepared resilience execution plan. Request execution consumes that prepared data instead
of rediscovering policy on every request.

Host and listener ownership
---------------------------

`service.create()` owns service resources and request contexts. It does not bind
a network port.

~~~~ text
service.create()
    |
    +--> routes
    +--> fetch
    +--> resources
    `--> asyncDispose
             |
             v
       Deno / Node / edge host
             |
             v
        network listener
~~~~

The deployment host owns listener startup and shutdown. Disposing the service
runtime releases service-owned resources.

Validation
----------

| Time | What is checked |
| ---- | --------------- |
| Definition creation | Local IDs, paths, and request-contract invariants |
| Service compilation | Route conflicts, missing handlers, resource cycles, policy conflicts |
| Runtime creation | Configured adapters, optional effect owner, and observer handlers |
| HTTP parsing | Header, cookie, query, form, JSON, and body-size limits |
| Standard Schema | Request values and schema transformations |
| Requirement interpretation | Permission, entitlement, quota, consent, or another active family |
| Handler return | Declared response/problem membership |
| Response validation | Output schema and transport representation |

Raw responses
-------------

An operation must set `rawResponse: true` before its handler can return a native
`Response`. Use raw responses for protocols such as SSE, WebSockets, transparent
proxying, and provider-native streams. Ordinary endpoints should return declared
response/problem values so validation, OpenAPI, generated clients, and observers
remain inspectable.
