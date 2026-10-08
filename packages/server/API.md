# @okikio/server contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                               | Source                                               | Reference                                   |
| ------------------------------------ | ---------------------------------------------------- | ------------------------------------------- |
| `@okikio/server`                     | [./mod.ts](./mod.ts)                                 | [root](#root)                               |
| `@okikio/server/endpoint`            | [./endpoint/mod.ts](./endpoint/mod.ts)               | [endpoint](#endpoint)                       |
| `@okikio/server/endpoint/definition` | [./endpoint/definition.ts](./endpoint/definition.ts) | [endpoint-definition](#endpoint-definition) |
| `@okikio/server/endpoint/handler`    | [./endpoint/handler.ts](./endpoint/handler.ts)       | [endpoint-handler](#endpoint-handler)       |
| `@okikio/server/endpoint/openapi`    | [./endpoint/openapi.ts](./endpoint/openapi.ts)       | [endpoint-openapi](#endpoint-openapi)       |
| `@okikio/server/endpoint/path`       | [./endpoint/path.ts](./endpoint/path.ts)             | [endpoint-path](#endpoint-path)             |
| `@okikio/server/endpoint/types`      | [./endpoint/types.ts](./endpoint/types.ts)           | [endpoint-types](#endpoint-types)           |
| `@okikio/server/gateway`             | [./gateway/mod.ts](./gateway/mod.ts)                 | [gateway](#gateway)                         |
| `@okikio/server/gateway/definition`  | [./gateway/definition.ts](./gateway/definition.ts)   | [gateway-definition](#gateway-definition)   |
| `@okikio/server/gateway/types`       | [./gateway/types.ts](./gateway/types.ts)             | [gateway-types](#gateway-types)             |
| `@okikio/server/http`                | [./http/mod.ts](./http/mod.ts)                       | [http](#http)                               |
| `@okikio/server/http/router`         | [./http/router.ts](./http/router.ts)                 | [http-router](#http-router)                 |
| `@okikio/server/http/types`          | [./http/types.ts](./http/types.ts)                   | [http-types](#http-types)                   |
| `@okikio/server/middleware`          | [./middleware/mod.ts](./middleware/mod.ts)           | [middleware](#middleware)                   |
| `@okikio/server/middleware/types`    | [./middleware/types.ts](./middleware/types.ts)       | [middleware-types](#middleware-types)       |
| `@okikio/server/service`             | [./service/mod.ts](./service/mod.ts)                 | [service](#service)                         |
| `@okikio/server/service/definition`  | [./service/definition.ts](./service/definition.ts)   | [service-definition](#service-definition)   |
| `@okikio/server/service/resilience`  | [./service/resilience.ts](./service/resilience.ts)   | [service-resilience](#service-resilience)   |
| `@okikio/server/service/types`       | [./service/types.ts](./service/types.ts)             | [service-types](#service-types)             |

## root

Import `@okikio/server`. [Source](./mod.ts).

Compose a portable fetch application from route and middleware values. A large if chain mixes routing, exception mapping
and security headers, making it hard to mount the same service on another host.

Start with Web Request/Response routes, then move stable schemas into endpoint definitions and bind implementations
through services. A gateway composes host services; an explicit Deno or framework adapter starts the listener.
Definitions do not create connections. Middleware and response bodies have real ownership and cancellation costs, so
choose buffering only for bounded payloads.

### root: ServerProblems

[Declaration source](problems.ts#L3)

```text
const ServerProblems
  Framework-level public and internal problems contributed by the service compiler.
```

### root: endpoint

[Declaration source](mod.ts#L19)

````text
namespace endpoint
  Describe a route from input and response contracts before a handler or provider starts.

  Bind the exact Health definition with endpoint.handler(), then compile its service. Domain schemas remain authoritative for coercion and validation; endpoint wire projections describe what clients actually send.

  @example
      ```ts
      import '@okikio/duration/polyfill';
      import '@okikio/dispose/polyfill';
      import * as endpoint from '@okikio/server/endpoint';
      import * as response from '@okikio/http/response';
      import * as service from '@okikio/server/service';
      import { z } from 'zod';
      const Healthy = response.ok(z.object({ ok: z.boolean() }), { id: 'health.ok', description: 'Service health.' });
      const Health = endpoint.get({ id: 'health.read', path: '/health', responses: [Healthy] });
      const Api = service.define({ id: 'health-api', path: '/api', endpoints: [Health] });
      console.log(Health.path, Api.path);
      ```

  @module

  reference compose: ./packages/server/endpoint/mod.ts:22:3
  reference define: ./packages/server/endpoint/mod.ts:23:3
  reference delete: ./packages/server/endpoint/mod.ts:24:3
  reference document: ./packages/server/endpoint/mod.ts:25:3
  reference get: ./packages/server/endpoint/mod.ts:26:3
  reference group: ./packages/server/endpoint/mod.ts:27:3
  reference head: ./packages/server/endpoint/mod.ts:28:3
  reference input: ./packages/server/endpoint/mod.ts:29:3
  reference isInput: ./packages/server/endpoint/mod.ts:30:3
  reference match: ./packages/server/endpoint/mod.ts:31:3
  reference operation: ./packages/server/endpoint/mod.ts:32:3
  reference options: ./packages/server/endpoint/mod.ts:33:3
  reference patch: ./packages/server/endpoint/mod.ts:34:3
  reference post: ./packages/server/endpoint/mod.ts:35:3
  reference put: ./packages/server/endpoint/mod.ts:36:3
  reference schemaOf: ./packages/server/endpoint/mod.ts:37:3
  reference select: ./packages/server/endpoint/mod.ts:38:3
  reference validate: ./packages/server/endpoint/mod.ts:39:3
  reference handler: ./packages/server/endpoint/mod.ts:41:10
  reference handlers: ./packages/server/endpoint/mod.ts:41:19
  reference joinPath: ./packages/server/endpoint/mod.ts:42:10
  reference normalizePathTemplate: ./packages/server/endpoint/mod.ts:42:20
  reference pathParameters: ./packages/server/endpoint/mod.ts:42:43
  reference AnyEndpointHandler: ./packages/server/endpoint/mod.ts:44:3
  reference AnyEndpointHandlerBinding: ./packages/server/endpoint/mod.ts:45:3
  reference EmptyEndpointHost: ./packages/server/endpoint/mod.ts:46:3
  reference EndpointCompositionInput: ./packages/server/endpoint/mod.ts:47:3
  reference EndpointContext: ./packages/server/endpoint/mod.ts:48:3
  reference EndpointContributions: ./packages/server/endpoint/mod.ts:49:3
  reference EndpointDefinition: ./packages/server/endpoint/mod.ts:50:3
  reference EndpointDefinitionInput: ./packages/server/endpoint/mod.ts:51:3
  reference EndpointDocument: ./packages/server/endpoint/mod.ts:52:3
  reference EndpointDocumentation: ./packages/server/endpoint/mod.ts:53:3
  reference EndpointEntry: ./packages/server/endpoint/mod.ts:54:3
  reference EndpointExample: ./packages/server/endpoint/mod.ts:55:3
  reference EndpointGroup: ./packages/server/endpoint/mod.ts:56:3
  reference EndpointGroupInput: ./packages/server/endpoint/mod.ts:57:3
  reference EndpointGroupMembers: ./packages/server/endpoint/mod.ts:58:3
  reference EndpointGroupSelection: ./packages/server/endpoint/mod.ts:59:3
  reference EndpointHandler: ./packages/server/endpoint/mod.ts:60:3
  reference EndpointHandlerBinding: ./packages/server/endpoint/mod.ts:61:3
  reference EndpointHandlerContext: ./packages/server/endpoint/mod.ts:62:3
  reference EndpointHandlerResult: ./packages/server/endpoint/mod.ts:63:3
  reference EndpointHandlerSet: ./packages/server/endpoint/mod.ts:64:3
  reference EndpointInput: ./packages/server/endpoint/mod.ts:65:3
  reference EndpointInputSchema: ./packages/server/endpoint/mod.ts:66:3
  reference EndpointInputSlot: ./packages/server/endpoint/mod.ts:67:3
  reference EndpointInputSlots: ./packages/server/endpoint/mod.ts:68:3
  reference EndpointInputSource: ./packages/server/endpoint/mod.ts:69:3
  reference EndpointMethod: ./packages/server/endpoint/mod.ts:70:3
  reference EndpointOperation: ./packages/server/endpoint/mod.ts:71:3
  reference EndpointOperationDocument: ./packages/server/endpoint/mod.ts:72:3
  reference EndpointOperationInput: ./packages/server/endpoint/mod.ts:73:3
  reference EndpointRequestValues: ./packages/server/endpoint/mod.ts:74:3
  reference EndpointResourceDefinition: ./packages/server/endpoint/mod.ts:75:3
  reference EndpointResourceResolver: ./packages/server/endpoint/mod.ts:76:3
  reference EndpointResources: ./packages/server/endpoint/mod.ts:77:3
  reference EndpointResourceValue: ./packages/server/endpoint/mod.ts:78:3
  reference EndpointRuntimeInputValues: ./packages/server/endpoint/mod.ts:79:3
  reference EndpointSchema: ./packages/server/endpoint/mod.ts:80:3
  reference EndpointValidationIssue: ./packages/server/endpoint/mod.ts:81:3
  reference EndpointValidationResult: ./packages/server/endpoint/mod.ts:82:3
  reference ErasedEndpointHandlerContext: ./packages/server/endpoint/mod.ts:83:3
  reference InferEndpointInputs: ./packages/server/endpoint/mod.ts:84:3
  reference InferEndpointWireInputs: ./packages/server/endpoint/mod.ts:85:3
  reference MergeEndpointInputs: ./packages/server/endpoint/mod.ts:86:3
  reference PickEndpointInputSlots: ./packages/server/endpoint/mod.ts:87:3
  reference SingleMethodEndpointInput: ./packages/server/endpoint/mod.ts:88:3
  reference openapi: ./packages/server/endpoint/mod.ts:91:10
  reference OpenApiDocument: ./packages/server/endpoint/mod.ts:93:3
  reference OpenApiOptions: ./packages/server/endpoint/mod.ts:94:3
  reference OpenApiSchemaProjectionContext: ./packages/server/endpoint/mod.ts:95:3
  reference OpenApiSchemaProjector: ./packages/server/endpoint/mod.ts:96:3
  reference OpenApiServer: ./packages/server/endpoint/mod.ts:97:3
````

### root: gateway

[Declaration source](mod.ts#L21)

````text
namespace gateway
  Derive upstream route ownership from an imported service contract without copying route strings.

  Compilation does not start the upstream service or fetch the origin. Add credential, timeout and redirect policies explicitly before creating the gateway runtime. Service authorization remains with the service; an edge policy does not grant domain permissions.

  @example
      ```ts
      import '@okikio/duration/polyfill';
      import '@okikio/dispose/polyfill';
      import * as endpoint from '@okikio/server/endpoint';
      import * as response from '@okikio/http/response';
      import * as service from '@okikio/server/service';
      import { z } from 'zod';
      const Healthy = response.ok(z.object({ ok: z.boolean() }), { id: 'health.ok', description: 'Service health.' });
      const Health = endpoint.get({ id: 'health.read', path: '/health', responses: [Healthy] });
      const Api = service.define({ id: 'health-api', path: '/api', endpoints: [Health] });
      import * as gateway from '@okikio/server/gateway';
      const Edge = gateway.define({ id: 'edge', services: [gateway.mount(Api, { origin: 'https://upstream.invalid' })] });
      const compiled = gateway.compile(Edge);
      console.log(compiled.routes[0]?.path, compiled.routes[0]?.credentials.requestCookies);
      ```

  @module

  reference compose: ./packages/server/gateway/mod.ts:25:3
  reference credentials: ./packages/server/gateway/mod.ts:26:3
  reference define: ./packages/server/gateway/mod.ts:27:3
  reference mount: ./packages/server/gateway/mod.ts:28:3
  reference noStore: ./packages/server/gateway/mod.ts:29:3
  reference observer: ./packages/server/gateway/mod.ts:30:3
  reference passThroughCache: ./packages/server/gateway/mod.ts:31:3
  reference policy: ./packages/server/gateway/mod.ts:32:3
  reference redirects: ./packages/server/gateway/mod.ts:33:3
  reference select: ./packages/server/gateway/mod.ts:34:3
  reference compile: ./packages/server/gateway/mod.ts:36:10
  reference document: ./packages/server/gateway/mod.ts:36:19
  reference GatewayCompilationError: ./packages/server/gateway/mod.ts:36:29
  reference validate: ./packages/server/gateway/mod.ts:36:54
  reference create: ./packages/server/gateway/mod.ts:37:10
  reference match: ./packages/server/gateway/mod.ts:37:18
  reference prepare: ./packages/server/gateway/mod.ts:37:25
  reference GatewayProblems: ./packages/server/gateway/mod.ts:38:10
  reference CompiledGateway: ./packages/server/gateway/mod.ts:40:3
  reference CompiledGatewayRoute: ./packages/server/gateway/mod.ts:41:3
  reference CompileGatewayOptions: ./packages/server/gateway/mod.ts:42:3
  reference CreateGatewayOptions: ./packages/server/gateway/mod.ts:43:3
  reference GatewayCachePolicy: ./packages/server/gateway/mod.ts:44:3
  reference GatewayCredentialPolicy: ./packages/server/gateway/mod.ts:45:3
  reference GatewayDefinition: ./packages/server/gateway/mod.ts:46:3
  reference GatewayDefinitionInput: ./packages/server/gateway/mod.ts:47:3
  reference GatewayManifest: ./packages/server/gateway/mod.ts:48:3
  reference GatewayMetadataHeaders: ./packages/server/gateway/mod.ts:49:3
  reference GatewayMount: ./packages/server/gateway/mod.ts:50:3
  reference GatewayObserverDefinition: ./packages/server/gateway/mod.ts:51:3
  reference GatewayObserverEvent: ./packages/server/gateway/mod.ts:52:3
  reference GatewayObserverEventKind: ./packages/server/gateway/mod.ts:53:3
  reference GatewayObserverHandler: ./packages/server/gateway/mod.ts:54:3
  reference GatewayOrigin: ./packages/server/gateway/mod.ts:55:3
  reference GatewayPolicy: ./packages/server/gateway/mod.ts:56:3
  reference GatewayPolicyInput: ./packages/server/gateway/mod.ts:57:3
  reference GatewayRedirectPolicy: ./packages/server/gateway/mod.ts:58:3
  reference GatewayRequestPatch: ./packages/server/gateway/mod.ts:59:3
  reference GatewayRequestState: ./packages/server/gateway/mod.ts:60:3
  reference GatewayRouteManifestEntry: ./packages/server/gateway/mod.ts:61:3
  reference GatewayRuntime: ./packages/server/gateway/mod.ts:62:3
  reference GatewayRuntimeAdapters: ./packages/server/gateway/mod.ts:63:3
  reference GatewaySelection: ./packages/server/gateway/mod.ts:64:3
  reference GatewayServiceArtifact: ./packages/server/gateway/mod.ts:65:3
  reference GatewayValidationIssue: ./packages/server/gateway/mod.ts:66:3
  reference GatewayValidationResult: ./packages/server/gateway/mod.ts:67:3
  reference GatewayValidationSubject: ./packages/server/gateway/mod.ts:68:3
````

### root: http

[Declaration source](mod.ts#L18)

````text
namespace http
  Compose a portable fetch application from route and middleware values. A large if chain mixes routing, exception mapping and security headers, making it hard to mount the same service on another host.

  Start with Web Request/Response routes, then move stable schemas into endpoint definitions and bind implementations through services. A gateway composes host services; an explicit Deno or framework adapter starts the listener. Definitions do not create connections. Middleware and response bodies have real ownership and cancellation costs, so choose buffering only for bounded payloads.

  @example
      ```ts
      import * as http from '@okikio/server/http';
      const app = http.create({
        routes: [http.route('GET', '/health', () => Response.json({ ok: true }))],
        middleware: [http.securityHeaders()],
      });
      const response = await app.fetch(new Request('https://service.invalid/health'));
      console.log(response.status, (await response.json()).ok);
      ```

  @module

  reference compose: ./packages/server/http/mod.ts:15:10
  reference create: ./packages/server/http/mod.ts:15:19
  reference mount: ./packages/server/http/mod.ts:15:27
  reference route: ./packages/server/http/mod.ts:15:34
  reference access: ./packages/server/http/mod.ts:16:10
  reference correlation: ./packages/server/http/mod.ts:17:10
  reference cors: ./packages/server/http/mod.ts:18:10
  reference catchErrors: ./packages/server/http/mod.ts:19:10
  reference errorResponse: ./packages/server/http/mod.ts:19:23
  reference health: ./packages/server/http/mod.ts:20:10
  reference ready: ./packages/server/http/mod.ts:20:18
  reference headers: ./packages/server/http/mod.ts:21:10
  reference securityHeaders: ./packages/server/http/mod.ts:21:19
  reference prettyJson: ./packages/server/http/mod.ts:22:10
  reference compareRouteSpecificity: ./packages/server/http/mod.ts:23:10
  reference matchPath: ./packages/server/http/mod.ts:23:35
  reference normalizePath: ./packages/server/http/mod.ts:23:46
  reference trailingSlash: ./packages/server/http/mod.ts:23:61
  reference requestId: ./packages/server/http/mod.ts:24:10
  reference problemResponse: ./packages/server/http/mod.ts:25:10
  reference withHeaders: ./packages/server/http/mod.ts:25:27
  reference timing: ./packages/server/http/mod.ts:26:10
  reference AccessEventType: ./packages/server/http/mod.ts:28:3
  reference App: ./packages/server/http/mod.ts:29:3
  reference CreateOptionsType: ./packages/server/http/mod.ts:30:3
  reference Handler: ./packages/server/http/mod.ts:31:3
  reference Middleware: ./packages/server/http/mod.ts:32:3
  reference Next: ./packages/server/http/mod.ts:33:3
  reference ReadinessType: ./packages/server/http/mod.ts:34:3
  reference RouteType: ./packages/server/http/mod.ts:35:3
  reference CorrelationOptions: ./packages/server/http/mod.ts:37:15
  reference CorsOptionsType: ./packages/server/http/mod.ts:38:15
  reference ErrorOptions: ./packages/server/http/mod.ts:39:15
  reference ErrorResultType: ./packages/server/http/mod.ts:39:29
  reference HealthOptions: ./packages/server/http/mod.ts:40:15
  reference SecurityHeadersOptionsType: ./packages/server/http/mod.ts:41:15
  reference PrettyJsonOptionsType: ./packages/server/http/mod.ts:42:15
  reference TrailingSlashOptions: ./packages/server/http/mod.ts:43:15
  reference RequestIdOptions: ./packages/server/http/mod.ts:44:15
  reference TimingOptions: ./packages/server/http/mod.ts:45:15
  reference matchMount: ./packages/server/http/mod.ts:47:10
  reference matchRoute: ./packages/server/http/mod.ts:47:22
  reference prepareRoutes: ./packages/server/http/mod.ts:47:34
  reference routeKey: ./packages/server/http/mod.ts:47:60
  reference MountOptions: ./packages/server/http/mod.ts:48:15
  reference RoutePlan: ./packages/server/http/mod.ts:48:29
  reference RoutePlanInput: ./packages/server/http/mod.ts:48:40
````

### root: middleware

[Declaration source](mod.ts#L20)

````text
namespace middleware
  Declare middleware ordering and context needs so startup can reject a missing producer.

  Bind runtime behavior with handler(), place it in a declared request lane, and use once() when one exact binding should run once per Request. These declarations validate availability and ordering; they do not authenticate an actor.

  @example
      ```ts
      import '@okikio/duration/polyfill';
      import '@okikio/dispose/polyfill';
      import * as middleware from '@okikio/server/middleware';
      const Actor = middleware.context<{ id: string }>()({ id: 'actor', description: 'Authenticated actor.' });
      const Read = middleware.define({ id: 'actor.read', description: 'Read actor after authentication.', requires: [Actor] });
      console.log(middleware.validate([Read]).valid);
      console.log(middleware.validate([Read], [Actor]).valid);
      ```

  @module

  reference context: ./packages/server/middleware/mod.ts:55:1
    Define a typed request-context value.
  function context(input: MiddlewareContextDefinitionInput): MiddlewareContextDefinition<unknown>
    Define an untyped request-context value used only for static composition.
    Create the direct or curried middleware-context authoring function.
  reference define: ./packages/server/middleware/mod.ts:81:1
    Define one import-safe middleware contract.
  reference handler: ./packages/server/middleware/mod.ts:159:1
    Bind runtime behavior to one exact middleware definition.
  reference once: ./packages/server/middleware/mod.ts:180:1
    Wrap an exact middleware handler so its inner work executes at most once for
    one Request, even when the same definition is contributed by several layers.

    Duplicate occurrences still call `next()`, preserving the compiled onion.
    The request-keyed state is weak and cannot suppress another request.
  reference middlewareCatalog: ./packages/server/middleware/mod.ts:201:1
    Create a named middleware catalog.
  reference select: ./packages/server/middleware/mod.ts:209:1
    Select an immutable key-preserving middleware subset.
  reference compose: ./packages/server/middleware/mod.ts:220:1
    Compose middleware definitions, catalogs, selections, and nested arrays.
  reference wholeRequest: ./packages/server/middleware/mod.ts:227:14
    Surround the complete application request pipeline before transport materialization.
  reference beforeValidation: ./packages/server/middleware/mod.ts:231:14
    Place middleware immediately before request validation.
  reference afterValidation: ./packages/server/middleware/mod.ts:235:14
    Place middleware in the normal post-validation lane.
  reference aroundOperation: ./packages/server/middleware/mod.ts:239:14
    Place middleware immediately around endpoint handler invocation.
  reference plan: ./packages/server/middleware/mod.ts:244:1
    Normalize middleware input while preserving authored order within each lane.
  reference validate: ./packages/server/middleware/mod.ts:256:1
    Validate ordering, IDs, and context guarantees for one middleware input.
  reference document: ./packages/server/middleware/mod.ts:309:1
    Create deterministic JSON-safe middleware documentation.
  reference catalog: ./packages/server/middleware/mod.ts:201:1
    Create a named middleware catalog.
  reference MiddlewareContextDefinition: ./packages/server/middleware/mod.ts:449:3
  reference MiddlewareContextDefinitionInput: ./packages/server/middleware/mod.ts:450:3
  reference MiddlewareContextStore: ./packages/server/middleware/mod.ts:451:3
  reference MiddlewareContextValue: ./packages/server/middleware/mod.ts:452:3
  reference MiddlewareDefinition: ./packages/server/middleware/mod.ts:453:3
  reference MiddlewareDefinitionInput: ./packages/server/middleware/mod.ts:454:3
  reference MiddlewareDocument: ./packages/server/middleware/mod.ts:455:3
  reference MiddlewareHandler: ./packages/server/middleware/mod.ts:456:3
  reference MiddlewareHandlerContext: ./packages/server/middleware/mod.ts:457:3
  reference MiddlewareInput: ./packages/server/middleware/mod.ts:458:3
  reference MiddlewareLane: ./packages/server/middleware/mod.ts:459:3
  reference MiddlewareNext: ./packages/server/middleware/mod.ts:460:3
  reference MiddlewareOnceKey: ./packages/server/middleware/mod.ts:461:3
  reference MiddlewarePlan: ./packages/server/middleware/mod.ts:462:3
  reference MiddlewareProblems: ./packages/server/middleware/mod.ts:463:3
  reference MiddlewareProvides: ./packages/server/middleware/mod.ts:464:3
  reference MiddlewareRequires: ./packages/server/middleware/mod.ts:465:3
  reference MiddlewareResourceDefinition: ./packages/server/middleware/mod.ts:466:3
  reference MiddlewareResourceResolver: ./packages/server/middleware/mod.ts:467:3
  reference MiddlewareResources: ./packages/server/middleware/mod.ts:468:3
  reference MiddlewareResourceValue: ./packages/server/middleware/mod.ts:469:3
  reference MiddlewareUse: ./packages/server/middleware/mod.ts:470:3
  reference MiddlewareValidationIssue: ./packages/server/middleware/mod.ts:471:3
  reference MiddlewareValidationResult: ./packages/server/middleware/mod.ts:472:3
````

### root: service

[Declaration source](mod.ts#L22)

````text
namespace service
  Compile declared endpoints and concrete handlers before serving requests.

  Add resources, middleware, requirement interpreters and observers at the host boundary. Compilation rejects missing or conflicting contracts. The runtime owns request contexts and borrows the host; await its disposal to join owned resource cleanup.

  @example
      ```ts
      import '@okikio/duration/polyfill';
      import '@okikio/dispose/polyfill';
      import * as endpoint from '@okikio/server/endpoint';
      import * as response from '@okikio/http/response';
      import * as service from '@okikio/server/service';
      import { z } from 'zod';
      const Healthy = response.ok(z.object({ ok: z.boolean() }), { id: 'health.ok', description: 'Service health.' });
      const Health = endpoint.get({ id: 'health.read', path: '/health', responses: [Healthy] });
      const Api = service.define({ id: 'health-api', path: '/api', endpoints: [Health] });
      import * as resource from '@okikio/resource';
      const live = service.implement(Api, { endpoints: [endpoint.handler(Health, () => response.create(Healthy, { ok: true }))], resources: resource.implementations() });
      await using runtime = service.create(service.compile(live), { host: {} });
      const result = await runtime.fetch(new Request('https://service.invalid/api/health'));
      console.log(result.status, (await result.json()).ok);
      ```

  @module

  reference compose: ./packages/server/service/mod.ts:25:10
  reference define: ./packages/server/service/mod.ts:25:19
  reference leafEndpoints: ./packages/server/service/mod.ts:25:27
  reference observer: ./packages/server/service/mod.ts:25:42
  reference policy: ./packages/server/service/mod.ts:25:52
  reference select: ./packages/server/service/mod.ts:25:60
  reference joinPath: ./packages/server/service/mod.ts:26:10
  reference implement: ./packages/server/service/mod.ts:27:10
  reference authenticated: ./packages/server/service/mod.ts:28:10
  reference compile: ./packages/server/service/mod.ts:28:25
  reference document: ./packages/server/service/mod.ts:28:34
  reference ServiceCompilationError: ./packages/server/service/mod.ts:28:44
  reference validate: ./packages/server/service/mod.ts:28:69
  reference create: ./packages/server/service/mod.ts:29:10
  reference ServiceRuntimeConfigurationError: ./packages/server/service/mod.ts:29:18
  reference resilience: ./packages/server/service/mod.ts:30:10
  reference retry: ./packages/server/service/mod.ts:30:22
  reference RetryableOperationError: ./packages/server/service/mod.ts:30:29
  reference ServiceRetryOptions: ./packages/server/service/mod.ts:31:15
  reference openapi: ./packages/server/service/mod.ts:32:10
  reference ServiceOpenApiOptions: ./packages/server/service/mod.ts:33:15
  reference CompiledService: ./packages/server/service/mod.ts:35:3
  reference CreateServiceOptions: ./packages/server/service/mod.ts:36:3
  reference EffectiveServiceOperation: ./packages/server/service/mod.ts:37:3
  reference ServiceContextStore: ./packages/server/service/mod.ts:38:3
  reference ServiceContributions: ./packages/server/service/mod.ts:39:3
  reference ServiceDefinition: ./packages/server/service/mod.ts:40:3
  reference ServiceDefinitionInput: ./packages/server/service/mod.ts:41:3
  reference ServiceImplementation: ./packages/server/service/mod.ts:42:3
  reference ServiceImplementationInput: ./packages/server/service/mod.ts:43:3
  reference ServiceInputValues: ./packages/server/service/mod.ts:44:3
  reference ServiceManifest: ./packages/server/service/mod.ts:45:3
  reference ServiceObserverDefinition: ./packages/server/service/mod.ts:46:3
  reference ServiceObserverEvent: ./packages/server/service/mod.ts:47:3
  reference ServiceObserverEventKind: ./packages/server/service/mod.ts:48:3
  reference ServiceObserverHandler: ./packages/server/service/mod.ts:49:3
  reference ServicePolicy: ./packages/server/service/mod.ts:50:3
  reference ServicePolicyInput: ./packages/server/service/mod.ts:51:3
  reference ServiceRequestState: ./packages/server/service/mod.ts:52:3
  reference ServiceRequestStatePatch: ./packages/server/service/mod.ts:53:3
  reference ServiceRequestValues: ./packages/server/service/mod.ts:54:3
  reference ServiceResilienceAdapter: ./packages/server/service/mod.ts:55:3
  reference ServiceRoute: ./packages/server/service/mod.ts:56:3
  reference ServiceRouteManifestEntry: ./packages/server/service/mod.ts:57:3
  reference ServiceRuntime: ./packages/server/service/mod.ts:58:3
  reference ServiceRuntimeAdapters: ./packages/server/service/mod.ts:59:3
  reference ServiceRuntimeRoute: ./packages/server/service/mod.ts:60:3
  reference ServiceSelection: ./packages/server/service/mod.ts:61:3
  reference ServiceStageResult: ./packages/server/service/mod.ts:62:3
  reference ServiceValidationIssue: ./packages/server/service/mod.ts:63:3
  reference ServiceValidationResult: ./packages/server/service/mod.ts:64:3
  reference ServiceValidationSubject: ./packages/server/service/mod.ts:65:3
  reference ServiceValuePatch: ./packages/server/service/mod.ts:66:3
````

### root: GatewayProblems

[Declaration source](mod.ts#L23)

```text
reference GatewayProblems: ./packages/server/gateway/problems.ts:3:14
```

## endpoint

Import `@okikio/server/endpoint`. [Source](./endpoint/mod.ts).

Describe a route from input and response contracts before a handler or provider starts.

Bind the exact Health definition with endpoint.handler(), then compile its service. Domain schemas remain authoritative
for coercion and validation; endpoint wire projections describe what clients actually send.

### endpoint: AnyEndpointHandler

[Declaration source](endpoint/mod.ts#L44)

```text
reference AnyEndpointHandler: ./packages/server/endpoint/types.ts:565:1
```

### endpoint: AnyEndpointHandlerBinding

[Declaration source](endpoint/mod.ts#L45)

```text
reference AnyEndpointHandlerBinding: ./packages/server/endpoint/types.ts:572:1
```

### endpoint: EmptyEndpointHost

[Declaration source](endpoint/mod.ts#L46)

```text
reference EmptyEndpointHost: ./packages/server/endpoint/types.ts:453:1
```

### endpoint: EndpointCompositionInput

[Declaration source](endpoint/mod.ts#L47)

```text
reference EndpointCompositionInput: ./packages/server/endpoint/types.ts:294:1
```

### endpoint: EndpointContext

[Declaration source](endpoint/mod.ts#L48)

```text
reference EndpointContext: ./packages/server/endpoint/types.ts:441:1
```

### endpoint: EndpointContributions

[Declaration source](endpoint/mod.ts#L49)

```text
reference EndpointContributions: ./packages/server/endpoint/types.ts:111:1
```

### endpoint: EndpointDefinition

[Declaration source](endpoint/mod.ts#L50)

```text
reference EndpointDefinition: ./packages/server/endpoint/types.ts:245:1
```

### endpoint: EndpointDefinitionInput

[Declaration source](endpoint/mod.ts#L51)

```text
reference EndpointDefinitionInput: ./packages/server/endpoint/types.ts:231:1
```

### endpoint: EndpointDocument

[Declaration source](endpoint/mod.ts#L52)

```text
reference EndpointDocument: ./packages/server/endpoint/types.ts:403:1
```

### endpoint: EndpointDocumentation

[Declaration source](endpoint/mod.ts#L53)

```text
reference EndpointDocumentation: ./packages/server/endpoint/types.ts:131:1
```

### endpoint: EndpointEntry

[Declaration source](endpoint/mod.ts#L54)

```text
reference EndpointEntry: ./packages/server/endpoint/types.ts:291:1
```

### endpoint: EndpointExample

[Declaration source](endpoint/mod.ts#L55)

```text
reference EndpointExample: ./packages/server/endpoint/types.ts:33:1
```

### endpoint: EndpointGroup

[Declaration source](endpoint/mod.ts#L56)

```text
reference EndpointGroup: ./packages/server/endpoint/types.ts:315:1
```

### endpoint: EndpointGroupInput

[Declaration source](endpoint/mod.ts#L57)

```text
reference EndpointGroupInput: ./packages/server/endpoint/types.ts:302:1
```

### endpoint: EndpointGroupMembers

[Declaration source](endpoint/mod.ts#L58)

```text
reference EndpointGroupMembers: ./packages/server/endpoint/types.ts:297:1
```

### endpoint: EndpointGroupSelection

[Declaration source](endpoint/mod.ts#L59)

```text
reference EndpointGroupSelection: ./packages/server/endpoint/types.ts:332:1
```

### endpoint: EndpointHandler

[Declaration source](endpoint/mod.ts#L60)

```text
reference EndpointHandler: ./packages/server/endpoint/types.ts:505:1
```

### endpoint: EndpointHandlerBinding

[Declaration source](endpoint/mod.ts#L61)

```text
reference EndpointHandlerBinding: ./packages/server/endpoint/types.ts:515:1
```

### endpoint: EndpointHandlerContext

[Declaration source](endpoint/mod.ts#L62)

```text
reference EndpointHandlerContext: ./packages/server/endpoint/types.ts:463:1
```

### endpoint: EndpointHandlerResult

[Declaration source](endpoint/mod.ts#L63)

```text
reference EndpointHandlerResult: ./packages/server/endpoint/types.ts:499:1
```

### endpoint: EndpointHandlerSet

[Declaration source](endpoint/mod.ts#L64)

```text
reference EndpointHandlerSet: ./packages/server/endpoint/types.ts:584:1
```

### endpoint: EndpointInput

[Declaration source](endpoint/mod.ts#L65)

```text
reference EndpointInput: ./packages/server/endpoint/types.ts:45:1
```

### endpoint: EndpointInputSchema

[Declaration source](endpoint/mod.ts#L66)

```text
reference EndpointInputSchema: ./packages/server/endpoint/types.ts:86:1
```

### endpoint: EndpointInputSlot

[Declaration source](endpoint/mod.ts#L67)

```text
reference EndpointInputSlot: ./packages/server/endpoint/types.ts:65:1
```

### endpoint: EndpointInputSlots

[Declaration source](endpoint/mod.ts#L68)

```text
reference EndpointInputSlots: ./packages/server/endpoint/types.ts:68:1
```

### endpoint: EndpointInputSource

[Declaration source](endpoint/mod.ts#L69)

```text
reference EndpointInputSource: ./packages/server/endpoint/types.ts:27:1
```

### endpoint: EndpointMethod

[Declaration source](endpoint/mod.ts#L70)

```text
reference EndpointMethod: ./packages/server/endpoint/types.ts:24:1
```

### endpoint: EndpointOperation

[Declaration source](endpoint/mod.ts#L71)

```text
reference EndpointOperation: ./packages/server/endpoint/types.ts:172:1
```

### endpoint: EndpointOperationDocument

[Declaration source](endpoint/mod.ts#L72)

```text
reference EndpointOperationDocument: ./packages/server/endpoint/types.ts:373:1
```

### endpoint: EndpointOperationInput

[Declaration source](endpoint/mod.ts#L73)

```text
reference EndpointOperationInput: ./packages/server/endpoint/types.ts:147:1
```

### endpoint: EndpointRequestValues

[Declaration source](endpoint/mod.ts#L74)

```text
reference EndpointRequestValues: ./packages/server/endpoint/types.ts:450:1
```

### endpoint: EndpointResourceDefinition

[Declaration source](endpoint/mod.ts#L75)

```text
reference EndpointResourceDefinition: ./packages/server/endpoint/types.ts:18:1
```

### endpoint: EndpointResourceResolver

[Declaration source](endpoint/mod.ts#L76)

```text
reference EndpointResourceResolver: ./packages/server/endpoint/types.ts:433:1
```

### endpoint: EndpointResourceValue

[Declaration source](endpoint/mod.ts#L78)

```text
reference EndpointResourceValue: ./packages/server/endpoint/types.ts:21:1
```

### endpoint: EndpointResources

[Declaration source](endpoint/mod.ts#L77)

```text
reference EndpointResources: ./packages/server/endpoint/types.ts:427:1
```

### endpoint: EndpointRuntimeInputValues

[Declaration source](endpoint/mod.ts#L79)

```text
reference EndpointRuntimeInputValues: ./packages/server/endpoint/types.ts:532:1
```

### endpoint: EndpointSchema

[Declaration source](endpoint/mod.ts#L80)

```text
reference EndpointSchema: ./packages/server/endpoint/types.ts:30:1
```

### endpoint: EndpointValidationIssue

[Declaration source](endpoint/mod.ts#L81)

```text
reference EndpointValidationIssue: ./packages/server/endpoint/types.ts:347:1
```

### endpoint: EndpointValidationResult

[Declaration source](endpoint/mod.ts#L82)

```text
reference EndpointValidationResult: ./packages/server/endpoint/types.ts:368:1
```

### endpoint: ErasedEndpointHandlerContext

[Declaration source](endpoint/mod.ts#L83)

```text
reference ErasedEndpointHandlerContext: ./packages/server/endpoint/types.ts:542:1
```

### endpoint: InferEndpointInputs

[Declaration source](endpoint/mod.ts#L84)

```text
reference InferEndpointInputs: ./packages/server/endpoint/types.ts:98:1
```

### endpoint: InferEndpointWireInputs

[Declaration source](endpoint/mod.ts#L85)

```text
reference InferEndpointWireInputs: ./packages/server/endpoint/types.ts:91:1
```

### endpoint: MergeEndpointInputs

[Declaration source](endpoint/mod.ts#L86)

```text
reference MergeEndpointInputs: ./packages/server/endpoint/types.ts:105:1
```

### endpoint: OpenApiDocument

[Declaration source](endpoint/mod.ts#L93)

```text
reference OpenApiDocument: ./packages/server/endpoint/openapi.ts:48:1
```

### endpoint: OpenApiOptions

[Declaration source](endpoint/mod.ts#L94)

```text
reference OpenApiOptions: ./packages/server/endpoint/openapi.ts:64:1
```

### endpoint: OpenApiSchemaProjectionContext

[Declaration source](endpoint/mod.ts#L95)

```text
reference OpenApiSchemaProjectionContext: ./packages/server/endpoint/openapi.ts:24:1
```

### endpoint: OpenApiSchemaProjector

[Declaration source](endpoint/mod.ts#L96)

```text
reference OpenApiSchemaProjector: ./packages/server/endpoint/openapi.ts:34:1
```

### endpoint: OpenApiServer

[Declaration source](endpoint/mod.ts#L97)

```text
reference OpenApiServer: ./packages/server/endpoint/openapi.ts:40:1
```

### endpoint: PickEndpointInputSlots

[Declaration source](endpoint/mod.ts#L87)

```text
reference PickEndpointInputSlots: ./packages/server/endpoint/types.ts:167:1
```

### endpoint: SingleMethodEndpointInput

[Declaration source](endpoint/mod.ts#L88)

```text
reference SingleMethodEndpointInput: ./packages/server/endpoint/types.ts:282:1
```

### endpoint: compose

[Declaration source](endpoint/mod.ts#L22)

```text
reference compose: ./packages/server/endpoint/definition.ts:292:1
```

### endpoint: define

[Declaration source](endpoint/mod.ts#L23)

```text
reference define: ./packages/server/endpoint/definition.ts:113:1
```

### endpoint: delete

[Declaration source](endpoint/mod.ts#L24)

```text
reference delete: ./packages/server/endpoint/definition.ts:225:14
```

### endpoint: document

[Declaration source](endpoint/mod.ts#L25)

```text
reference document: ./packages/server/endpoint/definition.ts:389:1
```

### endpoint: get

[Declaration source](endpoint/mod.ts#L26)

```text
reference get: ./packages/server/endpoint/definition.ts:209:14
```

### endpoint: group

[Declaration source](endpoint/mod.ts#L27)

```text
reference group: ./packages/server/endpoint/definition.ts:238:1
```

### endpoint: handler

[Declaration source](endpoint/mod.ts#L41)

```text
reference handler: ./packages/server/endpoint/handler.ts:17:1
```

### endpoint: handlers

[Declaration source](endpoint/mod.ts#L41)

```text
reference handlers: ./packages/server/endpoint/handler.ts:106:1
```

### endpoint: head

[Declaration source](endpoint/mod.ts#L28)

```text
reference head: ./packages/server/endpoint/definition.ts:233:14
```

### endpoint: input

[Declaration source](endpoint/mod.ts#L29)

```text
reference input: ./packages/server/endpoint/definition.ts:64:1
```

### endpoint: isInput

[Declaration source](endpoint/mod.ts#L30)

```text
reference isInput: ./packages/server/endpoint/definition.ts:85:1
```

### endpoint: joinPath

[Declaration source](endpoint/mod.ts#L42)

```text
reference joinPath: ./packages/server/endpoint/path.ts:9:1
```

### endpoint: match

[Declaration source](endpoint/mod.ts#L31)

```text
reference match: ./packages/server/endpoint/definition.ts:427:1
```

### endpoint: normalizePathTemplate

[Declaration source](endpoint/mod.ts#L42)

```text
reference normalizePathTemplate: ./packages/server/endpoint/path.ts:18:1
```

### endpoint: openapi

[Declaration source](endpoint/mod.ts#L91)

```text
reference openapi: ./packages/server/endpoint/openapi.ts:102:1
```

### endpoint: operation

[Declaration source](endpoint/mod.ts#L32)

```text
reference operation: ./packages/server/endpoint/definition.ts:450:14
```

### endpoint: options

[Declaration source](endpoint/mod.ts#L33)

```text
reference options: ./packages/server/endpoint/definition.ts:229:14
```

### endpoint: patch

[Declaration source](endpoint/mod.ts#L34)

```text
reference patch: ./packages/server/endpoint/definition.ts:221:14
```

### endpoint: pathParameters

[Declaration source](endpoint/mod.ts#L42)

```text
reference pathParameters: ./packages/server/endpoint/path.ts:23:1
```

### endpoint: post

[Declaration source](endpoint/mod.ts#L35)

```text
reference post: ./packages/server/endpoint/definition.ts:213:14
```

### endpoint: put

[Declaration source](endpoint/mod.ts#L36)

```text
reference put: ./packages/server/endpoint/definition.ts:217:14
```

### endpoint: schemaOf

[Declaration source](endpoint/mod.ts#L37)

```text
reference schemaOf: ./packages/server/endpoint/definition.ts:80:1
```

### endpoint: select

[Declaration source](endpoint/mod.ts#L38)

```text
reference select: ./packages/server/endpoint/definition.ts:263:1
```

### endpoint: validate

[Declaration source](endpoint/mod.ts#L39)

```text
reference validate: ./packages/server/endpoint/definition.ts:309:1
```

## endpoint-definition

Import `@okikio/server/endpoint/definition`. [Source](./endpoint/definition.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding              | Contract owner or source                                                   |
| ----------------------------- | -------------------------------------------------------------------------- |
| `StandardSchemaV1`            | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `catalog`                     | [catalog contracts](../catalog/API.md)                                     |
| `effect`                      | [effect contracts](../effect/API.md)                                       |
| `CatalogEntryIdentity`        | [catalog contracts](../catalog/API.md)                                     |
| `DefinitionInput`             | [catalog contracts](../catalog/API.md)                                     |
| `resilience`                  | [resilience contracts](../resilience/API.md)                               |
| `recordCore`                  | [record contracts](../record/API.md)                                       |
| `joinPath`                    | [Source](endpoint/path.ts)                                                 |
| `normalizePathTemplate`       | [Source](endpoint/path.ts)                                                 |
| `pathParameters`              | [Source](endpoint/path.ts)                                                 |
| `ProblemDefinition`           | [http contracts](../http/API.md)                                           |
| `DefinedEndpointOperation`    | [Source](endpoint/types.ts)                                                |
| `EndpointCompositionInput`    | [Source](endpoint/types.ts)                                                |
| `EndpointDefinition`          | [Source](endpoint/types.ts)                                                |
| `EndpointDefinitionInput`     | [Source](endpoint/types.ts)                                                |
| `EndpointDefinitionProblems`  | [Source](endpoint/types.ts)                                                |
| `EndpointDefinitionResources` | [Source](endpoint/types.ts)                                                |
| `EndpointDocument`            | [Source](endpoint/types.ts)                                                |
| `EndpointEntry`               | [Source](endpoint/types.ts)                                                |
| `EndpointGroup`               | [Source](endpoint/types.ts)                                                |
| `EndpointGroupInput`          | [Source](endpoint/types.ts)                                                |
| `EndpointGroupMembers`        | [Source](endpoint/types.ts)                                                |
| `EndpointGroupSelection`      | [Source](endpoint/types.ts)                                                |
| `EndpointInput`               | [Source](endpoint/types.ts)                                                |
| `EndpointInputSlot`           | [Source](endpoint/types.ts)                                                |
| `EndpointInputSlots`          | [Source](endpoint/types.ts)                                                |
| `EndpointInputSource`         | [Source](endpoint/types.ts)                                                |
| `EndpointMethod`              | [Source](endpoint/types.ts)                                                |
| `EndpointOperation`           | [Source](endpoint/types.ts)                                                |
| `EndpointOperationDocument`   | [Source](endpoint/types.ts)                                                |
| `EndpointOperationInput`      | [Source](endpoint/types.ts)                                                |
| `EndpointOperationProblems`   | [Source](endpoint/types.ts)                                                |
| `EndpointOperationResources`  | [Source](endpoint/types.ts)                                                |
| `EndpointResourceDefinition`  | [Source](endpoint/types.ts)                                                |
| `EndpointSchema`              | [Source](endpoint/types.ts)                                                |
| `EndpointValidationIssue`     | [Source](endpoint/types.ts)                                                |
| `EndpointValidationResult`    | [Source](endpoint/types.ts)                                                |
| `PickEndpointInputSlots`      | [Source](endpoint/types.ts)                                                |
| `SingleMethodEndpointInput`   | [Source](endpoint/types.ts)                                                |

### endpoint-definition: compose

[Declaration source](endpoint/definition.ts#L292)

```text
function compose(...inputs: readonly EndpointCompositionInput[]): readonly EndpointEntry[]
  Compose endpoint paths, groups, selections, and nested arrays.
```

### endpoint-definition: define

[Declaration source](endpoint/definition.ts#L113)

```text
function define<Input extends EndpointDefinitionInput>(definition: Input): EndpointDefinition<Input["path"], PickEndpointInputSlots<Input>, Input["operations"], EndpointDefinitionResources<Input>, EndpointDefinitionProblems<Input>>
  Define a multi-method endpoint path.
```

### endpoint-definition: defineOperation

[Declaration source](endpoint/definition.ts#L90)

```text
function defineOperation<Method extends EndpointMethod, Input extends EndpointOperationInput>(method: Method, definition: Input): DefinedEndpointOperation<Method, Input>
  Define one path-independent HTTP method operation.
```

### endpoint-definition: del

[Declaration source](endpoint/definition.ts#L225)

```text
function del<Path extends string, Input extends SingleMethodEndpointInput<Path>>(definition: Input): SingleEndpointDefinition<"delete", Path, Input>
  Define a complete `DELETE` endpoint.
```

### endpoint-definition: document

[Declaration source](endpoint/definition.ts#L389)

```text
function document(input: EndpointCompositionInput): readonly EndpointDocument[]
  Create deterministic JSON-safe endpoint documentation.
```

### endpoint-definition: get

[Declaration source](endpoint/definition.ts#L209)

```text
function get<Path extends string, Input extends SingleMethodEndpointInput<Path>>(definition: Input): SingleEndpointDefinition<"get", Path, Input>
  Define a complete `GET` endpoint.
```

### endpoint-definition: group

[Declaration source](endpoint/definition.ts#L238)

```text
function group<Path extends string, Members extends EndpointGroupMembers>(definition: EndpointGroupInput<Path, Members>): EndpointGroup<Path, Members extends Readonly<Record<string, EndpointEntry>> ? Members : undefined>
  Define a static endpoint group with shared prefix and contributions.
```

### endpoint-definition: head

[Declaration source](endpoint/definition.ts#L233)

```text
function head<Path extends string, Input extends SingleMethodEndpointInput<Path>>(definition: Input): SingleEndpointDefinition<"head", Path, Input>
  Define a complete `HEAD` endpoint.
```

### endpoint-definition: input

[Declaration source](endpoint/definition.ts#L64)

```text
function input<Schema extends EndpointSchema>(schema: Schema, metadata: Omit<EndpointInput<Schema>, "kind" | "schema">): EndpointInput<Schema>
  Add transport documentation to a first-class Standard Schema value.
```

### endpoint-definition: isInput

[Declaration source](endpoint/definition.ts#L85)

```text
function isInput(value: unknown): value is EndpointInput
  Return whether a value is a documented endpoint input.
```

### endpoint-definition: match

[Declaration source](endpoint/definition.ts#L427)

```text
async function match<Schema extends EndpointSchema>(schema: Schema, value: unknown): Promise<Readonly<{ readonly success: true; readonly value: StandardSchemaV1.InferOutput<Schema>; }> | Readonly<{ readonly success: false; readonly issues: readonly StandardSchemaV1.Issue[]; }>>
  Validate a value against any Standard Schema-compatible contract.
```

### endpoint-definition: options

[Declaration source](endpoint/definition.ts#L229)

```text
function options<Path extends string, Input extends SingleMethodEndpointInput<Path>>(definition: Input): SingleEndpointDefinition<"options", Path, Input>
  Define a complete `OPTIONS` endpoint.
```

### endpoint-definition: patch

[Declaration source](endpoint/definition.ts#L221)

```text
function patch<Path extends string, Input extends SingleMethodEndpointInput<Path>>(definition: Input): SingleEndpointDefinition<"patch", Path, Input>
  Define a complete `PATCH` endpoint.
```

### endpoint-definition: post

[Declaration source](endpoint/definition.ts#L213)

```text
function post<Path extends string, Input extends SingleMethodEndpointInput<Path>>(definition: Input): SingleEndpointDefinition<"post", Path, Input>
  Define a complete `POST` endpoint.
```

### endpoint-definition: put

[Declaration source](endpoint/definition.ts#L217)

```text
function put<Path extends string, Input extends SingleMethodEndpointInput<Path>>(definition: Input): SingleEndpointDefinition<"put", Path, Input>
  Define a complete `PUT` endpoint.
```

### endpoint-definition: schemaOf

[Declaration source](endpoint/definition.ts#L80)

```text
function schemaOf<Schema extends EndpointSchema>(slot: EndpointInputSlot<Schema>): Schema
  Return the Standard Schema carried by a bare or documented input slot.
```

### endpoint-definition: select

[Declaration source](endpoint/definition.ts#L263)

```text
function select<Group extends EndpointGroup<string, Entries>, Entries extends Readonly<Record<string, EndpointEntry>>, Keys extends readonly (keyof Entries & string)[]>(source: Group, keys: Keys): EndpointGroupSelection<Group, Pick<Entries, Keys[number]>>
  Select named members from an endpoint group without copying definitions.
```

### endpoint-definition: validate

[Declaration source](endpoint/definition.ts#L309)

```text
function validate(input: EndpointCompositionInput): EndpointValidationResult
  Validate a complete endpoint composition without acquiring runtime values.
```

### endpoint-definition: operation

[Declaration source](endpoint/definition.ts#L450)

```text
const operation
  Path-independent operation constructors.
```

### endpoint-definition: SingleEndpointDefinition

[Declaration source](endpoint/definition.ts#L156)

```text
type SingleEndpointDefinition<Method extends EndpointMethod, Path extends string, Input extends SingleMethodEndpointInput<Path>> = EndpointDefinition<Path, PickEndpointInputSlots<Pick<Input, "param">>, readonly [DefinedEndpointOperation<Method, Input>], EndpointResourceDefinition, ProblemDefinition>
  Concrete endpoint definition produced by one HTTP-method convenience operation.
```

## endpoint-handler

Import `@okikio/server/endpoint/handler`. [Source](./endpoint/handler.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source             |
| --------------------------- | ------------------------------------ |
| `recordCore`                | [record contracts](../record/API.md) |
| `AnyEndpointHandler`        | [Source](endpoint/types.ts)          |
| `AnyEndpointHandlerBinding` | [Source](endpoint/types.ts)          |
| `EmptyEndpointHost`         | [Source](endpoint/types.ts)          |
| `EndpointDefinition`        | [Source](endpoint/types.ts)          |
| `EndpointHandler`           | [Source](endpoint/types.ts)          |
| `EndpointHandlerBinding`    | [Source](endpoint/types.ts)          |
| `EndpointHandlerSet`        | [Source](endpoint/types.ts)          |
| `EndpointInputSlots`        | [Source](endpoint/types.ts)          |
| `EndpointMethod`            | [Source](endpoint/types.ts)          |
| `EndpointOperation`         | [Source](endpoint/types.ts)          |
| `EndpointRequestValues`     | [Source](endpoint/types.ts)          |

### endpoint-handler: handler

[Declaration source](endpoint/handler.ts#L17)

```text
function handler<Endpoint extends EndpointDefinition<string, EndpointInputSlots, readonly [EndpointOperation]>, Host extends object = EmptyEndpointHost, Values extends EndpointRequestValues = EndpointRequestValues>(endpoint: Endpoint, handle: EndpointHandler<Endpoint, Endpoint["operations"][0], Host, Values>): EndpointHandlerBinding<Endpoint, Endpoint["operations"][0], Host, Values>
  Bind a complete single-method endpoint directly to its handler.
```

[Declaration source](endpoint/handler.ts#L26)

```text
function handler<Endpoint extends EndpointDefinition, Host extends object = EmptyEndpointHost, Values extends EndpointRequestValues = EndpointRequestValues>(endpoint: Endpoint, handles: HandlerMap<Endpoint, Host, Values>): EndpointHandlerSet<Endpoint>
  Bind every method of one endpoint through an exhaustive lowercase method map.
```

[Declaration source](endpoint/handler.ts#L35)

```text
function handler<Endpoint extends EndpointDefinition, Operation extends Endpoint["operations"][number], Host extends object = EmptyEndpointHost, Values extends EndpointRequestValues = EndpointRequestValues>(endpoint: Endpoint, operation: Operation, handle: EndpointHandler<Endpoint, Operation, Host, Values>): EndpointHandlerBinding<Endpoint, Operation, Host, Values>
  Bind one imported operation from a multi-method endpoint.

  Normalize direct, operation-specific, or exhaustive handler authoring.
```

### endpoint-handler: handlers

[Declaration source](endpoint/handler.ts#L106)

```text
function handlers(...input: readonly EndpointHandlerInput[]): readonly AnyEndpointHandlerBinding[]
  Flatten handler bindings while rejecting duplicate operation implementations.
```

[Declaration source](endpoint/handler.ts#L102)

```text
private type EndpointHandlerEntry = AnyEndpointHandlerBinding | EndpointHandlerSet
  Compose direct bindings and complete handler sets into one immutable list.
```

[Declaration source](endpoint/handler.ts#L103)

```text
private type EndpointHandlerInput = EndpointHandlerEntry | readonly EndpointHandlerInput[]
```

[Declaration source](endpoint/handler.ts#L142)

```text
private type HandlerMap<Endpoint extends EndpointDefinition, Host extends object, Values extends EndpointRequestValues> = readonly [Method in Endpoint["operations"][number]["method"]]: EndpointHandler<Endpoint, Extract<Endpoint["operations"][number], { readonly method: Method; }>, Host, Values>
```

## endpoint-openapi

Import `@okikio/server/endpoint/openapi`. [Source](./endpoint/openapi.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding           | Contract owner or source                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| `joinPath`                 | [Source](endpoint/path.ts)                                                 |
| `pathParameters`           | [Source](endpoint/path.ts)                                                 |
| `catalog`                  | [catalog contracts](../catalog/API.md)                                     |
| `record`                   | [record contracts](../record/API.md)                                       |
| `freezeOpenApi`            | [Source](openapi/value.ts)                                                 |
| `StandardJSONSchemaV1`     | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `StandardSchemaV1`         | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `ProblemDefinition`        | [http contracts](../http/API.md)                                           |
| `ResponseDefinition`       | [http contracts](../http/API.md)                                           |
| `ResponseExample`          | [http contracts](../http/API.md)                                           |
| `schemaOf`                 | [Source](endpoint/definition.ts)                                           |
| `validate`                 | [Source](endpoint/definition.ts)                                           |
| `EndpointCompositionInput` | [Source](endpoint/types.ts)                                                |
| `EndpointDefinition`       | [Source](endpoint/types.ts)                                                |
| `EndpointEntry`            | [Source](endpoint/types.ts)                                                |
| `EndpointExample`          | [Source](endpoint/types.ts)                                                |
| `EndpointGroup`            | [Source](endpoint/types.ts)                                                |
| `EndpointInputSlot`        | [Source](endpoint/types.ts)                                                |
| `EndpointInputSource`      | [Source](endpoint/types.ts)                                                |
| `EndpointOperation`        | [Source](endpoint/types.ts)                                                |

### endpoint-openapi: openapi

[Declaration source](endpoint/openapi.ts#L102)

```text
async function openapi(input: EndpointCompositionInput, options: OpenApiOptions): Promise<OpenApiDocument>
  Generate an endpoint-only OpenAPI document from the exact imported graph.

  Service-level authentication schemes, servers, and compiler-generated
  failures are added after effective-operation resolution by `service.openapi`.
```

### endpoint-openapi: OpenApiDocument

[Declaration source](endpoint/openapi.ts#L48)

```text
interface OpenApiDocument
  OpenAPI 3.1 document generated from one endpoint composition.

  readonly openapi: OpenApiSpecVersion
    OpenAPI document version emitted by this projection.
  readonly info: Readonly<{ readonly title: string; readonly version: string; readonly description?: string; }>
    API title, application version and description for generated clients and references.
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    Projected endpoint paths and method-operation descriptions.
  readonly servers?: readonly OpenApiServer[]
    Advertised server origins; this projection does not open connections.
```

### endpoint-openapi: OpenApiOptions

[Declaration source](endpoint/openapi.ts#L64)

```text
interface OpenApiOptions
  Options for the endpoint-only OpenAPI projection.

  readonly title: string
    API title shown in generated references.
  readonly version: string
    Application API version shown in generated references.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
  readonly includeInternal?: boolean
    Include internal operations in this explicitly requested documentation projection.
  readonly specVersion?: OpenApiSpecVersion
    OpenAPI document version. Defaults to 3.1.2. Selecting 3.2.0 does not synthesize features that only exist in 3.2.
  readonly schemaProjectorMode?: "fallback" | "override"
    Controls whether a configured projector is a fallback or replaces the validator's Standard JSON Schema projection.
  readonly servers?: readonly OpenApiServer[]
    Server origins advertised to generated clients and API reference tooling.
  readonly schemaProjector?: OpenApiSchemaProjector
    Optional projection for validators that do not expose Standard JSON Schema directly.
```

### endpoint-openapi: OpenApiSchemaProjectionContext

[Declaration source](endpoint/openapi.ts#L24)

```text
interface OpenApiSchemaProjectionContext
  Context supplied when OpenAPI needs a schema-library-specific projection.

  readonly purpose: "request" | "response"
    Whether this schema projection describes request input or response output.
  readonly specVersion: OpenApiSpecVersion
    OpenAPI document version selected by the projection owner.
  readonly target: "draft-2020-12"
    JSON Schema draft requested from this schema-library adapter.
```

### endpoint-openapi: OpenApiServer

[Declaration source](endpoint/openapi.ts#L40)

```text
interface OpenApiServer
  One server origin advertised by an OpenAPI document.

  readonly url: string
    Explicit URL used by this contract; transport owners validate origins separately.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
```

### endpoint-openapi: OpenApiSchemaProjector

[Declaration source](endpoint/openapi.ts#L34)

```text
type OpenApiSchemaProjector = (schema: StandardSchemaV1, context: OpenApiSchemaProjectionContext) => unknown | undefined | Promise<unknown | undefined>
  Optional adapter used when a Standard Schema does not expose Standard JSON Schema directly.
```

### endpoint-openapi: OpenApiSpecVersion

[Declaration source](endpoint/openapi.ts#L21)

```text
type OpenApiSpecVersion = "3.1.0" | "3.1.1" | "3.1.2" | "3.2.0"
  OpenAPI document versions that this projector can emit.
```

## endpoint-path

Import `@okikio/server/endpoint/path`. [Source](./endpoint/path.ts).

### endpoint-path: joinPath

[Declaration source](endpoint/path.ts#L9)

```text
function joinPath(...parts: readonly string[]): string
  Join HTTP route-template fragments with one leading slash.

  This is deliberately not implemented with `@std/path`: filesystem paths are
  operating-system dependent, while HTTP route templates always use `/` and
  preserve parameter tokens such as `:importId`.
```

### endpoint-path: normalizePathTemplate

[Declaration source](endpoint/path.ts#L18)

```text
function normalizePathTemplate(path: string): string
  Convert parameter names to a stable shape used for route-collision checks.
```

### endpoint-path: pathParameters

[Declaration source](endpoint/path.ts#L23)

```text
function pathParameters(path: string): readonly string[]
  Return parameter names declared by one route template in authored order.
```

## endpoint-types

Import `@okikio/server/endpoint/types`. [Source](./endpoint/types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding        | Contract owner or source                                                   |
| ----------------------- | -------------------------------------------------------------------------- |
| `StandardSchemaV1`      | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `CatalogEntryIdentity`  | [catalog contracts](../catalog/API.md)                                     |
| `CatalogEntryValue`     | [catalog contracts](../catalog/API.md)                                     |
| `DefinitionEntry`       | [catalog contracts](../catalog/API.md)                                     |
| `DefinitionInput`       | [catalog contracts](../catalog/API.md)                                     |
| `ValuedCatalogEntry`    | [catalog contracts](../catalog/API.md)                                     |
| `ProblemDefinition`     | [http contracts](../http/API.md)                                           |
| `ProblemResult`         | [http contracts](../http/API.md)                                           |
| `ResponseDefinition`    | [http contracts](../http/API.md)                                           |
| `ResponseResult`        | [http contracts](../http/API.md)                                           |
| `Context`               | [context contracts](../context/API.md)                                     |
| `EffectContext`         | [effect contracts](../effect/API.md)                                       |
| `EffectDefinitions`     | [effect contracts](../effect/API.md)                                       |
| `RequestParsingOptions` | [http contracts](../http/API.md)                                           |
| `MiddlewareInput`       | [Source](middleware/mod.ts)                                                |
| `ResilienceInput`       | [resilience contracts](../resilience/API.md)                               |
| `RequirementInput`      | [requirement contracts](../requirement/API.md)                             |

### endpoint-types: AnyEndpointHandlerBinding

[Declaration source](endpoint/types.ts#L572)

```text
interface AnyEndpointHandlerBinding
  Runtime-erased endpoint binding used by heterogeneous composition utilities.

  readonly kind: "endpoint-handler"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly endpoint: EndpointDefinition
    Exact endpoint path contract to which this binding belongs.
  readonly operation: EndpointOperation
    Exact method-operation contract selected within the endpoint.
  readonly handle: AnyEndpointHandler
    Runtime behavior bound to the exact declaration; the host supplies its request lifetime.
```

### endpoint-types: EndpointContributions

[Declaration source](endpoint/types.ts#L111)

```text
interface EndpointContributions
  Static cross-cutting values contributed by a group, path, or operation.

  readonly middleware?: MiddlewareInput
    Declared middleware contributions or their compiled placement plan.
  readonly authentication?: DefinitionInput<CatalogEntryIdentity>
    Authentication contracts required by the selected operation; the host supplies their evaluator.
  readonly requirements?: RequirementInput
    Active requirement declarations; declaring them does not itself authorize work.
  readonly effects?: EffectDefinitions
    Required one-way consequences that code in this endpoint scope may announce.
  readonly resources?: DefinitionInput<EndpointResourceDefinition>
    Resource contracts reachable through this declaration; the live host owns acquisition.
  readonly problems?: DefinitionInput<ProblemDefinition>
    Declared HTTP problem contracts or their projected IDs.
  readonly responses?: DefinitionInput<ResponseDefinition>
    Declared successful response contracts or their projected IDs.
  readonly resiliency?: ResilienceInput
    Declared resilience policies; each policy retains a designated runtime owner.
```

### endpoint-types: EndpointDefinition

[Declaration source](endpoint/types.ts#L245)

```text
interface EndpointDefinition<Path extends string = string, SharedInput extends EndpointInputSlots = EndpointInputSlots, Operations extends readonly EndpointOperation[] = readonly EndpointOperation[], Resources extends EndpointResourceDefinition = EndpointResourceDefinition, Problems extends ProblemDefinition = ProblemDefinition> extends CatalogEntryIdentity, Omit<EndpointDocumentation, "operationId">, Omit<EndpointContributions, "responses" | "resources" | "problems">
  Immutable path contract containing one or more method operations.

  readonly kind: "endpoint"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly path: Path
    Declared route pathname or prefix; path parameters retain the endpoint grammar.
  readonly inputs: SharedInput
    Declared request input slots or their compiled validation steps.
  readonly operations: Operations
    Method operations retained in this endpoint path.
  readonly resources?: DefinitionInput<Resources>
    Resource contracts reachable through this declaration; the live host owns acquisition.
  readonly problems?: DefinitionInput<Problems>
    Declared HTTP problem contracts or their projected IDs.
```

### endpoint-types: EndpointDocument

[Declaration source](endpoint/types.ts#L403)

```text
interface EndpointDocument
  JSON-safe endpoint projection with fully composed path.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly path: string
    Declared route pathname or prefix; path parameters retain the endpoint grammar.
  readonly groupIds: readonly string[]
    Enclosing endpoint group identities retained in the projected path.
  readonly operations: readonly EndpointOperationDocument[]
    Method operations retained in this endpoint path.
```

### endpoint-types: EndpointDocumentation

[Declaration source](endpoint/types.ts#L131)

```text
interface EndpointDocumentation
  Common human-facing metadata for endpoint definitions.

  readonly operationId?: string
    Stable operation identity used by generated clients, routing and diagnostics.
  readonly summary?: string
    Short explanation shown beside this operation or example in generated references.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
  readonly tags?: readonly string[]
    Documentation groups assigned to this operation.
  readonly deprecated?: boolean
    Whether generated API references should mark this operation deprecated.
  readonly internal?: boolean
    Whether this contract is intended for internal exposure rather than a public projection.
```

### endpoint-types: EndpointExample

[Declaration source](endpoint/types.ts#L33)

```text
interface EndpointExample<Value = unknown>
  Concrete request or response example retained for generated documentation.

  readonly key: string
    Authored name of this entry or example in its containing catalog.
  readonly summary?: string
    Short explanation shown beside this operation or example in generated references.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
  readonly value: Value
    Concrete example payload retained for generated documentation.
```

### endpoint-types: EndpointGroup

[Declaration source](endpoint/types.ts#L315)

```text
interface EndpointGroup<Path extends string = string, Entries extends Readonly<Record<string, EndpointEntry>> | undefined = Readonly<Record<string, EndpointEntry>> | undefined> extends CatalogEntryIdentity, Omit<EndpointDocumentation, "operationId">, Omit<EndpointContributions, "responses">
  Static endpoint group with a shared path prefix and contributions.

  readonly kind: "endpoint-group"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly path: Path
    Declared route pathname or prefix; path parameters retain the endpoint grammar.
  readonly endpoints: readonly EndpointEntry[]
    Exact endpoint composition or selected bindings retained by this contract.
  readonly entries?: Entries
    Named exact entries retained by this group.
```

### endpoint-types: EndpointGroupSelection

[Declaration source](endpoint/types.ts#L332)

```text
interface EndpointGroupSelection<Group extends EndpointGroup = EndpointGroup, Entries extends Readonly<Record<string, EndpointEntry>> = Readonly<Record<string, EndpointEntry>>> extends CatalogEntryIdentity
  Key-preserving immutable selection from a named endpoint group.

  readonly kind: "endpoint-group-selection"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly source: Group
    Original declaration from which this selection was made.
  readonly keys: readonly (keyof Entries & string)[]
    Authored entry names retained by this selection.
  readonly endpoints: readonly EndpointEntry[]
    Exact endpoint composition or selected bindings retained by this contract.
```

### endpoint-types: EndpointHandlerBinding

[Declaration source](endpoint/types.ts#L515)

```text
interface EndpointHandlerBinding<Endpoint extends EndpointDefinition = EndpointDefinition, Operation extends EndpointOperation = EndpointOperation, Host extends object = EmptyEndpointHost, Values extends EndpointRequestValues = EndpointRequestValues>
  Direct binding between imported endpoint/operation values and behavior.

  readonly kind: "endpoint-handler"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly endpoint: Endpoint
    Exact endpoint path contract to which this binding belongs.
  readonly operation: Operation
    Exact method-operation contract selected within the endpoint.
  readonly handle: EndpointHandler<Endpoint, Operation, Host, Values>
    Runtime behavior bound to the exact declaration; the host supplies its request lifetime.
```

### endpoint-types: EndpointHandlerSet

[Declaration source](endpoint/types.ts#L584)

```text
interface EndpointHandlerSet<Endpoint extends EndpointDefinition = EndpointDefinition, Bindings extends readonly AnyEndpointHandlerBinding[] = readonly AnyEndpointHandlerBinding[]>
  Complete handler set for a multi-method endpoint.

  readonly kind: "endpoint-handlers"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly endpoint: Endpoint
    Exact endpoint path contract to which this binding belongs.
  readonly bindings: Bindings
    Runtime handlers bound to the exact operations of this endpoint.
```

### endpoint-types: EndpointInput

[Declaration source](endpoint/types.ts#L45)

```text
interface EndpointInput<Schema extends EndpointSchema = EndpointSchema>
  Transport-specific documentation wrapped around a first-class schema.

  readonly kind: "endpoint-input"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly schema: Schema
    Standard Schema validator and transform for the value accepted by this contract.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
  readonly required?: boolean
    Whether the declared request input must be present.
  readonly contentType?: string
    Declared HTTP media type for this input or response body.
  readonly examples?: readonly EndpointExample[]
    Concrete authored examples retained for API documentation.
  readonly jsonSchema?: unknown
    Explicit JSON Schema projection when the validator alone cannot describe the wire shape.
  readonly parsing?: RequestParsingOptions
    Optional transport parsing policy applied before this schema validates the request value.
```

### endpoint-types: EndpointInputSlots

[Declaration source](endpoint/types.ts#L68)

```text
interface EndpointInputSlots
  Flat request input locations accepted by operations and paths.

  readonly param?: EndpointInputSlot
    Schema or input declaration for path parameters.
  readonly query?: EndpointInputSlot
    Schema or input declaration for query parameters.
  readonly header?: EndpointInputSlot
    Schema or input declaration for request headers.
  readonly cookie?: EndpointInputSlot
    Schema or input declaration for request cookies.
  readonly json?: EndpointInputSlot
    Schema or input declaration for a JSON request body.
  readonly form?: EndpointInputSlot
    Schema or input declaration for form fields and files.
  readonly raw?: EndpointInputSlot
    Schema or input declaration for the raw request body.
```

### endpoint-types: EndpointOperation

[Declaration source](endpoint/types.ts#L172)

```text
interface EndpointOperation<Method extends EndpointMethod = EndpointMethod, Inputs extends EndpointInputSlots = EndpointInputSlots, Responses extends ResponseDefinition = ResponseDefinition, Problems extends ProblemDefinition = ProblemDefinition, Resources extends EndpointResourceDefinition = EndpointResourceDefinition> extends CatalogEntryIdentity, EndpointDocumentation, Omit<EndpointContributions, "responses" | "problems" | "resources">
  Immutable path-independent method contract.

  readonly kind: "endpoint-operation"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly method: Method
    HTTP method selected for this operation or route.
  readonly operationId: string
    Stable operation identity used by generated clients, routing and diagnostics.
  readonly inputs: Inputs
    Declared request input slots or their compiled validation steps.
  readonly responses?: DefinitionInput<Responses>
    Declared successful response contracts or their projected IDs.
  readonly problems?: DefinitionInput<Problems>
    Declared HTTP problem contracts or their projected IDs.
  readonly resources?: DefinitionInput<Resources>
    Resource contracts reachable through this declaration; the live host owns acquisition.
  readonly rawResponse: boolean
    Whether this operation deliberately permits a native Response instead of a declared response tuple.
```

### endpoint-types: EndpointOperationDocument

[Declaration source](endpoint/types.ts#L373)

```text
interface EndpointOperationDocument
  JSON-safe operation projection.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly method: EndpointMethod
    HTTP method selected for this operation or route.
  readonly operationId: string
    Stable operation identity used by generated clients, routing and diagnostics.
  readonly summary?: string
    Short explanation shown beside this operation or example in generated references.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
  readonly tags: readonly string[]
    Documentation groups assigned to this operation.
  readonly deprecated: boolean
    Whether generated API references should mark this operation deprecated.
  readonly internal: boolean
    Whether this contract is intended for internal exposure rather than a public projection.
  readonly inputs: readonly EndpointInputSource[]
    Declared request input slots or their compiled validation steps.
  readonly responses: readonly string[]
    Declared successful response contracts or their projected IDs.
  readonly problems: readonly string[]
    Declared HTTP problem contracts or their projected IDs.
  readonly resources: readonly string[]
    Resource contracts reachable through this declaration; the live host owns acquisition.
  readonly effects: readonly string[]
    Effect IDs declared by the effective endpoint path and operation.
```

### endpoint-types: EndpointResourceResolver

[Declaration source](endpoint/types.ts#L433)

```text
interface EndpointResourceResolver<Allowed extends EndpointResourceDefinition = EndpointResourceDefinition>
  Resolver constrained to resources declared by the effective operation.

  has(definition: Definition): boolean
    Test whether the exact declared resource is available in this resolver.
  get(definition: Definition): Promise<EndpointResourceValue<Definition>>
    Borrow an allowed resource from its live owner; acquisition failures reject the returned promise.
```

### endpoint-types: EndpointValidationIssue

[Declaration source](endpoint/types.ts#L347)

```text
interface EndpointValidationIssue
  One deterministic endpoint validation issue.

  readonly code: "invalid-id" | "invalid-path" | "missing-operation" | "missing-result" | "duplicate-method" | "duplicate-id" | "duplicate-operation-id" | "body-method-conflict" | "raw-body-conflict" | "missing-path-schema" | "ambiguous-route"
    Stable failure code; callers should branch on this instead of matching explanation text.
  readonly message: string
    Human-readable diagnostic explanation; it is not a stable program discriminator.
  readonly definition?: EndpointEntry | EndpointOperation
    Exact endpoint declaration associated with this validation issue, when available.
```

### endpoint-types: ErasedEndpointHandlerContext

[Declaration source](endpoint/types.ts#L542)

```text
interface ErasedEndpointHandlerContext
  Runtime context shape shared by heterogeneous compiled handler collections.

  readonly request: Request
    Web Request borrowed for this operation; body ownership follows the enclosing transport contract.
  readonly host: object
    Application-owned host values supplied by the composition root.
  readonly input: EndpointRuntimeInputValues
    Validated request values retained in the heterogeneous handler binding view.
  readonly resources: EndpointResourceResolver
    Borrowed resolver for the selected operation resources; the host owns their cleanup.
  readonly ctx: EndpointContext
    Execution context borrowed from the request lifetime owner for cancellation, timing and effects.
```

### endpoint-types: AnyEndpointHandler

[Declaration source](endpoint/types.ts#L565)

```text
type AnyEndpointHandler = { bivarianceHack(context: ErasedEndpointHandlerContext): EndpointHandlerResult<EndpointOperation> | Promise<EndpointHandlerResult<EndpointOperation>>; }["bivarianceHack"]
  Callable shape used to retain differently specialized endpoint handlers in one
  compiled collection.

  The method-signature extraction intentionally makes the parameter bivariant.
  Each handler remains exact at `handler()` authoring sites, while heterogeneous
  service composition can retain those handlers without replacing their known
  context with `any`, `unknown`, or a `never` cast. The service compiler still
  invokes a binding only for its exact endpoint and operation identities.
```

### endpoint-types: DefinedEndpointOperation

[Declaration source](endpoint/types.ts#L219)

```text
type DefinedEndpointOperation<Method extends EndpointMethod, Input extends EndpointOperationInput> = EndpointOperation<Method, PickEndpointInputSlots<Input>, EndpointOperationResponses<Input>, EndpointOperationProblems<Input>, EndpointOperationResources<Input>>
  Fully inferred operation type produced from one authoring input.
```

### endpoint-types: EmptyEndpointHost

[Declaration source](endpoint/types.ts#L453)

```text
type EmptyEndpointHost = Readonly<Record<never, never>>
  Empty host value used when an endpoint handler does not require host state.
```

### endpoint-types: EndpointCompositionInput

[Declaration source](endpoint/types.ts#L294)

```text
type EndpointCompositionInput = EndpointEntry | readonly EndpointCompositionInput[]
  Recursive endpoint composition input accepted by groups, services, and gateways.
```

### endpoint-types: EndpointContext

[Declaration source](endpoint/types.ts#L441)

```text
type EndpointContext = EffectContext<Context>
  Request execution context propagated by the owning host.
```

### endpoint-types: EndpointDefinitionInput

[Declaration source](endpoint/types.ts#L231)

```text
type EndpointDefinitionInput<Path extends string = string, Operations extends readonly EndpointOperation[] = readonly EndpointOperation[]> = Readonly<{ readonly id: string; readonly path: Path; readonly operations: Operations; }> & Omit<EndpointDocumentation, "operationId"> & EndpointInputSlots & Omit<EndpointContributions, "responses">
  Input accepted by a multi-method endpoint path.
```

### endpoint-types: EndpointDefinitionProblems

[Declaration source](endpoint/types.ts#L276)

```text
type EndpointDefinitionProblems<Input extends EndpointContributions> = Extract<DefinitionEntry<NonNullable<Input["problems"]>>, ProblemDefinition>
  Problem definitions represented by one endpoint path authoring input.
```

### endpoint-types: EndpointDefinitionResources

[Declaration source](endpoint/types.ts#L270)

```text
type EndpointDefinitionResources<Input extends EndpointContributions> = Extract<DefinitionEntry<NonNullable<Input["resources"]>>, EndpointResourceDefinition>
  Resource definitions represented by one endpoint path authoring input.
```

### endpoint-types: EndpointEntry

[Declaration source](endpoint/types.ts#L291)

```text
type EndpointEntry = EndpointDefinition | EndpointGroup | EndpointGroupSelection
  One concrete endpoint, group, or group selection accepted by composition.
```

### endpoint-types: EndpointGroupInput

[Declaration source](endpoint/types.ts#L302)

```text
type EndpointGroupInput<Path extends string = string, Members extends EndpointGroupMembers = EndpointGroupMembers> = Readonly<{ readonly id: string; readonly path: Path; readonly endpoints: Members; }> & Omit<EndpointDocumentation, "operationId"> & Omit<EndpointContributions, "responses">
  Input accepted by an endpoint group.
```

### endpoint-types: EndpointGroupMembers

[Declaration source](endpoint/types.ts#L297)

```text
type EndpointGroupMembers = Readonly<Record<string, EndpointEntry>> | EndpointCompositionInput
  Named or direct endpoint-group members.
```

### endpoint-types: EndpointHandler

[Declaration source](endpoint/types.ts#L505)

```text
type EndpointHandler<Endpoint extends EndpointDefinition, Operation extends EndpointOperation, Host extends object = EmptyEndpointHost, Values extends EndpointRequestValues = EndpointRequestValues> = (context: EndpointHandlerContext<Endpoint, Operation, Host, Values>) => EndpointHandlerResult<Operation> | Promise<EndpointHandlerResult<Operation>>
  Handler function for one exact endpoint operation.
```

### endpoint-types: EndpointHandlerContext

[Declaration source](endpoint/types.ts#L463)

```text
type EndpointHandlerContext<Endpoint extends EndpointDefinition = EndpointDefinition, Operation extends EndpointOperation = EndpointOperation, Host extends object = EmptyEndpointHost, Values extends EndpointRequestValues = EndpointRequestValues> = Readonly<{ readonly request: Request; readonly host: Host; readonly input: InferEndpointInputs<MergeEndpointInputs<Endpoint["inputs"], Operation["inputs"]>>; readonly resources: EndpointResourceResolver<EndpointResources<Endpoint, Operation>>; readonly ctx: EndpointContext; } & Values>
  Portable handler context specialized by a service runtime adapter.

  Request values are intersected with the fixed HTTP context instead of being
  reduced to a hard-coded field list. A domain package can therefore add
  provider-neutral values such as `session`, `identity`, or `membership` and
  keep those exact types from authentication through the endpoint handler.
```

### endpoint-types: EndpointHandlerResult

[Declaration source](endpoint/types.ts#L499)

```text
type EndpointHandlerResult<Operation extends EndpointOperation> = ResponseResult<OperationResponse<Operation>> | ProblemResult<OperationProblem<Operation>> | (Operation["rawResponse"] extends true ? Response : never)
  Declared result union for one endpoint operation.
```

### endpoint-types: EndpointInputSchema

[Declaration source](endpoint/types.ts#L86)

```text
type EndpointInputSchema<Slot> = Slot extends EndpointInput<infer Schema> ? Schema : Slot extends EndpointSchema ? Slot : never
  Extract the schema carried by one endpoint input slot.
```

### endpoint-types: EndpointInputSlot

[Declaration source](endpoint/types.ts#L65)

```text
type EndpointInputSlot<Schema extends EndpointSchema = EndpointSchema> = Schema | EndpointInput<Schema>
  Bare or documented schema accepted by one request location.
```

### endpoint-types: EndpointInputSource

[Declaration source](endpoint/types.ts#L27)

```text
type EndpointInputSource = "param" | "query" | "header" | "cookie" | "json" | "form" | "raw"
  Request locations understood by the endpoint compiler.
```

### endpoint-types: EndpointMethod

[Declaration source](endpoint/types.ts#L24)

```text
type EndpointMethod = "get" | "post" | "put" | "patch" | "delete" | "options" | "head"
  HTTP methods supported by endpoint definitions.
```

### endpoint-types: EndpointOperationInput

[Declaration source](endpoint/types.ts#L147)

```text
type EndpointOperationInput = Readonly<{ readonly id: string; readonly method?: EndpointMethod; readonly rawResponse?: boolean; }> & EndpointDocumentation & EndpointInputSlots & EndpointContributions
  Input accepted by a method-operation definition.
```

### endpoint-types: EndpointOperationProblems

[Declaration source](endpoint/types.ts#L207)

```text
type EndpointOperationProblems<Input extends EndpointOperationInput> = Extract<DefinitionEntry<NonNullable<Input["problems"]>>, ProblemDefinition>
  Problem definitions represented by one operation authoring input.
```

### endpoint-types: EndpointOperationResources

[Declaration source](endpoint/types.ts#L213)

```text
type EndpointOperationResources<Input extends EndpointOperationInput> = Extract<DefinitionEntry<NonNullable<Input["resources"]>>, EndpointResourceDefinition>
  Resource definitions represented by one operation authoring input.
```

### endpoint-types: EndpointOperationResponses

[Declaration source](endpoint/types.ts#L201)

```text
type EndpointOperationResponses<Input extends EndpointOperationInput> = Extract<DefinitionEntry<NonNullable<Input["responses"]>>, ResponseDefinition>
  Response definitions represented by one operation authoring input.
```

### endpoint-types: EndpointRequestValues

[Declaration source](endpoint/types.ts#L450)

```text
type EndpointRequestValues = Readonly<Record<never, never>>
  Empty base contract for application-owned values added during request execution.

  Applications extend this type with exact provider-neutral values such as a
  session, principal, membership, tenant, or authorization snapshot. The
  endpoint package does not reserve domain field names.
```

### endpoint-types: EndpointResourceDefinition

[Declaration source](endpoint/types.ts#L18)

```text
type EndpointResourceDefinition<Value = unknown> = ValuedCatalogEntry<"resource", Value>
  Static resource reference accepted by portable endpoint contracts.
```

### endpoint-types: EndpointResourceValue

[Declaration source](endpoint/types.ts#L21)

```text
type EndpointResourceValue<Definition extends EndpointResourceDefinition> = CatalogEntryValue<Definition>
  Runtime value represented by one endpoint resource reference.
```

### endpoint-types: EndpointResources

[Declaration source](endpoint/types.ts#L427)

```text
type EndpointResources<Endpoint extends EndpointDefinition, Operation extends EndpointOperation> = PathResource<Endpoint> | OperationResource<Operation>
  Effective resource definitions available to an endpoint handler.
```

### endpoint-types: EndpointRuntimeInputValues

[Declaration source](endpoint/types.ts#L532)

```text
type EndpointRuntimeInputValues = Readonly<Partial<Record<EndpointInputSource, unknown>>>
  Values retained after request-location parsing but before handler specialization.
```

### endpoint-types: EndpointSchema

[Declaration source](endpoint/types.ts#L30)

```text
type EndpointSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>
  Standard Schema-compatible runtime validation contract.
```

### endpoint-types: EndpointValidationResult

[Declaration source](endpoint/types.ts#L368)

```text
type EndpointValidationResult = Readonly<{ readonly valid: true; readonly endpoints: readonly EndpointDefinition[]; }> | Readonly<{ readonly valid: false; readonly issues: readonly EndpointValidationIssue[]; }>
  Deterministic endpoint validation result.
```

[Declaration source](endpoint/types.ts#L158)

```text
private type ExplicitEndpointInputSlots<Input> = readonly [Source in EndpointInputSource as Input extends Readonly<Record<Source, infer Slot>> ? Exclude<Slot, undefined> extends EndpointInputSlot ? Source : never : never]: Input extends Readonly<Record<Source, infer Slot>> ? Exclude<Slot, undefined> : never
  Pick only explicitly authored request-location fields from a flat endpoint input.
```

### endpoint-types: InferEndpointInputs

[Declaration source](endpoint/types.ts#L98)

```text
type InferEndpointInputs<Inputs extends EndpointInputSlots> = readonly [Source in keyof Inputs as Inputs[Source] extends undefined ? never : Source]: StandardSchemaV1.InferOutput<EndpointInputSchema<NonNullable<Inputs[Source]>>>
  Parsed and validated output values exposed to an endpoint handler.
```

### endpoint-types: InferEndpointWireInputs

[Declaration source](endpoint/types.ts#L91)

```text
type InferEndpointWireInputs<Inputs extends EndpointInputSlots> = readonly [Source in keyof Inputs as Inputs[Source] extends undefined ? never : Source]: StandardSchemaV1.InferInput<EndpointInputSchema<NonNullable<Inputs[Source]>>>
  Wire/authored input values callers must provide before schema transforms.
```

### endpoint-types: MergeEndpointInputs

[Declaration source](endpoint/types.ts#L105)

```text
type MergeEndpointInputs<Shared extends EndpointInputSlots, Operation extends EndpointInputSlots> = Omit<Shared, keyof Operation> & Operation
  Merge path-level inputs with operation-level inputs.
```

### endpoint-types: OperationProblem

[Declaration source](endpoint/types.ts#L489)

```text
type OperationProblem<Operation extends EndpointOperation> = Operation extends EndpointOperation<EndpointMethod, EndpointInputSlots, ResponseDefinition, infer ProblemDefinition_, EndpointResourceDefinition> ? ProblemDefinition_ : never
  Problem definition union retained by an operation.
```

### endpoint-types: OperationResource

[Declaration source](endpoint/types.ts#L415)

```text
type OperationResource<Operation extends EndpointOperation> = Operation extends EndpointOperation<EndpointMethod, EndpointInputSlots, ResponseDefinition, ProblemDefinition, infer Resource> ? Resource : never
  Resource definition union retained by an operation.
```

### endpoint-types: OperationResponse

[Declaration source](endpoint/types.ts#L479)

```text
type OperationResponse<Operation extends EndpointOperation> = Operation extends EndpointOperation<EndpointMethod, EndpointInputSlots, infer ResponseDefinition_, ProblemDefinition, EndpointResourceDefinition> ? ResponseDefinition_ : never
  Response definition union retained by an operation.
```

### endpoint-types: PathResource

[Declaration source](endpoint/types.ts#L421)

```text
type PathResource<Endpoint extends EndpointDefinition> = Endpoint extends EndpointDefinition<string, EndpointInputSlots, readonly EndpointOperation[], infer Resource, ProblemDefinition> ? Resource : never
  Resource definition union retained by an endpoint path.
```

### endpoint-types: PickEndpointInputSlots

[Declaration source](endpoint/types.ts#L167)

```text
type PickEndpointInputSlots<Input> = Input extends EndpointOperationInput ? EndpointOperationInput extends Input ? EndpointInputSlots : ExplicitEndpointInputSlots<Input> : ExplicitEndpointInputSlots<Input>
  Preserve exact authored schemas while retaining a broad shape for heterogeneous operations.
```

### endpoint-types: SingleMethodEndpointInput

[Declaration source](endpoint/types.ts#L282)

```text
type SingleMethodEndpointInput<Path extends string = string> = Readonly<{ readonly id: string; readonly path: Path; readonly rawResponse?: boolean; }> & EndpointDocumentation & EndpointInputSlots & EndpointContributions
  Complete single-method endpoint authoring input.
```

## gateway

Import `@okikio/server/gateway`. [Source](./gateway/mod.ts).

Derive upstream route ownership from an imported service contract without copying route strings.

Compilation does not start the upstream service or fetch the origin. Add credential, timeout and redirect policies
explicitly before creating the gateway runtime. Service authorization remains with the service; an edge policy does not
grant domain permissions.

### gateway: compile

[Declaration source](gateway/compile.ts#L107)

```text
function compile<Definition extends GatewayDefinition>(definition: Definition, options: CompileGatewayOptions): CompiledGateway<Definition>
  Compile import-safe service definitions into one deterministic edge route table.
```

### gateway: create

[Declaration source](gateway/runtime.ts#L88)

```text
function create(compiled: CompiledGateway, options: CreateGatewayOptions): GatewayRuntime
  Create a fetch-compatible runtime from one compiled gateway.
```

### gateway: document

[Declaration source](gateway/compile.ts#L212)

```text
function document(compiled: CompiledGateway): GatewayManifest
  Return the JSON-safe gateway manifest retained by a compiled gateway.
```

### gateway: match

[Declaration source](gateway/runtime.ts#L47)

```text
function match(compiled: CompiledGateway, request: Pick<Request, "method" | "url">): CompiledGatewayRoute | undefined
  Match one request against the compiler-prepared public route table.
```

### gateway: prepare

[Declaration source](gateway/runtime.ts#L66)

```text
async function prepare(request: Request, options: PrepareGatewayRequestOptions): Promise<PreparedGatewayRequest>
  Prepare one request for a trusted downstream hop using the gateway's generic transport rules.

  This is the same trust normalization used by compiled service forwarding: caller-owned
  forwarding and reserved trust headers are removed, correlation is reconstructed, and
  forwarding metadata is derived only from the host-trusted client address. It intentionally
  does not choose a route or apply service credential policy, so application composition can
  use it for provider proxy paths and unmatched frontend continuation without duplicating the
  security-sensitive header mechanics.
```

### gateway: validate

[Declaration source](gateway/compile.ts#L66)

```text
function validate(definition: GatewayDefinition): GatewayValidationResult
  Validate mount and policy ownership without requiring service artifacts.
```

### gateway: GatewayProblems

[Declaration source](gateway/problems.ts#L3)

```text
const GatewayProblems
  Framework-owned failures emitted before an origin service receives a request.
```

### gateway: GatewayCompilationError

[Declaration source](gateway/compile.ts#L49)

```text
class GatewayCompilationError extends Error
  Error raised when a gateway cannot be compiled safely.

  constructor(issues: readonly GatewayValidationIssue[])
    Retain gateway validation issues when compilation cannot produce a valid route set.
  readonly issues: readonly GatewayValidationIssue[]
    Structured validation issues retained for inspection without matching error messages.
```

### gateway: CompileGatewayOptions

[Declaration source](gateway/mod.ts#L42)

```text
reference CompileGatewayOptions: ./packages/server/gateway/types.ts:217:1
```

### gateway: CompiledGateway

[Declaration source](gateway/mod.ts#L40)

```text
reference CompiledGateway: ./packages/server/gateway/types.ts:313:1
```

### gateway: CompiledGatewayRoute

[Declaration source](gateway/mod.ts#L41)

```text
reference CompiledGatewayRoute: ./packages/server/gateway/types.ts:223:1
```

### gateway: CreateGatewayOptions

[Declaration source](gateway/mod.ts#L43)

```text
reference CreateGatewayOptions: ./packages/server/gateway/types.ts:425:1
```

### gateway: GatewayCachePolicy

[Declaration source](gateway/mod.ts#L44)

```text
reference GatewayCachePolicy: ./packages/server/gateway/types.ts:30:1
```

### gateway: GatewayCredentialPolicy

[Declaration source](gateway/mod.ts#L45)

```text
reference GatewayCredentialPolicy: ./packages/server/gateway/types.ts:35:1
```

### gateway: GatewayDefinition

[Declaration source](gateway/mod.ts#L46)

```text
reference GatewayDefinition: ./packages/server/gateway/types.ts:176:1
```

### gateway: GatewayDefinitionInput

[Declaration source](gateway/mod.ts#L47)

```text
reference GatewayDefinitionInput: ./packages/server/gateway/types.ts:190:1
```

### gateway: GatewayManifest

[Declaration source](gateway/mod.ts#L48)

```text
reference GatewayManifest: ./packages/server/gateway/types.ts:303:1
```

### gateway: GatewayMetadataHeaders

[Declaration source](gateway/mod.ts#L49)

```text
reference GatewayMetadataHeaders: ./packages/server/gateway/types.ts:391:1
```

### gateway: GatewayMount

[Declaration source](gateway/mod.ts#L50)

```text
reference GatewayMount: ./packages/server/gateway/types.ts:18:1
```

### gateway: GatewayObserverDefinition

[Declaration source](gateway/mod.ts#L51)

```text
reference GatewayObserverDefinition: ./packages/server/gateway/types.ts:67:1
```

### gateway: GatewayObserverEvent

[Declaration source](gateway/mod.ts#L52)

```text
reference GatewayObserverEvent: ./packages/server/gateway/types.ts:84:1
```

### gateway: GatewayObserverEventKind

[Declaration source](gateway/mod.ts#L53)

```text
reference GatewayObserverEventKind: ./packages/server/gateway/types.ts:57:1
```

### gateway: GatewayObserverHandler

[Declaration source](gateway/mod.ts#L54)

```text
reference GatewayObserverHandler: ./packages/server/gateway/types.ts:120:1
```

### gateway: GatewayOrigin

[Declaration source](gateway/mod.ts#L55)

```text
reference GatewayOrigin: ./packages/server/gateway/types.ts:15:1
```

### gateway: GatewayPolicy

[Declaration source](gateway/mod.ts#L56)

```text
reference GatewayPolicy: ./packages/server/gateway/types.ts:130:1
```

### gateway: GatewayPolicyInput

[Declaration source](gateway/mod.ts#L57)

```text
reference GatewayPolicyInput: ./packages/server/gateway/types.ts:152:1
```

### gateway: GatewayRedirectPolicy

[Declaration source](gateway/mod.ts#L58)

```text
reference GatewayRedirectPolicy: ./packages/server/gateway/types.ts:47:1
```

### gateway: GatewayRequestPatch

[Declaration source](gateway/mod.ts#L59)

```text
reference GatewayRequestPatch: ./packages/server/gateway/types.ts:371:1
```

### gateway: GatewayRequestState

[Declaration source](gateway/mod.ts#L60)

```text
reference GatewayRequestState: ./packages/server/gateway/types.ts:357:1
```

### gateway: GatewayRouteManifestEntry

[Declaration source](gateway/mod.ts#L61)

```text
reference GatewayRouteManifestEntry: ./packages/server/gateway/types.ts:261:1
```

### gateway: GatewayRuntime

[Declaration source](gateway/mod.ts#L62)

```text
reference GatewayRuntime: ./packages/server/gateway/types.ts:453:1
```

### gateway: GatewayRuntimeAdapters

[Declaration source](gateway/mod.ts#L63)

```text
reference GatewayRuntimeAdapters: ./packages/server/gateway/types.ts:377:1
```

### gateway: GatewaySelection

[Declaration source](gateway/mod.ts#L64)

```text
reference GatewaySelection: ./packages/server/gateway/types.ts:204:1
```

### gateway: GatewayServiceArtifact

[Declaration source](gateway/mod.ts#L65)

```text
reference GatewayServiceArtifact: ./packages/server/gateway/types.ts:214:1
```

### gateway: GatewayValidationIssue

[Declaration source](gateway/mod.ts#L66)

```text
reference GatewayValidationIssue: ./packages/server/gateway/types.ts:336:1
```

### gateway: GatewayValidationResult

[Declaration source](gateway/mod.ts#L67)

```text
reference GatewayValidationResult: ./packages/server/gateway/types.ts:352:1
```

### gateway: GatewayValidationSubject

[Declaration source](gateway/mod.ts#L68)

```text
reference GatewayValidationSubject: ./packages/server/gateway/types.ts:327:1
```

### gateway: compose

[Declaration source](gateway/mod.ts#L25)

```text
reference compose: ./packages/server/gateway/definition.ts:190:1
```

### gateway: credentials

[Declaration source](gateway/mod.ts#L26)

```text
reference credentials: ./packages/server/gateway/definition.ts:82:1
```

### gateway: define

[Declaration source](gateway/mod.ts#L27)

```text
reference define: ./packages/server/gateway/definition.ts:30:1
```

### gateway: mount

[Declaration source](gateway/mod.ts#L28)

```text
reference mount: ./packages/server/gateway/definition.ts:21:1
```

### gateway: noStore

[Declaration source](gateway/mod.ts#L29)

```text
reference noStore: ./packages/server/gateway/definition.ts:218:1
```

### gateway: observer

[Declaration source](gateway/mod.ts#L30)

```text
reference observer: ./packages/server/gateway/definition.ts:159:14
```

### gateway: passThroughCache

[Declaration source](gateway/mod.ts#L31)

```text
reference passThroughCache: ./packages/server/gateway/definition.ts:223:1
```

### gateway: policy

[Declaration source](gateway/mod.ts#L32)

```text
reference policy: ./packages/server/gateway/definition.ts:55:1
```

### gateway: redirects

[Declaration source](gateway/mod.ts#L33)

```text
reference redirects: ./packages/server/gateway/definition.ts:92:1
```

### gateway: select

[Declaration source](gateway/mod.ts#L34)

```text
reference select: ./packages/server/gateway/definition.ts:162:1
```

## gateway-definition

Import `@okikio/server/gateway/definition`. [Source](./gateway/definition.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source                 |
| --------------------------- | ---------------------------------------- |
| `durationCore`              | [duration contracts](../duration/API.md) |
| `endpoint`                  | [Source](endpoint/definition.ts)         |
| `EndpointCompositionInput`  | [Source](endpoint/types.ts)              |
| `EndpointDefinition`        | [Source](endpoint/types.ts)              |
| `EndpointEntry`             | [Source](endpoint/types.ts)              |
| `ServiceDefinition`         | [Source](service/types.ts)               |
| `ServiceSelection`          | [Source](service/types.ts)               |
| `GatewayCachePolicy`        | [Source](gateway/types.ts)               |
| `GatewayCredentialPolicy`   | [Source](gateway/types.ts)               |
| `GatewayDefinition`         | [Source](gateway/types.ts)               |
| `GatewayDefinitionInput`    | [Source](gateway/types.ts)               |
| `GatewayMount`              | [Source](gateway/types.ts)               |
| `GatewayObserverDefinition` | [Source](gateway/types.ts)               |
| `GatewayObserverEventKind`  | [Source](gateway/types.ts)               |
| `GatewayObserverHandler`    | [Source](gateway/types.ts)               |
| `GatewayOrigin`             | [Source](gateway/types.ts)               |
| `GatewayPolicy`             | [Source](gateway/types.ts)               |
| `GatewayPolicyInput`        | [Source](gateway/types.ts)               |
| `GatewayRedirectPolicy`     | [Source](gateway/types.ts)               |
| `GatewaySelection`          | [Source](gateway/types.ts)               |

### gateway-definition: compose

[Declaration source](gateway/definition.ts#L190)

```text
function compose(...input: readonly (GatewayDefinition | GatewaySelection | readonly (GatewayDefinition | GatewaySelection)[])[]): readonly (GatewayDefinition | GatewaySelection)[]
  Compose gateway definitions or selections by direct identity.
```

### gateway-definition: credentials

[Declaration source](gateway/definition.ts#L82)

```text
function credentials(options: Partial<Omit<GatewayCredentialPolicy, "kind">>): GatewayCredentialPolicy
  Define explicit request/response credential forwarding behavior.
```

### gateway-definition: define

[Declaration source](gateway/definition.ts#L30)

```text
function define<Id extends string>(input: GatewayDefinitionInput<Id>): GatewayDefinition<Id>
  Define an import-safe gateway from exact mounted service references.
```

### gateway-definition: leafEndpoints

[Declaration source](gateway/definition.ts#L228)

```text
function leafEndpoints(input: EndpointCompositionInput): readonly EndpointDefinition[]
  Flatten an endpoint composition to exact leaf definitions without copying routes.
```

### gateway-definition: mount

[Declaration source](gateway/definition.ts#L21)

```text
function mount<Target extends ServiceDefinition | ServiceSelection>(target: Target, options: Readonly<{ readonly origin: GatewayOrigin; }>): GatewayMount<Target>
  Mount an exact service definition or selection at one origin.
```

### gateway-definition: noStore

[Declaration source](gateway/definition.ts#L218)

```text
function noStore(): GatewayCachePolicy
  Disable storage by shared or browser caches.
```

### gateway-definition: passThroughCache

[Declaration source](gateway/definition.ts#L223)

```text
function passThroughCache(): GatewayCachePolicy
  Preserve origin cache headers without adding gateway storage behavior.
```

### gateway-definition: policy

[Declaration source](gateway/definition.ts#L55)

```text
function policy(input: GatewayPolicyInput): GatewayPolicy
  Define one selector-based additive gateway policy.
```

### gateway-definition: redirects

[Declaration source](gateway/definition.ts#L92)

```text
function redirects(options: Readonly<{ readonly mode?: GatewayRedirectPolicy["mode"]; readonly allowedOrigins?: readonly (string | URL)[]; }>): GatewayRedirectPolicy
  Define how upstream manual redirect locations are exposed publicly.
```

### gateway-definition: select

[Declaration source](gateway/definition.ts#L162)

```text
function select<Gateway extends GatewayDefinition>(gateway: Gateway, input: Readonly<{ readonly id: string; readonly description?: string; readonly services: readonly (ServiceDefinition | ServiceSelection)[]; }>): GatewaySelection<Gateway>
  Select exact mounts from one gateway without copying routes.
```

### gateway-definition: observer

[Declaration source](gateway/definition.ts#L159)

```text
const observer
  Gateway lifecycle observer definition and handler namespace.

  Observers receive redacted metadata after route and trust decisions. They are
  for telemetry, security auditing, and completion accounting; they cannot
  mutate a request or response.
```

## gateway-types

Import `@okikio/server/gateway/types`. [Source](./gateway/types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source               |
| --------------------------- | -------------------------------------- |
| `CatalogEntryIdentity`      | [catalog contracts](../catalog/API.md) |
| `DefinitionInput`           | [catalog contracts](../catalog/API.md) |
| `RoutePlan`                 | [Source](http/types.ts)                |
| `EndpointCompositionInput`  | [Source](endpoint/types.ts)            |
| `EndpointDefinition`        | [Source](endpoint/types.ts)            |
| `EndpointMethod`            | [Source](endpoint/types.ts)            |
| `ProblemResult`             | [http contracts](../http/API.md)       |
| `RequestCorrelation`        | [http contracts](../http/API.md)       |
| `CompiledService`           | [Source](service/types.ts)             |
| `ServiceDefinition`         | [Source](service/types.ts)             |
| `ServiceManifest`           | [Source](service/types.ts)             |
| `ServiceRoute`              | [Source](service/types.ts)             |
| `ServiceRouteManifestEntry` | [Source](service/types.ts)             |
| `ServiceSelection`          | [Source](service/types.ts)             |

### gateway-types: CompileGatewayOptions

[Declaration source](gateway/types.ts#L217)

```text
interface CompileGatewayOptions
  Options supplied to `gateway.compile()`.

  readonly services?: readonly GatewayServiceArtifact[]
    Optional compiled manifests used only to detect definition/runtime drift.
```

### gateway-types: CompiledGateway

[Declaration source](gateway/types.ts#L313)

```text
interface CompiledGateway<Definition extends GatewayDefinition = GatewayDefinition>
  Compiled gateway ready for a host runtime.

  readonly kind: "compiled-gateway"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly definition: Definition
    Exact declaration involved in this binding, result or validation issue.
  readonly routes: readonly CompiledGatewayRoute[]
    Authored or compiled route entries retained by this application or manifest.
  readonly routePlan: RoutePlan
    Prepared handler-free route metadata bound to the corresponding runtime handlers.
  readonly manifest: GatewayManifest
    Deterministic data projection for inspection, deployment and drift checks.
```

### gateway-types: CompiledGatewayRoute

[Declaration source](gateway/types.ts#L223)

```text
interface CompiledGatewayRoute
  Fully resolved edge route.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly gateway: GatewayDefinition
    Exact gateway declaration retained by this route or selection.
  readonly serviceId: string
    Identity of the service selected for this route or observation.
  readonly serviceRouteId: string
    Route identity defined by the mounted service before gateway compilation.
  readonly endpointId: string
    Identity of the selected endpoint path contract.
  readonly operationId: string
    Stable operation identity used by generated clients, routing and diagnostics.
  readonly method: Uppercase<EndpointMethod>
    HTTP method selected for this operation or route.
  readonly path: string
    Declared route pathname or prefix; path parameters retain the endpoint grammar.
  readonly origin: string
    Host-resolved upstream service origin for this mount or route.
  readonly authenticate: readonly CatalogEntryIdentity[]
    Host-owned evaluation of the declared authentication contracts before forwarding or operation admission.
  readonly assertions: readonly CatalogEntryIdentity[]
    Compiled assertion contracts or their manifest IDs, evaluated by an explicit host adapter.
  readonly timeout?: Temporal.Duration
    Request timeout retained as a duration, or serialized duration text in a manifest.
  readonly bodyLimit?: number
    Maximum request-body bytes admitted by this runtime policy.
  readonly cache: GatewayCachePolicy
    Explicit gateway cache behavior; this contract does not create an application cache.
  readonly credentials: GatewayCredentialPolicy
    Explicit policy for caller credential and upstream cookie forwarding.
  readonly redirects: GatewayRedirectPolicy
    Explicit policy for preserving, rewriting or rejecting upstream Location fields.
  readonly observers: readonly GatewayObserverDefinition[]
    Observer declarations or exact host-supplied handlers; observers remain outside result authority.
```

### gateway-types: CreateGatewayOptions

[Declaration source](gateway/types.ts#L425)

```text
interface CreateGatewayOptions extends PrepareGatewayRequestOptions
  Runtime options for one compiled gateway.

  readonly fetch?: typeof fetch
    Upstream Fetch adapter; defaults to native Fetch. Single gzip and br response
    bodies must contain decoded bytes. The gateway removes their encoded length
    and encoding headers, while bodyless responses retain representation metadata.
    For other codings, normalize these headers in the adapter if it decodes bytes;
    runtime support differs. An adapter that returns raw gzip/br bytes must decode
    them before returning the response.
  readonly adapters?: GatewayRuntimeAdapters
    Host-supplied authentication, requirement or transport capabilities; no provider is chosen implicitly.
  readonly metadataHeaders?: GatewayMetadataHeaders
    Optional product/host header names for trusted routing metadata. No product prefix is chosen by default.
  readonly onError?: (error: Error, state?: GatewayRequestState) => void | Promise<void>
    Observe an unexpected runtime failure; the runtime retains response and cleanup authority.
  readonly observers?: readonly GatewayObserverHandler[]
    Observer declarations or exact host-supplied handlers; observers remain outside result authority.
```

### gateway-types: GatewayCredentialPolicy

[Declaration source](gateway/types.ts#L35)

```text
interface GatewayCredentialPolicy
  Explicit caller credential forwarding policy.

  readonly kind: "gateway-credentials"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly requestCookies: "preserve" | "strip"
    Explicit policy for retaining or stripping inbound Cookie headers.
  readonly requestAuthorization: "preserve" | "strip" | "strip-after-authentication"
    Explicit policy for retaining or stripping inbound Authorization, including after authentication.
  readonly responseCookies: "preserve" | "strip"
    Explicit policy for retaining or stripping upstream Set-Cookie headers.
```

### gateway-types: GatewayDefinition

[Declaration source](gateway/types.ts#L176)

```text
interface GatewayDefinition<Id extends string = string> extends CatalogEntryIdentity
  Import-safe gateway definition.

  readonly kind: "gateway"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly id: Id
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly services: readonly GatewayMount[]
    Mounted service declarations or their projected identities.
  readonly policies: readonly GatewayPolicy[]
    Additive policies that apply to exact declarations in this composition.
  readonly observers: readonly GatewayObserverDefinition[]
    Observer declarations or exact host-supplied handlers; observers remain outside result authority.
```

### gateway-types: GatewayDefinitionInput

[Declaration source](gateway/types.ts#L190)

```text
interface GatewayDefinitionInput<Id extends string = string>
  Input accepted by `gateway.define()`.

  readonly id: Id
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
  readonly services: readonly (GatewayMount | readonly GatewayMount[])[]
    Mounted service declarations or their projected identities.
  readonly policies?: readonly GatewayPolicy[]
    Additive policies that apply to exact declarations in this composition.
  readonly observers?: readonly GatewayObserverDefinition[]
    Observer declarations or exact host-supplied handlers; observers remain outside result authority.
```

### gateway-types: GatewayManifest

[Declaration source](gateway/types.ts#L303)

```text
interface GatewayManifest
  Deterministic compiled gateway manifest.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly routes: readonly GatewayRouteManifestEntry[]
    Authored or compiled route entries retained by this application or manifest.
  readonly services: readonly string[]
    Mounted service declarations or their projected identities.
```

### gateway-types: GatewayMetadataHeaders

[Declaration source](gateway/types.ts#L391)

```text
interface GatewayMetadataHeaders
  Optional host-selected header names for trusted gateway routing metadata.

  readonly requestId?: string
    Correlation ID reconstructed by the gateway.
  readonly serviceId?: string
    Mounted service ID selected by the compiled route.
  readonly routeId?: string
    Compiled gateway route ID selected for the request.
```

### gateway-types: GatewayMount

[Declaration source](gateway/types.ts#L18)

```text
interface GatewayMount<Target extends ServiceDefinition | ServiceSelection = ServiceDefinition | ServiceSelection>
  One exact service or service selection mounted at an origin.

  readonly kind: "gateway-mount"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly target: Target
    Exact imported service definition or selection mounted at this origin.
  readonly origin: GatewayOrigin
    Host-resolved upstream service origin for this mount or route.
```

### gateway-types: GatewayObserverDefinition

[Declaration source](gateway/types.ts#L67)

```text
interface GatewayObserverDefinition extends CatalogEntryIdentity
  Import-safe subscription to redacted gateway lifecycle events.

  An observer is optional and observational: it cannot choose a route, mutate
  credentials, or replace the response. Importing a definition makes its
  telemetry/audit requirement visible to compilation; the host supplies the
  matching handler separately.

  readonly kind: "gateway-observer"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly events: readonly GatewayObserverEventKind[]
    Gateway lifecycle event kinds selected for observation; response means headers, and completed means body EOF.
```

### gateway-types: GatewayObserverEvent

[Declaration source](gateway/types.ts#L84)

```text
interface GatewayObserverEvent
  Redacted gateway lifecycle event.

  `response` means upstream headers arrived. `completed`, `aborted`, and
  `failed` describe the later response-body lifetime. Keeping those events
  distinct is necessary for streamed downloads and proxy responses whose body
  may continue long after the status code is known.

  readonly kind: GatewayObserverEventKind
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly gatewayId: string
    Gateway identity retained for route and lifecycle correlation.
  readonly requestId: string
    Request correlation identity; it is diagnostic data rather than authorization.
  readonly traceId: string
    Trace correlation identity retained for diagnostic propagation.
  readonly spanId: string
    Span correlation identity for the current operation.
  readonly method: string
    HTTP method selected for this operation or route.
  readonly pathname: string
    Request pathname retained for redacted lifecycle observation.
  readonly routeId?: string
    Identity of the selected compiled route, when routing has completed.
  readonly serviceId?: string
    Identity of the service selected for this route or observation.
  readonly endpointId?: string
    Identity of the selected endpoint path contract.
  readonly operationId?: string
    Stable operation identity used by generated clients, routing and diagnostics.
  readonly status?: number
    HTTP status selected by this response or reported by this lifecycle observation.
  readonly requestBytes?: number
    Observed request-body bytes at this transport boundary.
  readonly responseBytes?: number
    Observed response-body bytes; response headers alone do not prove body completion.
  readonly completion?: Readonly<{ readonly outcome: "completed" | "cancelled" | "errored"; readonly bytes: number; }>
    Response-body terminal outcome and delivered byte count, distinct from receiving headers.
  readonly error?: Readonly<{ readonly name: string; readonly message: string; }>
    Diagnostic failure retained for this observation; it does not replace the authoritative operation result.
```

### gateway-types: GatewayObserverHandler

[Declaration source](gateway/types.ts#L120)

```text
interface GatewayObserverHandler<Definition extends GatewayObserverDefinition = GatewayObserverDefinition>
  Runtime handler bound to an exact observer definition.

  readonly kind: "gateway-observer-handler"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly definition: Definition
    Exact declaration involved in this binding, result or validation issue.
  readonly handle: (event: GatewayObserverEvent) => void | Promise<void>
    Observe a redacted gateway lifecycle event; this callback cannot settle the request.
```

### gateway-types: GatewayPolicy

[Declaration source](gateway/types.ts#L130)

```text
interface GatewayPolicy extends CatalogEntryIdentity
  Additive edge behavior for exact imported endpoints.

  readonly kind: "gateway-policy"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly endpoints: readonly EndpointDefinition[]
    Exact endpoint composition or selected bindings retained by this contract.
  readonly authenticate?: DefinitionInput<CatalogEntryIdentity>
    Host-owned evaluation of the declared authentication contracts before forwarding or operation admission.
  readonly assertion?: DefinitionInput<CatalogEntryIdentity>
    Additional host-owned assertions required for the selected endpoint.
  readonly timeout?: Temporal.Duration
    Request timeout retained as a duration, or serialized duration text in a manifest.
  readonly bodyLimit?: number
    Maximum request-body bytes admitted by this runtime policy.
  readonly cache?: GatewayCachePolicy
    Explicit gateway cache behavior; this contract does not create an application cache.
  readonly credentials?: GatewayCredentialPolicy
    Explicit policy for caller credential and upstream cookie forwarding.
  readonly redirects?: GatewayRedirectPolicy
    Explicit policy for preserving, rewriting or rejecting upstream Location fields.
```

### gateway-types: GatewayPolicyInput

[Declaration source](gateway/types.ts#L152)

```text
interface GatewayPolicyInput
  Input accepted by `gateway.policy()`.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly description?: string
    Purpose and behavior of this contract, supplied by its author.
  readonly endpoints: EndpointCompositionInput
    Exact endpoint composition or selected bindings retained by this contract.
  readonly authenticate?: DefinitionInput<CatalogEntryIdentity>
    Host-owned evaluation of the declared authentication contracts before forwarding or operation admission.
  readonly assertion?: DefinitionInput<CatalogEntryIdentity>
    Additional host-owned assertions required for the selected endpoint.
  readonly timeout?: Temporal.Duration | Temporal.DurationLike | string
    Request timeout retained as a duration, or serialized duration text in a manifest.
  readonly bodyLimit?: number
    Maximum request-body bytes admitted by this runtime policy.
  readonly cache?: GatewayCachePolicy
    Explicit gateway cache behavior; this contract does not create an application cache.
  readonly credentials?: GatewayCredentialPolicy
    Explicit policy for caller credential and upstream cookie forwarding.
  readonly redirects?: GatewayRedirectPolicy
    Explicit policy for preserving, rewriting or rejecting upstream Location fields.
```

### gateway-types: GatewayRedirectPolicy

[Declaration source](gateway/types.ts#L47)

```text
interface GatewayRedirectPolicy
  Upstream Location handling policy for manual redirects.

  readonly kind: "gateway-redirects"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly mode: "preserve" | "rewrite-origin" | "reject-cross-origin"
    Selected materialization or forwarding behavior for this definition.
  readonly allowedOrigins: readonly string[]
    Additional upstream redirect origins admitted by the selected redirect policy.
```

### gateway-types: GatewayRequestPatch

[Declaration source](gateway/types.ts#L371)

```text
interface GatewayRequestPatch
  Patch produced by one gateway edge adapter.

  readonly headers?: Readonly<Record<string, string>>
    Explicit transport headers retained for this boundary; credential forwarding uses its separate policy.
```

### gateway-types: GatewayRequestState

[Declaration source](gateway/types.ts#L357)

```text
interface GatewayRequestState
  Request state visible to gateway authentication and assertion adapters.

  readonly request: Request
    Web Request borrowed for this operation; body ownership follows the enclosing transport contract.
  readonly route: CompiledGatewayRoute
    Compiled gateway route selected before host adapters evaluate the request.
  readonly requestId: string
    Request correlation identity; it is diagnostic data rather than authorization.
  readonly correlation: RequestCorrelation
    Owned request correlation projected for the downstream hop.
  readonly signal: AbortSignal
    Cancellation signal for the transport request lifetime.
```

### gateway-types: GatewayRouteManifestEntry

[Declaration source](gateway/types.ts#L261)

```text
interface GatewayRouteManifestEntry
  JSON-safe gateway route manifest.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly serviceId: string
    Identity of the service selected for this route or observation.
  readonly serviceRouteId: string
    Route identity defined by the mounted service before gateway compilation.
  readonly endpointId: string
    Identity of the selected endpoint path contract.
  readonly operationId: string
    Stable operation identity used by generated clients, routing and diagnostics.
  readonly method: Uppercase<EndpointMethod>
    HTTP method selected for this operation or route.
  readonly path: string
    Declared route pathname or prefix; path parameters retain the endpoint grammar.
  readonly origin: string
    Host-resolved upstream service origin for this mount or route.
  readonly authentication: readonly string[]
    Authentication contracts required by the selected operation; the host supplies their evaluator.
  readonly assertions: readonly string[]
    Compiled assertion contracts or their manifest IDs, evaluated by an explicit host adapter.
  readonly timeout?: string
    Request timeout retained as a duration, or serialized duration text in a manifest.
  readonly bodyLimit?: number
    Maximum request-body bytes admitted by this runtime policy.
  readonly cache: GatewayCachePolicy["mode"]
    Explicit gateway cache behavior; this contract does not create an application cache.
  readonly credentials: Readonly<{ readonly requestCookies: GatewayCredentialPolicy["requestCookies"]; readonly requestAuthorization: GatewayCredentialPolicy["requestAuthorization"]; readonly responseCookies: GatewayCredentialPolicy["responseCookies"]; }>
    Explicit policy for caller credential and upstream cookie forwarding.
  readonly redirects: GatewayRedirectPolicy["mode"]
    Explicit policy for preserving, rewriting or rejecting upstream Location fields.
  readonly observers: readonly string[]
    Observer declarations or exact host-supplied handlers; observers remain outside result authority.
```

### gateway-types: GatewayRuntime

[Declaration source](gateway/types.ts#L453)

```text
interface GatewayRuntime
  Live gateway request handler owned by a transport host.

  Mounting service definitions compiles route metadata only. The gateway does
  not start service runtimes, open sockets, or own an HTTP listener. A host
  such as `deno serve`, a framework adapter, or an edge runtime owns transport
  startup and shutdown around this Fetch-compatible handler.

  readonly fetch: (request: Request) => Promise<Response>
    Fetch-compatible request entry; its host owns listeners and transport shutdown.
```

### gateway-types: GatewayRuntimeAdapters

[Declaration source](gateway/types.ts#L377)

```text
interface GatewayRuntimeAdapters
  Host-specific gateway runtime adapters.

  readonly authenticate?: (requirements: readonly CatalogEntryIdentity[], state: GatewayRequestState) => GatewayRequestPatch | ProblemResult | void | Promise<GatewayRequestPatch | ProblemResult | void>
    Host-owned evaluation of the declared authentication contracts before forwarding or operation admission.
  readonly assert?: (assertions: readonly CatalogEntryIdentity[], state: GatewayRequestState) => GatewayRequestPatch | ProblemResult | void | Promise<GatewayRequestPatch | ProblemResult | void>
    Evaluate host-owned assertions and return an allowed request patch or a declared problem.
```

### gateway-types: GatewaySelection

[Declaration source](gateway/types.ts#L204)

```text
interface GatewaySelection<Gateway extends GatewayDefinition = GatewayDefinition> extends CatalogEntryIdentity
  Named gateway subset that preserves exact mount references.

  readonly kind: "gateway-selection"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly gateway: Gateway
    Exact gateway declaration retained by this route or selection.
  readonly mounts: readonly GatewayMount[]
    Exact service mounts retained by this gateway selection.
```

### gateway-types: GatewayValidationIssue

[Declaration source](gateway/types.ts#L336)

```text
interface GatewayValidationIssue
  One validation issue emitted by the gateway compiler.

  readonly code: "invalid-definition" | "duplicate-mount" | "policy-target-outside-gateway" | "route-conflict" | "invalid-origin" | "conflicting-policy"
    Stable failure code; callers should branch on this instead of matching explanation text.
  readonly message: string
    Human-readable diagnostic explanation; it is not a stable program discriminator.
  readonly definition?: GatewayValidationSubject
    Declaration or supplied service artifact associated with this compiler issue.
```

### gateway-types: PrepareGatewayRequestOptions

[Declaration source](gateway/types.ts#L401)

```text
interface PrepareGatewayRequestOptions
  Request-preparation options shared by compiled routes and host-owned continuation routes.

  readonly requestId?: (request: Request) => string
    Host-supplied request identity provider; caller headers are not automatically trusted.
  readonly clientIp?: (request: Request) => string | undefined
    Host-trusted connected client address used to reconstruct forwarding metadata.
  readonly metadataHeaders?: Pick<GatewayMetadataHeaders, "requestId">
    Optional product/host correlation header. Service and route IDs are unavailable before route selection.
  readonly trustedRequestHeaders?: readonly string[]
    Exact caller headers reserved for trusted gateway-owned values.
  readonly trustedRequestHeaderPrefixes?: readonly string[]
    Caller header prefixes reserved for trusted gateway-owned values.
```

### gateway-types: PreparedGatewayRequest

[Declaration source](gateway/types.ts#L415)

```text
interface PreparedGatewayRequest
  One request prepared for a trusted downstream hop by generic gateway transport policy.

  readonly request: Request
    Web Request borrowed for this operation; body ownership follows the enclosing transport contract.
  readonly requestId: string
    Request correlation identity; it is diagnostic data rather than authorization.
  readonly correlation: RequestCorrelation
    Owned request correlation projected for the downstream hop.
```

### gateway-types: GatewayCachePolicy

[Declaration source](gateway/types.ts#L30)

```text
type GatewayCachePolicy = Readonly<{ readonly kind: "gateway-cache"; readonly mode: "no-store"; }> | Readonly<{ readonly kind: "gateway-cache"; readonly mode: "pass-through"; }>
  Gateway cache behavior.
```

### gateway-types: GatewayObserverEventKind

[Declaration source](gateway/types.ts#L57)

```text
type GatewayObserverEventKind = "denied" | "forwarding" | "response" | "completed" | "failed" | "aborted"
  Gateway lifecycle events available to redacted observers.
```

### gateway-types: GatewayOrigin

[Declaration source](gateway/types.ts#L15)

```text
type GatewayOrigin = string | URL
  Host-resolved origin for one independently deployed service.
```

### gateway-types: GatewayServiceArtifact

[Declaration source](gateway/types.ts#L214)

```text
type GatewayServiceArtifact = CompiledService | ServiceManifest
  One concrete service artifact supplied to gateway compilation.
```

### gateway-types: GatewayValidationResult

[Declaration source](gateway/types.ts#L352)

```text
type GatewayValidationResult = Readonly<{ readonly valid: true; }> | Readonly<{ readonly valid: false; readonly issues: readonly GatewayValidationIssue[]; }>
  Deterministic gateway validation result.
```

### gateway-types: GatewayValidationSubject

[Declaration source](gateway/types.ts#L327)

```text
type GatewayValidationSubject = CatalogEntryIdentity | GatewayMount | GatewayServiceArtifact | ServiceRoute | ServiceRouteManifestEntry | CompiledGatewayRoute
  Definition value that may be attached to one gateway compiler issue.
```

## http

Import `@okikio/server/http`. [Source](./http/mod.ts).

Mount a portable Fetch app while keeping listener ownership with the host.

Add mounts, request correlation, CORS or safe exception responses deliberately. HEAD fallback selects GET behavior while
the runtime suppresses its response body. A Deno or framework adapter owns the network listener.

### http: access

[Declaration source](http/access.ts#L3)

```text
function access(observe: (event: AccessEventType) => void | Promise<void>): Middleware
  Observe request start, response creation, and failure without selecting a logging implementation.
```

### http: catchErrors

[Declaration source](http/errors.ts#L55)

```text
function catchErrors(options: ErrorOptions): Middleware
  Catch every synchronous or awaited downstream error before response commitment.
```

### http: compareRouteSpecificity

[Declaration source](http/path.ts#L45)

```text
function compareRouteSpecificity(left: string, right: string): number
  Compare route templates by deterministic matching specificity.

  A positive result means `left` is more specific. Earlier static segments beat
  parameter segments. Longer paths win only after every shared segment ties.
```

### http: compose

[Declaration source](http/app.ts#L41)

```text
function compose(handler: Handler, middleware: readonly Middleware[]): Handler
  Compose Fetch-compatible middleware around one terminal handler in authored order.
  Each invocation owns its downstream call. Calling that middleware's `next`
  twice rejects before a second route or side effect runs; requests reuse the
  prepared chain with independent guards.
```

### http: correlation

[Declaration source](http/correlation.ts#L12)

```text
function correlation(options: CorrelationOptions): Middleware
  Establish one memoized W3C/request correlation value without selecting a tracing or logging provider.
```

### http: cors

[Declaration source](http/cors.ts#L22)

```text
function cors(options: CorsOptionsType): Middleware
  Apply CORS response policy and complete valid preflight requests before application routing.
```

### http: create

[Declaration source](http/app.ts#L67)

```text
function create(options: CreateOptionsType): App
  Create a framework-neutral HTTP application from a prepared route plan and exact handlers.
```

### http: errorResponse

[Declaration source](http/errors.ts#L21)

```text
async function errorResponse(thrown: unknown, request: Request, options: ErrorOptions): Promise<Response>
  Convert one thrown value into the configured safe HTTP response.
```

### http: headers

[Declaration source](http/headers.ts#L60)

```text
function headers(values: responseCore.HeaderInput, remove: readonly string[]): Middleware
  Add or replace static response headers after downstream work completes.
```

### http: health

[Declaration source](http/health.ts#L14)

```text
function health(options: HealthOptions): Handler
  Create a process-liveness handler with no dependency checks.
```

### http: matchPath

[Declaration source](http/path.ts#L30)

```text
function matchPath(template: string, pathname: string): boolean
  Match one concrete request path against a `:parameter` route template without normalizing request shape.
```

### http: mount

[Declaration source](http/app.ts#L24)

```text
function mount(path: string, handler: Handler, options: MountOptions): RouteType
  Mount one Fetch handler below a path prefix.

  `preserve` leaves the original URL untouched. `strip-prefix` presents the
  child with a URL relative to the mount, which is useful for embedded Fetch
  applications and transports such as MCP while preserving method, headers,
  query, body stream, and abort signal.
```

### http: normalizePath

[Declaration source](http/path.ts#L4)

```text
function normalizePath(path: string): string
  Canonicalize one HTTP route path without applying filesystem semantics.
```

### http: prettyJson

[Declaration source](http/json.ts#L17)

```text
function prettyJson(options: PrettyJsonOptionsType): Middleware
  Pretty-print JSON responses only when explicitly requested or forced.
```

### http: problemResponse

[Declaration source](http/response.ts#L4)

```text
function problemResponse(result: problem.ProblemResult): Response
  Materialize one logical RFC 9457 problem tuple as a native Response.
```

### http: ready

[Declaration source](http/health.ts#L44)

```text
function ready(probe: (request: Request) => boolean | ReadinessType | Promise<boolean | ReadinessType>, options: Readonly<{ readonly service?: string; }>): Handler
  Create a readiness handler from one bounded caller-owned readiness probe.
```

### http: requestId

[Declaration source](http/request.ts#L17)

```text
function requestId(options: RequestIdOptions): Middleware
  Normalize one request ID, pass it downstream, and return it to the caller.
```

### http: route

[Declaration source](http/app.ts#L7)

```text
function route(method: string, path: string, handler: Handler): RouteType
  Create one exact method/path route using native Request and Response values.
```

### http: securityHeaders

[Declaration source](http/headers.ts#L34)

```text
function securityHeaders(options: SecurityHeadersOptionsType): Middleware
  Add a conservative static security-header set without depending on a web framework.
```

### http: timing

[Declaration source](http/timing.ts#L15)

```text
function timing(options: TimingOptions): Middleware
  Record total request-handler duration in the standard Server-Timing response header.
```

### http: trailingSlash

[Declaration source](http/path.ts#L80)

```text
function trailingSlash(mode: "trim" | "append", options: TrailingSlashOptions): Middleware
  Redirect GET requests to one canonical trailing-slash form.
```

### http: withHeaders

[Declaration source](http/response.ts#L12)

```text
function withHeaders(value: Response, set: response.HeaderInput, remove: readonly string[]): Response
  Copy a response while replacing selected header fields without consuming its body.
```

### http: CorrelationOptions

[Declaration source](http/correlation.ts#L6)

```text
interface CorrelationOptions extends requestWire.RequestCorrelationOptions
  Options used to establish and observe one request correlation value.

  readonly observe?: (value: requestWire.RequestCorrelation, request: Request) => void | Promise<void>
    Observe established request correlation without choosing admission or response behavior.
```

### http: CorsOptionsType

[Declaration source](http/cors.ts#L6)

```text
interface CorsOptionsType
  Framework-neutral CORS policy.

  readonly origin?: string | readonly string[] | ((origin: string, request: Request) => string | undefined)
    Explicit allowed origin, origin set or resolver; wildcard credentials are rejected.
  readonly allowMethods?: readonly string[]
    HTTP methods advertised for an admitted CORS preflight.
  readonly allowHeaders?: readonly string[]
    Request header names advertised for an admitted CORS preflight.
  readonly exposeHeaders?: readonly string[]
    Response header names exposed by the CORS policy.
  readonly credentials?: boolean
    Whether admitted CORS responses allow credentials; wildcard origin cannot be combined with this.
  readonly maxAge?: number
    CORS preflight cache duration in seconds.
```

### http: ErrorOptions

[Declaration source](http/errors.ts#L11)

```text
interface ErrorOptions
  Options used by the framework-neutral all-errors middleware.

  readonly map?: (error: Error, request: Request) => ErrorResultType | Promise<ErrorResultType>
    Map an unexpected error to an explicit Response; absent mapping falls back to the configured problem.
  readonly onError?: (error: Error, request: Request, response: Response) => void | Promise<void>
    Observe an unexpected downstream error before it is mapped to a response.
  readonly problem?: problem.ProblemDefinition
    Declared fallback HTTP problem used when the error mapper supplies no response.
```

### http: HealthOptions

[Declaration source](http/health.ts#L4)

```text
interface HealthOptions
  Options used by the liveness handler.

  readonly service?: string
    Optional application service name included in the liveness result.
  readonly startedAt?: number
    Service start time as epoch milliseconds, used for uptime reporting.
  readonly now?: () => Date
    Clock returning a valid Date for liveness timestamp and uptime reporting.
```

### http: PrettyJsonOptionsType

[Declaration source](http/json.ts#L7)

```text
interface PrettyJsonOptionsType
  Options used by development-oriented JSON pretty printing.

  readonly space?: number
    JSON indentation spaces, from zero through ten; defaults to two.
  readonly query?: string
    Query parameter whose presence requests pretty JSON; defaults to pretty.
  readonly force?: boolean
    Pretty-print supported JSON responses without requiring the configured query flag.
```

### http: RequestIdOptions

[Declaration source](http/request.ts#L7)

```text
interface RequestIdOptions
  Options used by request-ID propagation middleware.

  readonly header?: string
    Header used for downstream and response request-ID propagation; defaults to X-Request-ID.
  readonly trustIncoming?: boolean
    Reuse a valid inbound request ID. Defaults to false.
  readonly generate?: (request: Request) => string
    Supply a request identity when ingress did not provide a trusted valid one.
```

### http: SecurityHeadersOptionsType

[Declaration source](http/headers.ts#L6)

```text
interface SecurityHeadersOptionsType
  Static security-header overrides. `false` removes one default header.

  readonly crossOriginOpenerPolicy?: string | false
    Override Cross-Origin-Opener-Policy; false removes that default header.
  readonly crossOriginResourcePolicy?: string | false
    Override Cross-Origin-Resource-Policy; false removes that default header.
  readonly originAgentCluster?: string | false
    Override Origin-Agent-Cluster; false removes that default header.
  readonly referrerPolicy?: string | false
    Override Referrer-Policy; false removes that default header.
  readonly strictTransportSecurity?: string | false
    Override Strict-Transport-Security; false removes that default header.
  readonly xContentTypeOptions?: string | false
    Override X-Content-Type-Options; false removes that default header.
  readonly xDnsPrefetchControl?: string | false
    Override X-DNS-Prefetch-Control; false removes that default header.
  readonly xDownloadOptions?: string | false
    Override X-Download-Options; false removes that default header.
  readonly xFrameOptions?: string | false
    Override X-Frame-Options; false removes that default header.
  readonly xPermittedCrossDomainPolicies?: string | false
    Override X-Permitted-Cross-Domain-Policies; false removes that default header.
  readonly xXssProtection?: string | false
    Override X-XSS-Protection; false removes that default header.
  readonly additional?: Readonly<Record<string, string>>
    Additional static response headers selected by the application.
```

### http: TimingOptions

[Declaration source](http/timing.ts#L5)

```text
interface TimingOptions
  Options used by framework-neutral Server-Timing middleware.

  readonly name?: string
    Server-Timing metric name.
  readonly description?: string
    Optional Server-Timing metric description.
  readonly enabled?: (request: Request) => boolean
    Whether Server-Timing is emitted, or a predicate that selects requests for emission.
```

### http: TrailingSlashOptions

[Declaration source](http/path.ts#L70)

```text
interface TrailingSlashOptions
  Options used by trailing-slash normalization middleware.

  readonly alwaysRedirect?: boolean
    Redirect a noncanonical GET pathname immediately; otherwise redirect only after the original route returns 404.
  readonly status?: 301 | 302 | 307 | 308
    Redirect status; defaults to 301.
  readonly skip?: (pathname: string) => boolean
    Skip trailing-slash normalization for a pathname selected by this predicate.
```

### http: ErrorResultType

[Declaration source](http/errors.ts#L8)

```text
type ErrorResultType = Response | problem.ProblemResult | undefined
  Result a host error mapper may return before the safe fallback problem is used.
```

### http: AccessEventType

[Declaration source](http/mod.ts#L28)

```text
reference AccessEventType: ./packages/server/http/types.ts:104:1
```

### http: App

[Declaration source](http/mod.ts#L29)

```text
reference App: ./packages/server/http/types.ts:60:1
```

### http: CreateOptionsType

[Declaration source](http/mod.ts#L30)

```text
reference CreateOptionsType: ./packages/server/http/types.ts:48:1
```

### http: Handler

[Declaration source](http/mod.ts#L31)

```text
reference Handler: ./packages/server/http/types.ts:1:1
```

### http: Middleware

[Declaration source](http/mod.ts#L32)

```text
reference Middleware: ./packages/server/http/types.ts:7:1
```

### http: MountOptions

[Declaration source](http/mod.ts#L48)

```text
reference MountOptions: ./packages/server/http/types.ts:18:1
```

### http: Next

[Declaration source](http/mod.ts#L33)

```text
reference Next: ./packages/server/http/types.ts:4:1
```

### http: ReadinessType

[Declaration source](http/mod.ts#L34)

```text
reference ReadinessType: ./packages/server/http/types.ts:68:1
```

### http: RoutePlan

[Declaration source](http/mod.ts#L48)

```text
reference RoutePlan: ./packages/server/http/types.ts:40:1
```

### http: RoutePlanInput

[Declaration source](http/mod.ts#L48)

```text
reference RoutePlanInput: ./packages/server/http/types.ts:35:1
```

### http: RouteType

[Declaration source](http/mod.ts#L35)

```text
reference RouteType: ./packages/server/http/types.ts:32:1
```

### http: matchMount

[Declaration source](http/mod.ts#L47)

```text
reference matchMount: ./packages/server/http/router.ts:72:1
```

### http: matchRoute

[Declaration source](http/mod.ts#L47)

```text
reference matchRoute: ./packages/server/http/router.ts:65:1
```

### http: prepareRoutes

[Declaration source](http/mod.ts#L47)

```text
reference prepareRoutes: ./packages/server/http/router.ts:38:1
```

### http: routeKey

[Declaration source](http/mod.ts#L47)

```text
reference routeKey: ./packages/server/http/router.ts:80:1
```

## http-router

Import `@okikio/server/http/router`. [Source](./http/router.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding          | Contract owner or source |
| ------------------------- | ------------------------ |
| `compareRouteSpecificity` | [Source](http/path.ts)   |
| `normalizePath`           | [Source](http/path.ts)   |
| `RoutePlan`               | [Source](http/types.ts)  |
| `RoutePlanInput`          | [Source](http/types.ts)  |

### http-router: matchMount

[Declaration source](http/router.ts#L72)

```text
function matchMount(plan: RoutePlan, pathname: string): string | undefined
  Match one concrete request path against the longest prepared mount prefix.
```

### http-router: matchRoute

[Declaration source](http/router.ts#L65)

```text
function matchRoute(plan: RoutePlan, method: string, pathname: string): string | undefined
  Match one request method/path against a prepared route plan.
```

### http-router: normalizeMountPath

[Declaration source](http/router.ts#L87)

```text
function normalizeMountPath(path: string): string
  Canonicalize a mount prefix so `/api` and `/api/` cannot claim the same subtree.
```

### http-router: prepare

[Declaration source](http/router.ts#L38)

```text
function prepare(input: readonly RoutePlanInput[]): RoutePlan
  Prepare route ownership before traffic starts.

  The returned value contains only inert data. It can therefore be retained by a
  service compiler, serialized into a build artifact, or shared by a gateway
  without retaining handler functions. Static routes are separated from dynamic
  templates and dynamic candidates are preordered by specificity.
```

### http-router: routeKey

[Declaration source](http/router.ts#L80)

```text
function routeKey(route: RoutePlanInput): string
  Build the stable identity used to bind inert route-plan entries to handlers.
```

### http-router: stripMountPrefix

[Declaration source](http/router.ts#L93)

```text
function stripMountPrefix(url: URL, prefix: string): URL
  Rewrite one URL relative to a matched mount while preserving query and origin.
```

## http-types

Import `@okikio/server/http/types`. [Source](./http/types.ts).

[Declaration source](http/types.ts#L78)

```text
private interface AccessBaseType
  Request metadata common to access observation events. @internal

  readonly request: Request
  readonly method: string
  readonly pathname: string
```

[Declaration source](http/types.ts#L97)

```text
private interface AccessFailureType extends AccessBaseType
  Request failure observed before a Response was created. @internal

  readonly kind: "failed"
  readonly durationMs: number
  readonly error: Error
```

[Declaration source](http/types.ts#L90)

```text
private interface AccessResponseType extends AccessBaseType
  Response-created observation. This does not mean a streamed body finished delivery. @internal

  readonly kind: "response"
  readonly durationMs: number
  readonly status: number
```

[Declaration source](http/types.ts#L85)

```text
private interface AccessStartType extends AccessBaseType
  Request-start observation. @internal

  readonly kind: "start"
```

### http-types: App

[Declaration source](http/types.ts#L60)

```text
interface App
  Fetch-compatible HTTP application assembled from explicit routes and middleware.

  readonly routes: readonly RouteType[]
    Authored or compiled route entries retained by this application or manifest.
  readonly fetch: Handler
    Fetch-compatible request entry; its host owns listeners and transport shutdown.
```

### http-types: CreateOptionsType

[Declaration source](http/types.ts#L48)

```text
interface CreateOptionsType
  Options used to create one framework-neutral HTTP application.

  readonly routes?: readonly RouteType[]
    Authored or compiled route entries retained by this application or manifest.
  readonly middleware?: readonly Middleware[]
    Declared middleware contributions or their compiled placement plan.
  readonly notFound?: Handler
    Fetch-compatible handler used when no route matches the request.
  readonly plan?: RoutePlan
    Optional compiler-produced plan. Every authored route must bind to it exactly.
```

[Declaration source](http/types.ts#L10)

```text
private interface ExactRouteType
  Exact method/path route owned by one framework-neutral HTTP application. @internal

  readonly kind: "route"
  readonly method: string
  readonly path: string
  readonly handler: Handler
```

### http-types: MountOptions

[Declaration source](http/types.ts#L18)

```text
interface MountOptions
  Controls which pathname a mounted child Fetch handler receives.

  readonly requestPath?: "preserve" | "strip-prefix"
    Whether a prefix mount preserves the request pathname or strips its matched prefix.
```

[Declaration source](http/types.ts#L24)

```text
private interface MountRouteType
  Prefix-mounted Fetch handler owned by one framework-neutral HTTP application. @internal

  readonly kind: "mount"
  readonly path: string
  readonly handler: Handler
  readonly requestPath: "preserve" | "strip-prefix"
```

### http-types: ReadinessType

[Declaration source](http/types.ts#L68)

```text
interface ReadinessType
  Outcome returned by a readiness probe.

  readonly ready: boolean
    Whether the probe reports that this application can accept useful work.
  readonly detail?: string
    Human-readable explanation of this occurrence or readiness result.
  readonly checks?: Readonly<Record<string, boolean>>
    Named readiness outcomes returned by the explicit probe.
```

### http-types: RoutePlan

[Declaration source](http/types.ts#L40)

```text
interface RoutePlan
  Immutable handler-free route plan prepared before request dispatch.

  readonly kind: "http-route-plan"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly routes: readonly RoutePlanInput[]
    Authored or compiled route entries retained by this application or manifest.
```

### http-types: AccessEventType

[Declaration source](http/types.ts#L104)

```text
type AccessEventType = AccessStartType | AccessResponseType | AccessFailureType
  Structured event emitted by access observation middleware.
```

### http-types: Handler

[Declaration source](http/types.ts#L1)

```text
type Handler = (request: Request) => Response | Promise<Response>
  Fetch-compatible HTTP handler used by framework-neutral server composition.
```

### http-types: Middleware

[Declaration source](http/types.ts#L7)

```text
type Middleware = (request: Request, next: Next) => Response | Promise<Response>
  Fetch-compatible middleware that can inspect or replace the request and response.
```

### http-types: Next

[Declaration source](http/types.ts#L4)

```text
type Next = Handler
  Onion-style continuation used by framework-neutral HTTP middleware.
```

### http-types: RoutePlanInput

[Declaration source](http/types.ts#L35)

```text
type RoutePlanInput = Readonly<{ readonly kind: "route"; readonly method: string; readonly path: string; }> | Readonly<{ readonly kind: "mount"; readonly path: string; }>
  Handler-free route description retained by a compiler or deployment artifact.
```

### http-types: RouteType

[Declaration source](http/types.ts#L32)

```text
type RouteType = ExactRouteType | MountRouteType
  Route or mounted handler owned by one framework-neutral HTTP application.
```

## middleware

Import `@okikio/server/middleware`. [Source](./middleware/mod.ts).

Declare middleware ordering and context needs so startup can reject a missing producer.

Bind runtime behavior with handler(), place it in a declared request lane, and use once() when one exact binding should
run once per Request. These declarations validate availability and ordering; they do not authenticate an actor.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                   | Contract owner or source                       |
| ---------------------------------- | ---------------------------------------------- |
| `catalogProtocol`                  | [catalog contracts](../catalog/API.md)         |
| `effect`                           | [effect contracts](../effect/API.md)           |
| `recordCore`                       | [record contracts](../record/API.md)           |
| `resilience`                       | [resilience contracts](../resilience/API.md)   |
| `requirement`                      | [requirement contracts](../requirement/API.md) |
| `Catalog`                          | [catalog contracts](../catalog/API.md)         |
| `CatalogEntryIdentity`             | [catalog contracts](../catalog/API.md)         |
| `CatalogSelection`                 | [catalog contracts](../catalog/API.md)         |
| `DefinitionInput`                  | [catalog contracts](../catalog/API.md)         |
| `MiddlewareContextDefinition`      | [Source](middleware/types.ts)                  |
| `MiddlewareContextDefinitionInput` | [Source](middleware/types.ts)                  |
| `MiddlewareDefinition`             | [Source](middleware/types.ts)                  |
| `MiddlewareDefinitionInput`        | [Source](middleware/types.ts)                  |
| `MiddlewareDocument`               | [Source](middleware/types.ts)                  |
| `MiddlewareHandler`                | [Source](middleware/types.ts)                  |
| `MiddlewareInput`                  | [Source](middleware/types.ts)                  |
| `MiddlewareLane`                   | [Source](middleware/types.ts)                  |
| `MiddlewareOnceKey`                | [Source](middleware/types.ts)                  |
| `MiddlewarePlan`                   | [Source](middleware/types.ts)                  |
| `MiddlewareProblems`               | [Source](middleware/types.ts)                  |
| `MiddlewareProvides`               | [Source](middleware/types.ts)                  |
| `MiddlewareRequires`               | [Source](middleware/types.ts)                  |
| `MiddlewareResources`              | [Source](middleware/types.ts)                  |
| `MiddlewareUse`                    | [Source](middleware/types.ts)                  |
| `MiddlewareValidationIssue`        | [Source](middleware/types.ts)                  |
| `MiddlewareValidationResult`       | [Source](middleware/types.ts)                  |

### middleware: afterValidation

[Declaration source](middleware/mod.ts#L235)

```text
function afterValidation<Definition extends MiddlewareDefinition>(definition: Definition): MiddlewareUse<Definition, "afterValidation">
  Place middleware in the normal post-validation lane.
```

### middleware: aroundOperation

[Declaration source](middleware/mod.ts#L239)

```text
function aroundOperation<Definition extends MiddlewareDefinition>(definition: Definition): MiddlewareUse<Definition, "aroundOperation">
  Place middleware immediately around endpoint handler invocation.
```

### middleware: beforeValidation

[Declaration source](middleware/mod.ts#L231)

```text
function beforeValidation<Definition extends MiddlewareDefinition>(definition: Definition): MiddlewareUse<Definition, "beforeValidation">
  Place middleware immediately before request validation.
```

### middleware: catalog

[Declaration source](middleware/mod.ts#L201)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, MiddlewareDefinition>>>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries>
  Create a named middleware catalog.
```

### middleware: compose

[Declaration source](middleware/mod.ts#L220)

```text
function compose<Entry extends MiddlewareDefinition>(...input: readonly DefinitionInput<Entry>[]): readonly Entry[]
  Compose middleware definitions, catalogs, selections, and nested arrays.
```

### middleware: context

[Declaration source](middleware/mod.ts#L55)

```text
function context<Value>(): (input: MiddlewareContextDefinitionInput) => MiddlewareContextDefinition<Value>
  Define a typed request-context value.
```

[Declaration source](middleware/mod.ts#L59)

```text
function context(input: MiddlewareContextDefinitionInput): MiddlewareContextDefinition<unknown>
  Define an untyped request-context value used only for static composition.

  Create the direct or curried middleware-context authoring function.
```

### middleware: define

[Declaration source](middleware/mod.ts#L81)

```text
function define<Input extends MiddlewareDefinitionInput>(input: Input): MiddlewareDefinition<MiddlewareRequires<Input>, MiddlewareProvides<Input>, MiddlewareResources<Input>, MiddlewareProblems<Input>>
  Define one import-safe middleware contract.
```

### middleware: document

[Declaration source](middleware/mod.ts#L309)

```text
function document(input: DefinitionInput<MiddlewareDefinition>): readonly MiddlewareDocument[]
  Create deterministic JSON-safe middleware documentation.
```

### middleware: handler

[Declaration source](middleware/mod.ts#L159)

```text
function handler<Definition extends MiddlewareDefinition, Host = unknown, Result = unknown>(definition: Definition, handle: MiddlewareHandler<Definition, Host, Result>["handle"]): MiddlewareHandler<Definition, Host, Result>
  Bind runtime behavior to one exact middleware definition.
```

### middleware: middlewareCatalog

[Declaration source](middleware/mod.ts#L201)

```text
function middlewareCatalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, MiddlewareDefinition>>>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries>
  Create a named middleware catalog.
```

### middleware: once

[Declaration source](middleware/mod.ts#L180)

```text
function once<Definition extends MiddlewareDefinition, Host = unknown, Result = unknown>(binding: MiddlewareHandler<Definition, Host, Result>, key: MiddlewareOnceKey): MiddlewareHandler<Definition, Host, Result>
  Wrap an exact middleware handler so its inner work executes at most once for
  one Request, even when the same definition is contributed by several layers.

  Duplicate occurrences still call `next()`, preserving the compiled onion.
  The request-keyed state is weak and cannot suppress another request.
```

### middleware: plan

[Declaration source](middleware/mod.ts#L244)

```text
function plan(input: MiddlewareInput | undefined): MiddlewarePlan
  Normalize middleware input while preserving authored order within each lane.
```

### middleware: select

[Declaration source](middleware/mod.ts#L209)

```text
function select<Entries extends Readonly<Record<PropertyKey, MiddlewareDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: Catalog<Entries[keyof Entries], Entries>, keys: Keys): CatalogSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select an immutable key-preserving middleware subset.
```

### middleware: validate

[Declaration source](middleware/mod.ts#L256)

```text
function validate(input: MiddlewareInput | undefined, initialContexts: readonly MiddlewareContextDefinition[]): MiddlewareValidationResult
  Validate ordering, IDs, and context guarantees for one middleware input.
```

### middleware: wholeRequest

[Declaration source](middleware/mod.ts#L227)

```text
function wholeRequest<Definition extends MiddlewareDefinition>(definition: Definition): MiddlewareUse<Definition, "wholeRequest">
  Surround the complete application request pipeline before transport materialization.
```

### middleware: MiddlewareContextDefinition

[Declaration source](middleware/mod.ts#L449)

```text
reference MiddlewareContextDefinition: ./packages/server/middleware/types.ts:22:1
```

### middleware: MiddlewareContextDefinitionInput

[Declaration source](middleware/mod.ts#L450)

```text
reference MiddlewareContextDefinitionInput: ./packages/server/middleware/types.ts:30:1
```

### middleware: MiddlewareContextStore

[Declaration source](middleware/mod.ts#L451)

```text
reference MiddlewareContextStore: ./packages/server/middleware/types.ts:124:1
```

### middleware: MiddlewareContextValue

[Declaration source](middleware/mod.ts#L452)

```text
reference MiddlewareContextValue: ./packages/server/middleware/types.ts:38:1
```

### middleware: MiddlewareDefinition

[Declaration source](middleware/mod.ts#L453)

```text
reference MiddlewareDefinition: ./packages/server/middleware/types.ts:42:1
```

### middleware: MiddlewareDefinitionInput

[Declaration source](middleware/mod.ts#L454)

```text
reference MiddlewareDefinitionInput: ./packages/server/middleware/types.ts:73:1
```

### middleware: MiddlewareDocument

[Declaration source](middleware/mod.ts#L455)

```text
reference MiddlewareDocument: ./packages/server/middleware/types.ts:244:1
```

### middleware: MiddlewareHandler

[Declaration source](middleware/mod.ts#L456)

```text
reference MiddlewareHandler: ./packages/server/middleware/types.ts:172:1
```

### middleware: MiddlewareHandlerContext

[Declaration source](middleware/mod.ts#L457)

```text
reference MiddlewareHandlerContext: ./packages/server/middleware/types.ts:144:1
```

### middleware: MiddlewareInput

[Declaration source](middleware/mod.ts#L458)

```text
reference MiddlewareInput: ./packages/server/middleware/types.ts:205:1
```

### middleware: MiddlewareLane

[Declaration source](middleware/mod.ts#L459)

```text
reference MiddlewareLane: ./packages/server/middleware/types.ts:189:1
```

### middleware: MiddlewareNext

[Declaration source](middleware/mod.ts#L460)

```text
reference MiddlewareNext: ./packages/server/middleware/types.ts:166:1
```

### middleware: MiddlewareOnceKey

[Declaration source](middleware/mod.ts#L461)

```text
reference MiddlewareOnceKey: ./packages/server/middleware/types.ts:169:1
```

### middleware: MiddlewarePlan

[Declaration source](middleware/mod.ts#L462)

```text
reference MiddlewarePlan: ./packages/server/middleware/types.ts:211:1
```

### middleware: MiddlewareProblems

[Declaration source](middleware/mod.ts#L463)

```text
reference MiddlewareProblems: ./packages/server/middleware/types.ts:118:1
```

### middleware: MiddlewareProvides

[Declaration source](middleware/mod.ts#L464)

```text
reference MiddlewareProvides: ./packages/server/middleware/types.ts:107:1
```

### middleware: MiddlewareRequires

[Declaration source](middleware/mod.ts#L465)

```text
reference MiddlewareRequires: ./packages/server/middleware/types.ts:102:1
```

### middleware: MiddlewareResourceDefinition

[Declaration source](middleware/mod.ts#L466)

```text
reference MiddlewareResourceDefinition: ./packages/server/middleware/types.ts:14:1
```

### middleware: MiddlewareResourceResolver

[Declaration source](middleware/mod.ts#L467)

```text
reference MiddlewareResourceResolver: ./packages/server/middleware/types.ts:134:1
```

### middleware: MiddlewareResourceValue

[Declaration source](middleware/mod.ts#L469)

```text
reference MiddlewareResourceValue: ./packages/server/middleware/types.ts:17:1
```

### middleware: MiddlewareResources

[Declaration source](middleware/mod.ts#L468)

```text
reference MiddlewareResources: ./packages/server/middleware/types.ts:112:1
```

### middleware: MiddlewareUse

[Declaration source](middleware/mod.ts#L470)

```text
reference MiddlewareUse: ./packages/server/middleware/types.ts:192:1
```

### middleware: MiddlewareValidationIssue

[Declaration source](middleware/mod.ts#L471)

```text
reference MiddlewareValidationIssue: ./packages/server/middleware/types.ts:223:1
```

### middleware: MiddlewareValidationResult

[Declaration source](middleware/mod.ts#L472)

```text
reference MiddlewareValidationResult: ./packages/server/middleware/types.ts:239:1
```

## middleware-types

Import `@okikio/server/middleware/types`. [Source](./middleware/types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                              | Contract owner or source                       |
| --------------------------------------------- | ---------------------------------------------- |
| `CatalogEntryIdentity`                        | [catalog contracts](../catalog/API.md)         |
| `CatalogEntryValue`                           | [catalog contracts](../catalog/API.md)         |
| `DefinitionEntry`                             | [catalog contracts](../catalog/API.md)         |
| `DefinitionInput`                             | [catalog contracts](../catalog/API.md)         |
| `ValuedCatalogEntry`                          | [catalog contracts](../catalog/API.md)         |
| `Context`                                     | [context contracts](../context/API.md)         |
| `EffectContext`                               | [effect contracts](../effect/API.md)           |
| `EffectDefinitions`                           | [effect contracts](../effect/API.md)           |
| `ProblemDefinition`                           | [http contracts](../http/API.md)               |
| `ResilienceInput`                             | [resilience contracts](../resilience/API.md)   |
| `RequirementDocument`                         | [requirement contracts](../requirement/API.md) |
| `RequirementInput`                            | [requirement contracts](../requirement/API.md) |
| [Declaration source](middleware/types.ts#L19) |                                                |

```text
private const middlewareContextValue: unique symbol
```

### middleware-types: MiddlewareContextDefinition

[Declaration source](middleware/types.ts#L22)

```text
interface MiddlewareContextDefinition<Value = unknown> extends CatalogEntryIdentity
  Typed request-context value that middleware may require or provide.

  readonly kind: "middleware-context"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly [middlewareContextValue]: Value
    Compile-time context value inference slot; it is not an initialized runtime value.
```

### middleware-types: MiddlewareContextDefinitionInput

[Declaration source](middleware/types.ts#L30)

```text
interface MiddlewareContextDefinitionInput
  Input accepted by {@link context}.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
```

### middleware-types: MiddlewareContextStore

[Declaration source](middleware/types.ts#L124)

```text
interface MiddlewareContextStore<Allowed extends MiddlewareContextDefinition = MiddlewareContextDefinition>
  Typed context store visible to one middleware handler.

  has(definition: Definition): boolean
    Test whether this exact context definition has a stored request value.
  get(definition: Definition): MiddlewareContextValue<Definition>
    Get the value stored under this exact allowed context definition; missing values throw.
  set(definition: Definition, value: MiddlewareContextValue<Definition>): void
    Store a value under the exact context definition so later declared middleware can retrieve it.
```

### middleware-types: MiddlewareDefinition

[Declaration source](middleware/types.ts#L42)

```text
interface MiddlewareDefinition<Requires extends readonly MiddlewareContextDefinition[] = readonly MiddlewareContextDefinition[], Provides extends readonly MiddlewareContextDefinition[] = readonly MiddlewareContextDefinition[], Resources extends MiddlewareResourceDefinition = MiddlewareResourceDefinition, Problems extends ProblemDefinition = ProblemDefinition> extends CatalogEntryIdentity
  Static import-safe middleware contract.

  readonly kind: "middleware"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly requires: Requires
    Context definitions, or their IDs in documents, needed before this middleware runs.
  readonly provides: Provides
    Context definitions, or their IDs in documents, that this middleware makes available.
  readonly resources?: DefinitionInput<Resources>
    Resource contracts reachable through this declaration; the live host owns acquisition.
  readonly problems?: DefinitionInput<Problems>
    Declared HTTP problem contracts or their projected IDs.
  readonly requirements?: RequirementInput
    Active requirement declarations; declaring them does not itself authorize work.
  readonly effects?: EffectDefinitions
    Required one-way consequences this middleware may announce when it runs.
  readonly authentication?: DefinitionInput<CatalogEntryIdentity>
    Authentication contracts required by the selected operation; the host supplies their evaluator.
  readonly resiliency?: ResilienceInput
    Declared resilience policies; each policy retains a designated runtime owner.
  readonly documentation?: Readonly<{ readonly url?: string; readonly notes?: string; }>
    Author-supplied reference URL and notes retained alongside this middleware.
```

### middleware-types: MiddlewareDefinitionInput

[Declaration source](middleware/types.ts#L73)

```text
interface MiddlewareDefinitionInput<Requires extends readonly MiddlewareContextDefinition[] = readonly MiddlewareContextDefinition[], Provides extends readonly MiddlewareContextDefinition[] = readonly MiddlewareContextDefinition[]>
  Input accepted by {@link define}.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly requires?: Requires
    Context definitions, or their IDs in documents, needed before this middleware runs.
  readonly provides?: Provides
    Context definitions, or their IDs in documents, that this middleware makes available.
  readonly resources?: DefinitionInput<MiddlewareResourceDefinition>
    Resource contracts reachable through this declaration; the live host owns acquisition.
  readonly problems?: DefinitionInput<ProblemDefinition>
    Declared HTTP problem contracts or their projected IDs.
  readonly requirements?: RequirementInput
    Active requirement declarations; declaring them does not itself authorize work.
  readonly effects?: EffectDefinitions
    Required one-way consequences this middleware may announce when it runs.
  readonly authentication?: DefinitionInput<CatalogEntryIdentity>
    Authentication contracts required by the selected operation; the host supplies their evaluator.
  readonly resiliency?: ResilienceInput
    Declared resilience policies; each policy retains a designated runtime owner.
  readonly documentation?: Readonly<{ readonly url?: string; readonly notes?: string; }>
    Author-supplied reference URL and notes retained alongside this middleware.
```

### middleware-types: MiddlewareDocument

[Declaration source](middleware/types.ts#L244)

```text
interface MiddlewareDocument
  JSON-safe middleware documentation projection.

  readonly id: string
    Stable declaration identity used for exact lookup and diagnostic correlation.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly requires: readonly string[]
    Context definitions, or their IDs in documents, needed before this middleware runs.
  readonly provides: readonly string[]
    Context definitions, or their IDs in documents, that this middleware makes available.
  readonly resources: readonly string[]
    Resource contracts reachable through this declaration; the live host owns acquisition.
  readonly problems: readonly string[]
    Declared HTTP problem contracts or their projected IDs.
  readonly requirements: readonly RequirementDocument[]
    Active requirement declarations; declaring them does not itself authorize work.
  readonly effects: readonly string[]
    Effect IDs this middleware may announce.
  readonly resiliency: readonly string[]
    Declared resilience policies; each policy retains a designated runtime owner.
  readonly documentation?: Readonly<{ readonly url?: string; readonly notes?: string; }>
    Author-supplied reference URL and notes retained alongside this middleware.
```

### middleware-types: MiddlewareHandler

[Declaration source](middleware/types.ts#L172)

```text
interface MiddlewareHandler<Definition extends MiddlewareDefinition = MiddlewareDefinition, Host = unknown, Result = unknown>
  Runtime behavior bound to one exact middleware definition.

  readonly kind: "middleware-handler"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly definition: Definition
    Exact declaration involved in this binding, result or validation issue.
  readonly handle: (context: MiddlewareHandlerContext<Definition, Host>, next: MiddlewareNext<Result>) => Result | Promise<Result>
    Run under the declared request context and optionally await next() to surround downstream work.
```

### middleware-types: MiddlewareHandlerContext

[Declaration source](middleware/types.ts#L144)

```text
interface MiddlewareHandlerContext<Definition extends MiddlewareDefinition = MiddlewareDefinition, Host = unknown>
  Runtime context supplied to a middleware handler by the server adapter.

  readonly request: Request
    Web Request borrowed for this operation; body ownership follows the enclosing transport contract.
  readonly host: Host
    Application-owned host values supplied by the composition root.
  readonly values: MiddlewareContextStore<Definition["requires"][number] | Definition["provides"][number]>
    Request-local values addressable only by this middleware required and provided context definitions.
  readonly resources: MiddlewareResourceResolver<Extract<DefinitionEntry<NonNullable<Definition["resources"]>>, MiddlewareResourceDefinition>>
    Borrowed resource resolver constrained to this middleware declaration; the host owns cleanup.
  readonly ctx: EffectContext<Context>
    Execution context borrowed from the request lifetime owner for cancellation, timing and effects.
```

### middleware-types: MiddlewarePlan

[Declaration source](middleware/types.ts#L211)

```text
interface MiddlewarePlan
  Normalized deterministic middleware lanes.

  readonly wholeRequest: readonly MiddlewareDefinition[]
    Middleware that surrounds the complete request lifetime.
  readonly beforeValidation: readonly MiddlewareDefinition[]
    Middleware applied before request input validation.
  readonly afterValidation: readonly MiddlewareDefinition[]
    Middleware applied after input validation succeeds.
  readonly aroundOperation: readonly MiddlewareDefinition[]
    Middleware that surrounds the selected endpoint operation.
```

### middleware-types: MiddlewareResourceResolver

[Declaration source](middleware/types.ts#L134)

```text
interface MiddlewareResourceResolver<Allowed extends MiddlewareResourceDefinition = MiddlewareResourceDefinition>
  Resource resolver constrained to the middleware declaration envelope.

  has(definition: Definition): boolean
    Test whether the exact declared resource is available in this resolver.
  get(definition: Definition): Promise<MiddlewareResourceValue<Definition>>
    Borrow an allowed resource from its live owner; acquisition failures reject the returned promise.
```

### middleware-types: MiddlewareUse

[Declaration source](middleware/types.ts#L192)

```text
interface MiddlewareUse<Definition extends MiddlewareDefinition = MiddlewareDefinition, Lane extends MiddlewareLane = MiddlewareLane>
  Use-site placement wrapper around one middleware definition.

  readonly kind: "middleware-use"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly definition: Definition
    Exact declaration involved in this binding, result or validation issue.
  readonly lane: Lane
    Compiler placement lane selected for this middleware use.
```

### middleware-types: MiddlewareValidationIssue

[Declaration source](middleware/types.ts#L223)

```text
interface MiddlewareValidationIssue
  One validation issue in a middleware definition or composition.

  readonly code: "invalid-id" | "duplicate-id" | "duplicate-context-provider" | "missing-required-context"
    Stable failure code; callers should branch on this instead of matching explanation text.
  readonly message: string
    Human-readable diagnostic explanation; it is not a stable program discriminator.
  readonly definition?: MiddlewareDefinition
    Exact middleware declaration associated with this validation issue, when available.
  readonly context?: MiddlewareContextDefinition
    Exact context declaration involved in the missing or duplicate provider issue.
```

### middleware-types: MiddlewareContextValue

[Declaration source](middleware/types.ts#L38)

```text
type MiddlewareContextValue<Definition extends MiddlewareContextDefinition> = Definition extends MiddlewareContextDefinition<infer Value> ? Value : never
  Value represented by one middleware context definition.
```

### middleware-types: MiddlewareInput

[Declaration source](middleware/types.ts#L205)

```text
type MiddlewareInput = MiddlewareDefinition | MiddlewareUse | readonly MiddlewareInput[]
  Direct or explicitly placed middleware value accepted by composition fields.
```

### middleware-types: MiddlewareLane

[Declaration source](middleware/types.ts#L189)

```text
type MiddlewareLane = "wholeRequest" | "beforeValidation" | "afterValidation" | "aroundOperation"
  Supported compiler placement lanes.
```

### middleware-types: MiddlewareNext

[Declaration source](middleware/types.ts#L166)

```text
type MiddlewareNext<Result = unknown> = () => Promise<Result>
  Onion-style continuation used by middleware handlers.
```

### middleware-types: MiddlewareOnceKey

[Declaration source](middleware/types.ts#L169)

```text
type MiddlewareOnceKey = string | symbol | object
  Stable key for middleware work that must execute at most once per request.
```

### middleware-types: MiddlewareProblems

[Declaration source](middleware/types.ts#L118)

```text
type MiddlewareProblems<Input extends MiddlewareDefinitionInput> = Extract<DefinitionEntry<NonNullable<Input["problems"]>>, ProblemDefinition>
  Problem definitions represented by one middleware input.
```

### middleware-types: MiddlewareProvides

[Declaration source](middleware/types.ts#L107)

```text
type MiddlewareProvides<Input extends MiddlewareDefinitionInput> = Input extends { readonly provides: infer Provides extends readonly MiddlewareContextDefinition[]; } ? Provides : readonly []
  Provided contexts represented by one middleware authoring input.
```

### middleware-types: MiddlewareRequires

[Declaration source](middleware/types.ts#L102)

```text
type MiddlewareRequires<Input extends MiddlewareDefinitionInput> = Input extends { readonly requires: infer Requires extends readonly MiddlewareContextDefinition[]; } ? Requires : readonly []
  Required contexts represented by one middleware authoring input.
```

### middleware-types: MiddlewareResourceDefinition

[Declaration source](middleware/types.ts#L14)

```text
type MiddlewareResourceDefinition<Value = unknown> = ValuedCatalogEntry<"resource", Value>
  Static resource reference accepted by portable middleware contracts.
```

### middleware-types: MiddlewareResourceValue

[Declaration source](middleware/types.ts#L17)

```text
type MiddlewareResourceValue<Definition extends MiddlewareResourceDefinition> = CatalogEntryValue<Definition>
  Runtime value represented by one middleware resource reference.
```

### middleware-types: MiddlewareResources

[Declaration source](middleware/types.ts#L112)

```text
type MiddlewareResources<Input extends MiddlewareDefinitionInput> = Extract<DefinitionEntry<NonNullable<Input["resources"]>>, MiddlewareResourceDefinition>
  Resource definitions represented by one middleware input.
```

### middleware-types: MiddlewareValidationResult

[Declaration source](middleware/types.ts#L239)

```text
type MiddlewareValidationResult = Readonly<{ readonly valid: true; readonly plan: MiddlewarePlan; }> | Readonly<{ readonly valid: false; readonly issues: readonly MiddlewareValidationIssue[]; }>
  Deterministic validation result for middleware composition.
```

## service

Import `@okikio/server/service`. [Source](./service/mod.ts).

Compile declared endpoints and concrete handlers before serving requests.

Add resources, middleware, requirement interpreters and observers at the host boundary. Compilation rejects missing or
conflicting contracts. The runtime owns request contexts and borrows the host; await its disposal to join owned resource
cleanup.

### service: authenticated

[Declaration source](service/compile.ts#L80)

```text
function authenticated(definition: ServiceDefinition): readonly EndpointDefinition[]
  Return exact endpoints whose effective service contract requires authentication.
```

### service: compile

[Declaration source](service/compile.ts#L97)

```text
function compile<Definition extends ServiceDefinition, Host extends object = EmptyEndpointHost>(implementation: ServiceImplementation<Definition, Host>): CompiledService<Definition, Host>
  Compile a definition and its exact runtime implementation into one authoritative service artifact.
```

### service: create

[Declaration source](service/runtime.ts#L102)

```text
function create<Host extends object, Values extends ServiceRequestValues = ServiceRequestValues>(compiled: CompiledService<import("./types.ts").ServiceDefinition, Host>, options: CreateServiceOptions<Host, Values>): ServiceRuntime
  Create a framework-neutral Fetch runtime from one fully compiled service.
```

### service: document

[Declaration source](service/compile.ts#L330)

```text
function document(compiled: CompiledService): ServiceManifest
  Return the deterministic manifest retained by a compiled service.
```

### service: implement

[Declaration source](service/implementation.ts#L6)

```text
function implement<Definition extends ServiceDefinition, Host extends object = import("@okikio/server/endpoint").EmptyEndpointHost>(definition: Definition, input: ServiceImplementationInput<Host>): ServiceImplementation<Definition, Host>
  Bind an exact service definition to its HTTP endpoint, middleware, and resource implementations.
```

### service: openapi

[Declaration source](service/openapi.ts#L21)

```text
async function openapi(compiled: CompiledService, options: ServiceOpenApiOptions): Promise<OpenApiDocument>
  Generate OpenAPI from the compiler-resolved operation graph.

  The projection uses effective response and problem envelopes, including
  service, policy, group, endpoint, middleware, resource, and compiler-
  generated contributions. It never reconstructs route ownership from IDs or
  copied URL inventories.
```

### service: validate

[Declaration source](service/compile.ts#L65)

```text
function validate(definition: ServiceDefinition): ServiceValidationResult
  Validate an import-safe service definition without requiring runtime implementations.
```

### service: ServiceCompilationError

[Declaration source](service/compile.ts#L48)

```text
class ServiceCompilationError extends Error
  Error raised when service compilation finds one or more contract defects.

  constructor(issues: readonly ServiceValidationIssue[])
    Retain service validation issues when compilation cannot produce a valid route set.
  readonly issues: readonly ServiceValidationIssue[]
    Structured validation issues retained for inspection without matching error messages.
```

### service: ServiceRuntimeConfigurationError

[Declaration source](service/runtime.ts#L93)

```text
class ServiceRuntimeConfigurationError extends Error
  Error raised when a compiled service is missing a required runtime adapter.

  constructor(message: string)
    Explain a missing or incompatible host capability before accepting live requests.
```

### service: ServiceOpenApiOptions

[Declaration source](service/openapi.ts#L8)

```text
interface ServiceOpenApiOptions extends Omit<OpenApiOptions, "description">
  Options for projecting one compiled service to OpenAPI 3.1.

  readonly description?: string
    Override the service definition description in the generated document.
```

### service: CompiledService

[Declaration source](service/mod.ts#L35)

```text
reference CompiledService: ./packages/server/service/types.ts:362:1
```

### service: CreateServiceOptions

[Declaration source](service/mod.ts#L36)

```text
reference CreateServiceOptions: ./packages/server/service/types.ts:530:1
```

### service: EffectiveServiceOperation

[Declaration source](service/mod.ts#L37)

```text
reference EffectiveServiceOperation: ./packages/server/service/types.ts:264:1
```

### service: RetryableOperationError

[Declaration source](service/mod.ts#L30)

```text
reference RetryableOperationError: ./packages/server/service/resilience.ts:20:1
```

### service: ServiceContextStore

[Declaration source](service/mod.ts#L38)

```text
reference ServiceContextStore: ./packages/server/service/types.ts:517:1
```

### service: ServiceContributions

[Declaration source](service/mod.ts#L39)

```text
reference ServiceContributions: ./packages/server/service/types.ts:48:1
```

### service: ServiceDefinition

[Declaration source](service/mod.ts#L40)

```text
reference ServiceDefinition: ./packages/server/service/types.ts:136:1
```

### service: ServiceDefinitionInput

[Declaration source](service/mod.ts#L41)

```text
reference ServiceDefinitionInput: ./packages/server/service/types.ts:159:1
```

### service: ServiceImplementation

[Declaration source](service/mod.ts#L42)

```text
reference ServiceImplementation: ./packages/server/service/types.ts:188:1
```

### service: ServiceImplementationInput

[Declaration source](service/mod.ts#L43)

```text
reference ServiceImplementationInput: ./packages/server/service/types.ts:207:1
```

### service: ServiceInputValues

[Declaration source](service/mod.ts#L44)

```text
reference ServiceInputValues: ./packages/server/service/types.ts:430:1
```

### service: ServiceManifest

[Declaration source](service/mod.ts#L45)

```text
reference ServiceManifest: ./packages/server/service/types.ts:326:1
```

### service: ServiceObserverDefinition

[Declaration source](service/mod.ts#L46)

```text
reference ServiceObserverDefinition: ./packages/server/service/types.ts:86:1
```

### service: ServiceObserverEvent

[Declaration source](service/mod.ts#L47)

```text
reference ServiceObserverEvent: ./packages/server/service/types.ts:96:1
```

### service: ServiceObserverEventKind

[Declaration source](service/mod.ts#L48)

```text
reference ServiceObserverEventKind: ./packages/server/service/types.ts:83:1
```

### service: ServiceObserverHandler

[Declaration source](service/mod.ts#L49)

```text
reference ServiceObserverHandler: ./packages/server/service/types.ts:126:1
```

### service: ServicePolicy

[Declaration source](service/mod.ts#L50)

```text
reference ServicePolicy: ./packages/server/service/types.ts:66:1
```

### service: ServicePolicyInput

[Declaration source](service/mod.ts#L51)

```text
reference ServicePolicyInput: ./packages/server/service/types.ts:74:1
```

### service: ServiceRequestState

[Declaration source](service/mod.ts#L52)

```text
reference ServiceRequestState: ./packages/server/service/types.ts:468:1
```

### service: ServiceRequestStatePatch

[Declaration source](service/mod.ts#L53)

```text
reference ServiceRequestStatePatch: ./packages/server/service/types.ts:474:1
```

### service: ServiceRequestValues

[Declaration source](service/mod.ts#L54)

```text
reference ServiceRequestValues: ./packages/server/service/types.ts:424:1
```

### service: ServiceResilienceAdapter

[Declaration source](service/mod.ts#L55)

```text
reference ServiceResilienceAdapter: ./packages/server/service/types.ts:484:1
```

### service: ServiceRetryOptions

[Declaration source](service/mod.ts#L31)

```text
reference ServiceRetryOptions: ./packages/server/service/resilience.ts:33:1
```

### service: ServiceRoute

[Declaration source](service/mod.ts#L56)

```text
reference ServiceRoute: ./packages/server/service/types.ts:219:1
```

### service: ServiceRouteManifestEntry

[Declaration source](service/mod.ts#L57)

```text
reference ServiceRouteManifestEntry: ./packages/server/service/types.ts:290:1
```

### service: ServiceRuntime

[Declaration source](service/mod.ts#L58)

```text
reference ServiceRuntime: ./packages/server/service/types.ts:573:1
```

### service: ServiceRuntimeAdapters

[Declaration source](service/mod.ts#L59)

```text
reference ServiceRuntimeAdapters: ./packages/server/service/types.ts:499:1
```

### service: ServiceRuntimeRoute

[Declaration source](service/mod.ts#L60)

```text
reference ServiceRuntimeRoute: ./packages/server/service/types.ts:557:1
```

### service: ServiceSelection

[Declaration source](service/mod.ts#L61)

```text
reference ServiceSelection: ./packages/server/service/types.ts:176:1
```

### service: ServiceStageResult

[Declaration source](service/mod.ts#L62)

```text
reference ServiceStageResult: ./packages/server/service/types.ts:583:1
```

### service: ServiceValidationIssue

[Declaration source](service/mod.ts#L63)

```text
reference ServiceValidationIssue: ./packages/server/service/types.ts:390:1
```

### service: ServiceValidationResult

[Declaration source](service/mod.ts#L64)

```text
reference ServiceValidationResult: ./packages/server/service/types.ts:414:1
```

### service: ServiceValidationSubject

[Declaration source](service/mod.ts#L65)

```text
reference ServiceValidationSubject: ./packages/server/service/types.ts:381:1
```

### service: ServiceValuePatch

[Declaration source](service/mod.ts#L66)

```text
reference ServiceValuePatch: ./packages/server/service/types.ts:461:1
```

### service: compose

[Declaration source](service/mod.ts#L25)

```text
reference compose: ./packages/server/service/definition.ts:145:1
```

### service: define

[Declaration source](service/mod.ts#L25)

```text
reference define: ./packages/server/service/definition.ts:24:1
```

### service: joinPath

[Declaration source](service/mod.ts#L26)

```text
reference joinPath: ./packages/server/endpoint/path.ts:9:1
```

### service: leafEndpoints

[Declaration source](service/mod.ts#L25)

```text
reference leafEndpoints: ./packages/server/service/definition.ts:173:1
```

### service: observer

[Declaration source](service/mod.ts#L25)

```text
reference observer: ./packages/server/service/definition.ts:98:14
```

### service: policy

[Declaration source](service/mod.ts#L25)

```text
reference policy: ./packages/server/service/definition.ts:101:1
```

### service: resilience

[Declaration source](service/mod.ts#L30)

```text
reference resilience: ./packages/server/service/resilience.ts:108:1
```

### service: retry

[Declaration source](service/mod.ts#L30)

```text
reference retry: ./packages/server/service/resilience.ts:55:1
```

### service: select

[Declaration source](service/mod.ts#L25)

```text
reference select: ./packages/server/service/definition.ts:115:1
```

## service-definition

Import `@okikio/server/service/definition`. [Source](./service/definition.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source                     |
| --------------------------- | -------------------------------------------- |
| `catalog`                   | [catalog contracts](../catalog/API.md)       |
| `effect`                    | [effect contracts](../effect/API.md)         |
| `endpoint`                  | [Source](endpoint/definition.ts)             |
| `resilience`                | [resilience contracts](../resilience/API.md) |
| `EndpointCompositionInput`  | [Source](endpoint/types.ts)                  |
| `EndpointDefinition`        | [Source](endpoint/types.ts)                  |
| `EndpointEntry`             | [Source](endpoint/types.ts)                  |
| `EndpointGroup`             | [Source](endpoint/types.ts)                  |
| `EndpointGroupSelection`    | [Source](endpoint/types.ts)                  |
| `ServiceDefinition`         | [Source](service/types.ts)                   |
| `ServiceDefinitionInput`    | [Source](service/types.ts)                   |
| `ServiceObserverDefinition` | [Source](service/types.ts)                   |
| `ServiceObserverEventKind`  | [Source](service/types.ts)                   |
| `ServiceObserverHandler`    | [Source](service/types.ts)                   |
| `ServicePolicy`             | [Source](service/types.ts)                   |
| `ServicePolicyInput`        | [Source](service/types.ts)                   |
| `ServiceSelection`          | [Source](service/types.ts)                   |

### service-definition: compose

[Declaration source](service/definition.ts#L145)

```text
function compose(...input: readonly (ServiceDefinition | ServiceSelection | readonly (ServiceDefinition | ServiceSelection)[])[]): readonly (ServiceDefinition | ServiceSelection)[]
  Compose service definitions or selections into deterministic direct references.
```

### service-definition: define

[Declaration source](service/definition.ts#L24)

```text
function define<Id extends string, Path extends string>(input: ServiceDefinitionInput<Id, Path>): ServiceDefinition<Id, Path>
  Define one import-safe independently deployable service.
```

### service-definition: leafEndpoints

[Declaration source](service/definition.ts#L173)

```text
function leafEndpoints(input: EndpointCompositionInput): readonly EndpointDefinition[]
  Return exact leaf endpoint definitions represented by a composition.
```

### service-definition: policy

[Declaration source](service/definition.ts#L101)

```text
function policy(input: ServicePolicyInput): ServicePolicy
  Define one selector-based additive service policy.
```

### service-definition: select

[Declaration source](service/definition.ts#L115)

```text
function select<Service extends ServiceDefinition>(service: Service, input: Readonly<{ readonly id: string; readonly description?: string; readonly endpoints: EndpointCompositionInput; }>): ServiceSelection<Service>
  Select exact endpoint definitions from one service without copying routes.
```

### service-definition: observer

[Declaration source](service/definition.ts#L98)

```text
const observer
  Service lifecycle observer definition and handler namespace.
```

### service-definition: EndpointGroup

[Declaration source](service/definition.ts#L246)

```text
reference EndpointGroup: ./packages/server/endpoint/types.ts:315:1
```

### service-definition: EndpointGroupSelection

[Declaration source](service/definition.ts#L246)

```text
reference EndpointGroupSelection: ./packages/server/endpoint/types.ts:332:1
```

## service-resilience

Import `@okikio/server/service/resilience`. [Source](./service/resilience.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding           | Contract owner or source                                    |
| -------------------------- | ----------------------------------------------------------- |
| `retryAsync`               | [External source](https://jsr.io/@std/async/1.5.0/retry.ts) |
| `RetryError`               | [External source](https://jsr.io/@std/async/1.5.0/retry.ts) |
| `durationCore`             | [duration contracts](../duration/API.md)                    |
| `EmptyEndpointHost`        | [Source](endpoint/types.ts)                                 |
| `ResiliencePolicy`         | [resilience contracts](../resilience/API.md)                |
| `RetryPolicy`              | [resilience contracts](../resilience/API.md)                |
| `fault`                    | [fault contracts](../fault/API.md)                          |
| `ServiceRequestState`      | [Source](service/types.ts)                                  |
| `ServiceRequestValues`     | [Source](service/types.ts)                                  |
| `ServiceResilienceAdapter` | [Source](service/types.ts)                                  |
| `ServiceStageResult`       | [Source](service/types.ts)                                  |

### service-resilience: resilience

[Declaration source](service/resilience.ts#L108)

```text
function resilience<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues>(...adapters: readonly ServiceResilienceAdapter<Host, Values>[]): ServiceResilienceAdapter<Host, Values>
  Compose focused resilience adapters into one deterministic onion.

  Every adapter-owned policy must be owned by exactly one adapter. Adapters execute
  in the order of the first policy they own. After-work unwinds in reverse
  order, matching middleware and resource-lifecycle expectations.
```

### service-resilience: retry

[Declaration source](service/resilience.ts#L55)

```text
function retry<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues>(options: ServiceRetryOptions<Host, Values>): ServiceResilienceAdapter<Host, Values>
  Create a service resilience adapter backed by `@std/async/retry`.

  This adapter supports only `retry` policies. Compose it with a durable
  idempotency, rate-limit, circuit-breaker, or bulkhead adapter through
  {@link resilience} when an operation declares several policies.
```

### service-resilience: RetryableOperationError

[Declaration source](service/resilience.ts#L20)

```text
class RetryableOperationError extends Error
  Error wrapper used when a caller deliberately classifies an operation failure
  as safe to retry.

  Ordinary errors are not retried by default. A provider adapter may either
  throw this wrapper or supply an explicit classifier to {@link retry}.

  constructor(cause: Error, options: Readonly<{ readonly code?: string; readonly message?: string; }>)
    Retain a stable failure code for the explicit retry policy to inspect.
  readonly code?: string
    Stable failure code; callers should branch on this instead of matching explanation text.
```

### service-resilience: ServiceRetryOptions

[Declaration source](service/resilience.ts#L33)

```text
interface ServiceRetryOptions<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues>
  Configuration for the standard-library-backed retry runtime.

  readonly isRetriable?: (error: Error, policy: RetryPolicy, state: ServiceRequestState<Host, Values>) => boolean
    Override retry classification for provider/domain-specific errors.
    Returning `true` asserts that replaying the wrapped operation is safe.
```

## service-types

Import `@okikio/server/service/types`. [Source](./service/types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding              | Contract owner or source                       |
| ----------------------------- | ---------------------------------------------- |
| `CatalogEntryIdentity`        | [catalog contracts](../catalog/API.md)         |
| `DefinitionInput`             | [catalog contracts](../catalog/API.md)         |
| `AnyEndpointHandlerBinding`   | [Source](endpoint/types.ts)                    |
| `EmptyEndpointHost`           | [Source](endpoint/types.ts)                    |
| `EndpointCompositionInput`    | [Source](endpoint/types.ts)                    |
| `EndpointDefinition`          | [Source](endpoint/types.ts)                    |
| `EndpointEntry`               | [Source](endpoint/types.ts)                    |
| `EndpointGroup`               | [Source](endpoint/types.ts)                    |
| `EndpointInputSlot`           | [Source](endpoint/types.ts)                    |
| `EndpointInputSource`         | [Source](endpoint/types.ts)                    |
| `EndpointMethod`              | [Source](endpoint/types.ts)                    |
| `EndpointOperation`           | [Source](endpoint/types.ts)                    |
| `EndpointRequestValues`       | [Source](endpoint/types.ts)                    |
| `EndpointRuntimeInputValues`  | [Source](endpoint/types.ts)                    |
| `EnvironmentDefinition`       | [env contracts](../env/API.md)                 |
| `EnvironmentManifest`         | [env contracts](../env/API.md)                 |
| `Context`                     | [context contracts](../context/API.md)         |
| `EffectContext`               | [effect contracts](../effect/API.md)           |
| `EffectDefinition`            | [effect contracts](../effect/API.md)           |
| `EffectDefinitions`           | [effect contracts](../effect/API.md)           |
| `EffectEmitter`               | [effect contracts](../effect/API.md)           |
| `MiddlewareContextDefinition` | [Source](middleware/types.ts)                  |
| `MiddlewareContextValue`      | [Source](middleware/types.ts)                  |
| `MiddlewareHandler`           | [Source](middleware/types.ts)                  |
| `MiddlewareInput`             | [Source](middleware/types.ts)                  |
| `MiddlewarePlan`              | [Source](middleware/types.ts)                  |
| `ResilienceDocument`          | [resilience contracts](../resilience/API.md)   |
| `ResilienceInput`             | [resilience contracts](../resilience/API.md)   |
| `ResiliencePolicy`            | [resilience contracts](../resilience/API.md)   |
| `ProblemDefinition`           | [http contracts](../http/API.md)               |
| `ProblemResult`               | [http contracts](../http/API.md)               |
| `ResponseDefinition`          | [http contracts](../http/API.md)               |
| `ResponseResult`              | [http contracts](../http/API.md)               |
| `RequestParsingOptions`       | [http contracts](../http/API.md)               |
| `RoutePlan`                   | [Source](http/types.ts)                        |
| `ResourceCollection`          | [resource contracts](../resource/API.md)       |
| `ResourceDefinition`          | [resource contracts](../resource/API.md)       |
| `ResourceDocument`            | [resource contracts](../resource/API.md)       |
| `ResourceImplementationAny`   | [resource contracts](../resource/API.md)       |
| `ResourceImplementationSet`   | [resource contracts](../resource/API.md)       |
| `ResourceResolver`            | [resource contracts](../resource/API.md)       |
| `WorkflowDefinition`          | [workflow contracts](../workflow/API.md)       |
| `RequirementContext`          | [requirement contracts](../requirement/API.md) |
| `RequirementDefinition`       | [requirement contracts](../requirement/API.md) |
| `RequirementDocument`         | [requirement contracts](../requirement/API.md) |
| `RequirementInput`            | [requirement contracts](../requirement/API.md) |
| `RequirementRuntime`          | [requirement contracts](../requirement/API.md) |

### service-types: CompiledService

[Declaration source](service/types.ts#L362)

```text
interface CompiledService<Definition extends ServiceDefinition = ServiceDefinition, Host extends object = EmptyEndpointHost>
  Compiled service ready for runtime creation and artifact generation.

  readonly kind: "compiled-service"
    Stable discriminant for this compiled service value.
  readonly definition: Definition
    Exact import-safe definition bound to this compiled service.
  readonly implementation: ServiceImplementation<Definition, Host>
    Exact live behavior set bound to this compiled service.
  readonly operations: readonly EffectiveServiceOperation[]
    Keyed child operations coordinated by this compiled service.
  readonly routePlan: RoutePlan
    Prepared handler-free route metadata bound to the corresponding runtime handlers.
  readonly manifest: ServiceManifest
    Deterministic data projection for inspection, deployment and drift checks.
```

### service-types: CreateServiceOptions

[Declaration source](service/types.ts#L530)

```text
interface CreateServiceOptions<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues>
  Options used to create a live framework-neutral service runtime.

  readonly environment?: Readonly<Record<string, unknown>>
    Declared environment contract or explicit host inputs; importing it does not read ambient values.
  readonly host: Host
    Application-owned host values supplied by the composition root.
  readonly adapters?: ServiceRuntimeAdapters<Host, Values>
    Host-supplied authentication, requirement or transport capabilities; no provider is chosen implicitly.
  readonly requirementContext?: (ctx: ServiceExecutionContext, state: ServiceRequestState<Host, Values>, reachable: readonly RequirementDefinition[]) => ServiceExecutionContext
    Add domain-specific runtime views after validation and active admission requirements.
  readonly requestParsing?: RequestParsingOptions
    Bounded wire parsing policy and limit overrides for this runtime.
  readonly observers?: readonly ServiceObserverHandler[]
    Exact observer handlers required by observer definitions imported by this service.
  readonly requestId?: (request: Request) => string
    Stable request identity carried by this create service.
  readonly traceId?: (request: Request) => string | undefined
    Stable trace identity carried by this create service.
```

### service-types: EffectiveServiceOperation

[Declaration source](service/types.ts#L264)

```text
interface EffectiveServiceOperation extends ServiceRoute
  Fully resolved static contract for one operation.

  readonly middleware: MiddlewarePlan
    Declared middleware contributions or their compiled placement plan.
  readonly authentication: readonly CatalogEntryIdentity[]
    Authentication contracts required by the selected operation; the host supplies their evaluator.
  readonly requirements: readonly RequirementDefinition[]
    Requirements active for every execution of this operation.
  readonly reachableRequirements: readonly RequirementDefinition[]
    Requirements reachable through declared resources and other selected definitions.
  readonly effects: readonly EffectDefinition[]
    Required one-way consequences code in this operation may announce.
  readonly resources: readonly ResourceDefinition[]
    Resource definitions or collection available to this effective service operation.
  readonly problems: readonly ProblemDefinition[]
    Declared HTTP problem contracts or their projected IDs.
  readonly responses: readonly ResponseDefinition[]
    Declared successful response contracts or their projected IDs.
  readonly resiliency: readonly ResiliencePolicy[]
    Declared resilience policies; each policy retains a designated runtime owner.
  readonly execution: ServiceExecutionPlan
    Prepared request validation and policy work for this operation.
  readonly handler: AnyEndpointHandlerBinding
    Exact endpoint handler selected during compilation.
```

### service-types: ServiceContextStore

[Declaration source](service/types.ts#L517)

```text
interface ServiceContextStore
  Direct-identity context store used by middleware and runtime adapters.

  has(definition: Definition): boolean
    Test whether this exact context definition has a stored request value.
  get(definition: Definition): MiddlewareContextValue<Definition>
    Get one addressable value under this service context store contract.
  set(definition: Definition, value: MiddlewareContextValue<Definition>): void
    Store a value under the exact context definition so later declared middleware can retrieve it.
```

### service-types: ServiceContributions

[Declaration source](service/types.ts#L48)

```text
interface ServiceContributions
  Static cross-cutting values contributed by a service or service policy.

  readonly middleware?: MiddlewareInput
    Declared middleware contributions or their compiled placement plan.
  readonly authentication?: DefinitionInput<CatalogEntryIdentity>
    Authentication contracts required by the selected operation; the host supplies their evaluator.
  readonly requirements?: RequirementInput
    Requirements owned directly by this service contributions; reachable dependency requirements remain separate.
  readonly effects?: EffectDefinitions
    One-way consequences code in this service scope may announce.
  readonly resources?: DefinitionInput<ResourceDefinition>
    Resource definitions or collection available to this service contributions.
  readonly problems?: DefinitionInput<ProblemDefinition>
    Declared HTTP problem contracts or their projected IDs.
  readonly resiliency?: ResilienceInput
    Declared resilience policies; each policy retains a designated runtime owner.
```

### service-types: ServiceDefinition

[Declaration source](service/types.ts#L136)

```text
interface ServiceDefinition<Id extends string = string, Path extends string = string> extends CatalogEntryIdentity, ServiceContributions
  Import-safe service definition.

  readonly kind: "service"
    Stable discriminant for this service value.
  readonly id: Id
    Stable service identity used for correlation, lookup, or durable records.
  readonly path: Path
    Deterministic or canonical path associated with this service.
  readonly environment?: EnvironmentDefinition
    Declared environment contract or explicit host inputs; importing it does not read ambient values.
  readonly endpoints: readonly EndpointEntry[]
    Exact endpoint composition or selected bindings retained by this contract.
  readonly workflows: readonly WorkflowDefinition[]
    Workflow declarations, or their IDs in manifests, contributed by this service.
  readonly policies: readonly ServicePolicy[]
    Additive policies that apply to exact declarations in this composition.
  readonly observers: readonly ServiceObserverDefinition[]
    Observer declarations or exact host-supplied handlers; observers remain outside result authority.
```

### service-types: ServiceExecutionInput

[Declaration source](service/types.ts#L237)

```text
interface ServiceExecutionInput
  One request input selected during service compilation.

  readonly source: EndpointInputSource
    Request location from which this compiled validation step reads wire values.
  readonly slot: EndpointInputSlot
    Schema or input declaration compiled for this particular request source.
```

### service-types: ServiceExecutionPlan

[Declaration source](service/types.ts#L250)

```text
interface ServiceExecutionPlan
  Request-time work selected once during service compilation.

  This plan removes repeated discovery from the hot path. It never suppresses
  declared validation, authentication, requirements, middleware, or resilience.

  readonly inputs: readonly ServiceExecutionInput[]
    Declared request input slots or their compiled validation steps.
  readonly bodyLimit?: number
    Maximum request-body bytes admitted by this runtime policy.
  readonly timeout?: Temporal.Duration
    Request timeout retained as a duration, or serialized duration text in a manifest.
  readonly admission: readonly ResiliencePolicy[]
    Prepared resilience policies applied at the request admission stage.
  readonly operation: readonly ResiliencePolicy[]
    Resilience policies applied around the selected endpoint operation.
```

### service-types: ServiceImplementation

[Declaration source](service/types.ts#L188)

```text
interface ServiceImplementation<Definition extends ServiceDefinition = ServiceDefinition, Host extends object = EmptyEndpointHost>
  Runtime implementation supplied separately from a service definition.

  readonly kind: "service-implementation"
    Stable discriminant for this service implementation value.
  readonly definition: Definition
    Exact import-safe definition bound to this service implementation.
  readonly endpoints: readonly AnyEndpointHandlerBinding[]
    Exact endpoint handler bindings supplied for this service.
  readonly middleware: readonly MiddlewareHandler[]
    Exact middleware handler bindings supplied for this service.
  readonly resources: ResourceImplementationSet
    Resource definitions or collection available to this service implementation.
  readonly hostType?: Host
    Compile-time host inference slot; it is not a runtime provider instance.
```

### service-types: ServiceImplementationInput

[Declaration source](service/types.ts#L207)

```text
interface ServiceImplementationInput<Host extends object = EmptyEndpointHost>
  Input accepted by `service.implement()`.

  readonly endpoints?: readonly (AnyEndpointHandlerBinding | readonly AnyEndpointHandlerBinding[])[]
    Exact endpoint handler bindings supplied for this service.
  readonly middleware?: readonly MiddlewareHandler[]
    Exact middleware handler bindings supplied for this service.
  readonly resources?: ResourceImplementationSet
    Resource definitions or collection available to this service implementation.
  readonly hostType?: Host
    Compile-time host inference slot; it is not a runtime provider instance.
```

### service-types: ServiceManifest

[Declaration source](service/types.ts#L326)

```text
interface ServiceManifest
  Deterministic compiled service manifest.

  readonly id: string
    Stable service manifest identity used for correlation, lookup, or durable records.
  readonly path: string
    Deterministic or canonical path associated with this service manifest.
  readonly description?: string
    Human-readable service manifest purpose used by documentation and diagnostics.
  readonly routes: readonly ServiceRouteManifestEntry[]
    Authored or compiled route entries retained by this application or manifest.
  readonly environment?: EnvironmentManifest
    Declared environment contract or explicit host inputs; importing it does not read ambient values.
  readonly resources: readonly string[]
    Resource definitions or collection available to this service manifest.
  readonly resourceGraph: readonly ResourceDocument[]
    Inspectable resource dependency graph; it contains no acquired resource values.
  readonly requirements: readonly RequirementDocument[]
    Requirements owned directly by this service manifest; reachable dependency requirements remain separate.
  readonly reachableRequirements: readonly RequirementDocument[]
    Complete requirements reachable anywhere in this compiled service.
  readonly effects: readonly string[]
    Distinct effect IDs reachable from compiled service operations.
  readonly problems: readonly string[]
    Declared HTTP problem contracts or their projected IDs.
  readonly responses: readonly string[]
    Declared successful response contracts or their projected IDs.
  readonly middleware: readonly string[]
    Declared middleware contributions or their compiled placement plan.
  readonly resiliency: readonly string[]
    Distinct resilience policy kinds used anywhere in this service.
  readonly workflows: readonly string[]
    Workflow declarations, or their IDs in manifests, contributed by this service.
  readonly observers: readonly string[]
    Observer declarations or exact host-supplied handlers; observers remain outside result authority.
```

### service-types: ServiceObserverDefinition

[Declaration source](service/types.ts#L86)

```text
interface ServiceObserverDefinition extends CatalogEntryIdentity
  Import-safe subscription to selected service request lifecycle events.

  readonly kind: "service-observer"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly description: string
    Purpose and behavior of this contract, supplied by its author.
  readonly events: readonly ServiceObserverEventKind[]
    Service lifecycle event kinds selected for observation; receiving headers and completing a body are separate events.
```

### service-types: ServiceObserverEvent

[Declaration source](service/types.ts#L96)

```text
interface ServiceObserverEvent
  Credential-free service request metadata emitted by the framework-neutral runtime. Error text still requires host redaction before external export.

  readonly kind: ServiceObserverEventKind
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly serviceId: string
    Identity of the service selected for this route or observation.
  readonly requestId?: string
    Request correlation identity; it is diagnostic data rather than authorization.
  readonly traceId?: string
    Trace correlation identity retained for diagnostic propagation.
  readonly spanId?: string
    Span correlation identity for the current operation.
  readonly method: string
    HTTP method selected for this operation or route.
  readonly path: string
    Declared route pathname or prefix; path parameters retain the endpoint grammar.
  readonly endpointId: string
    Identity of the selected endpoint path contract.
  readonly operationId: string
    Stable operation identity used by generated clients, routing and diagnostics.
  readonly status?: number
    HTTP status selected by this response or reported by this lifecycle observation.
  readonly responseBytes?: number
    Observed response-body bytes; response headers alone do not prove body completion.
  readonly completion?: Readonly<{ readonly outcome: "completed" | "cancelled" | "errored"; readonly bytes: number; }>
    Response-body terminal outcome and delivered byte count, distinct from receiving headers.
  readonly error?: Readonly<{ readonly name: string; readonly message: string; }>
    Diagnostic failure retained for this observation; it does not replace the authoritative operation result.
```

### service-types: ServiceObserverHandler

[Declaration source](service/types.ts#L126)

```text
interface ServiceObserverHandler<Definition extends ServiceObserverDefinition = ServiceObserverDefinition>
  Runtime handler bound to one exact import-safe service observer definition.

  readonly kind: "service-observer-handler"
    Discriminant used to recognize this contract without inspecting its other fields.
  readonly definition: Definition
    Exact declaration involved in this binding, result or validation issue.
  readonly handle: (event: ServiceObserverEvent) => void | Promise<void>
    Observe a redacted service lifecycle event; this callback cannot settle the request.
```

### service-types: ServicePolicy

[Declaration source](service/types.ts#L66)

```text
interface ServicePolicy extends CatalogEntryIdentity, ServiceContributions
  Additive selector-based overlay for a subset of imported endpoints.

  readonly kind: "service-policy"
    Stable discriminant for this service policy value.
  readonly endpoints: readonly EndpointEntry[]
    Exact endpoint composition or selected bindings retained by this contract.
```

### service-types: ServiceResilienceAdapter

[Declaration source](service/types.ts#L484)

```text
interface ServiceResilienceAdapter<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues>
  Runtime adapter for resilience policies not implemented by the generic server.

  The server owns timeout and body-limit behavior. Idempotency, rate limiting,
  bulkheads, retries, and circuit breakers require an explicit runtime adapter.

  supports(policy: ResiliencePolicy): boolean
    Return whether this adapter implements the exact declared resilience policy.
  run(policies: readonly ResiliencePolicy[], state: ServiceRequestState<Host, Values>, next: () => Promise<ServiceStageResult>): Promise<ServiceStageResult>
    Run the adapter-owned policies for one lifecycle stage.
```

### service-types: ServiceRoute

[Declaration source](service/types.ts#L219)

```text
interface ServiceRoute
  One service route with full import provenance.

  readonly id: string
    Stable service route identity used for correlation, lookup, or durable records.
  readonly service: ServiceDefinition
    Exact service contract retained by this binding or selection.
  readonly endpoint: EndpointDefinition
    Exact endpoint path contract to which this binding belongs.
  readonly operation: EndpointOperation
    Child operation coordinated by this service route.
  readonly groups: readonly EndpointGroup[]
    Enclosing endpoint groups retained in route order.
  readonly method: EndpointMethod
    HTTP method selected for this operation or route.
  readonly path: string
    Deterministic or canonical path associated with this service route.
```

### service-types: ServiceRouteManifestEntry

[Declaration source](service/types.ts#L290)

```text
interface ServiceRouteManifestEntry
  JSON-safe route manifest used by gateways, tests, and deployments.

  readonly id: string
    Stable service route manifest identity used for correlation, lookup, or durable records.
  readonly method: Uppercase<EndpointMethod>
    HTTP method selected for this operation or route.
  readonly path: string
    Deterministic or canonical path associated with this service route manifest.
  readonly operationId: string
    Stable operation identity carried by this service route manifest.
  readonly endpointId: string
    Stable endpoint identity carried by this service route manifest.
  readonly authentication: readonly string[]
    Authentication contracts required by the selected operation; the host supplies their evaluator.
  readonly requirements: readonly RequirementDocument[]
    Requirements owned directly by this service route manifest; reachable dependency requirements remain separate.
  readonly reachableRequirements: readonly RequirementDocument[]
    Requirements that can become active through this compiled route and its dependencies.
  readonly effects: readonly string[]
    Effect IDs code in this compiled route may announce.
  readonly resources: readonly string[]
    Resource definitions or collection available to this service route manifest.
  readonly problems: readonly string[]
    Declared HTTP problem contracts or their projected IDs.
  readonly responses: readonly string[]
    Declared successful response contracts or their projected IDs.
  readonly middleware: Readonly<Record<string, readonly string[]>>
    Declared middleware contributions or their compiled placement plan.
  readonly resiliency: readonly ResilienceDocument[]
    Effective resilience policies with their runtime owner and lifecycle stage.
  readonly execution: Readonly<{ readonly inputs: readonly EndpointInputSource[]; readonly bodyLimit?: number; readonly timeout?: string; }>
    JSON-safe prepared input locations and body/time limits for this route.
```

### service-types: ServiceRuntime

[Declaration source](service/types.ts#L573)

```text
interface ServiceRuntime extends AsyncDisposable
  Live service runtime owned by one transport host.

  The runtime owns service resources and request contexts, not the network
  listener. Hosts expose `fetch` through Deno, Node, an edge adapter, or
  another HTTP transport and dispose this runtime when that host shuts down.

  readonly routes: readonly ServiceRuntimeRoute[]
    Exact compiled routes in canonical adapter-registration order.
  readonly fetch: (request: Request) => Response | Promise<Response>
    Framework-neutral Fetch entry point for the compiled service.
  readonly resources: ResourceCollection
    Resource definitions or collection available to this service.
```

### service-types: ServiceRuntimeAdapters

[Declaration source](service/types.ts#L499)

```text
interface ServiceRuntimeAdapters<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues>
  Runtime adapters supplied by the application composition root.

  readonly authenticate?: (requirements: readonly CatalogEntryIdentity[], state: ServiceRequestState<Host, Values>) => Promise<ServiceRequestStatePatch<Values> | ProblemResult | void>
    Host-owned evaluation of the declared authentication contracts before forwarding or operation admission.
  readonly requirements?: RequirementRuntime
    Active requirement interpreters. Unknown families reject unless this runtime explicitly selects `ignore`.
  readonly effect?: EffectEmitter
    Optional emitter used only when runtime code announces a declared effect.
  readonly resilience?: ServiceResilienceAdapter<Host, Values>
    Adapter for resilience policies that the generic server cannot execute itself.
```

### service-types: ServiceRuntimeRoute

[Declaration source](service/types.ts#L557)

```text
interface ServiceRuntimeRoute
  Route exposed by one live compiled service runtime.

  readonly method: string
    HTTP method registered for this exact compiled operation.
  readonly path: string
    Canonical route template registered for this exact compiled operation.
  readonly handler: (request: Request) => Response | Promise<Response>
    Execute this exact operation without asking another router to resolve it again.
```

### service-types: ServiceSelection

[Declaration source](service/types.ts#L176)

```text
interface ServiceSelection<Service extends ServiceDefinition = ServiceDefinition> extends CatalogEntryIdentity
  Exact named subset of a service's imported endpoint graph.

  readonly kind: "service-selection"
    Stable discriminant for this service selection value.
  readonly service: Service
    Original exact service declaration from which the endpoint selection was made.
  readonly endpoints: readonly EndpointDefinition[]
    Exact endpoint composition or selected bindings retained by this contract.
```

### service-types: ServiceValidationIssue

[Declaration source](service/types.ts#L390)

```text
interface ServiceValidationIssue
  One compiler validation issue.

  readonly code: "invalid-definition" | "invalid-endpoint" | "policy-target-outside-service" | "route-conflict" | "operation-id-conflict" | "missing-endpoint-handler" | "extraneous-endpoint-handler" | "missing-middleware-handler" | "extraneous-middleware-handler" | "missing-resource-implementation" | "resource-conflict" | "invalid-resiliency" | "missing-environment" | "environment-conflict"
    Stable failure code; callers should branch on this instead of matching explanation text.
  readonly message: string
    Human-readable diagnostic explanation; it is not a stable program discriminator.
  readonly definition?: ServiceValidationSubject
    Exact import-safe definition bound to this service validation issue.
```

### service-types: ServiceDefinitionInput

[Declaration source](service/types.ts#L159)

```text
type ServiceDefinitionInput<Id extends string = string, Path extends string = string> = Readonly<{ readonly id: Id; readonly path: Path; readonly description?: string; readonly environment?: EnvironmentDefinition; readonly endpoints: EndpointCompositionInput; readonly workflows?: DefinitionInput<WorkflowDefinition>; readonly policies?: readonly ServicePolicy[]; readonly observers?: readonly ServiceObserverDefinition[]; }> & ServiceContributions
  Input accepted by `service.define()`.
```

### service-types: ServiceExecutionContext

[Declaration source](service/types.ts#L427)

```text
type ServiceExecutionContext = RequirementContext<EffectContext<Context>>
  Execution context used by service handlers after effect and requirement scopes are attached.
```

### service-types: ServiceInputValues

[Declaration source](service/types.ts#L430)

```text
type ServiceInputValues = EndpointRuntimeInputValues
  Validated values grouped by HTTP request location.
```

### service-types: ServiceObserverEventKind

[Declaration source](service/types.ts#L83)

```text
type ServiceObserverEventKind = "started" | "response" | "completed" | "failed" | "aborted"
  Service lifecycle events available to observational handlers.
```

### service-types: ServicePolicyInput

[Declaration source](service/types.ts#L74)

```text
type ServicePolicyInput = Readonly<{ readonly id: string; readonly description?: string; readonly endpoints: EndpointCompositionInput; }> & ServiceContributions
  Input accepted by `service.policy()`.
```

[Declaration source](service/types.ts#L439)

```text
private type ServiceRequestCore<Host extends object> = Readonly<{ readonly request: Request; readonly host: Host; readonly ctx: ServiceExecutionContext; readonly input: ServiceInputValues; readonly resources: ResourceResolver; readonly values: ServiceContextStore; readonly operation: EffectiveServiceOperation; }>
  Fixed request state plus provider-neutral values contributed by runtime adapters.

  Request values remain partial while ordered adapters add them. Adapters cannot
  replace framework-owned fields such as the Request, host, inputs, resources,
  execution context, or compiled operation.
```

### service-types: ServiceRequestState

[Declaration source](service/types.ts#L468)

```text
type ServiceRequestState<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues> = Readonly<ServiceRequestCore<Host> & Omit<ServiceValuePatch<Values>, keyof ServiceRequestCore<Host>>>
  Immutable request state that prevents adapter patches from replacing framework-owned fields.
```

### service-types: ServiceRequestStatePatch

[Declaration source](service/types.ts#L474)

```text
type ServiceRequestStatePatch<Values extends ServiceRequestValues = ServiceRequestValues> = ServiceValuePatch<Values>
  Request-value patch returned by a runtime adapter after successful evaluation.
```

### service-types: ServiceRequestValues

[Declaration source](service/types.ts#L424)

```text
type ServiceRequestValues = EndpointRequestValues
  Empty base contract for application-owned values added during one service request.

  Applications extend this type with exact provider-neutral fields. The generic
  server reserves no authentication, actor, organization, or policy-state keys.
```

### service-types: ServiceStageResult

[Declaration source](service/types.ts#L583)

```text
type ServiceStageResult = ResponseResult | ProblemResult | Response | void
  Result returned by a middleware or runtime-adapter stage.
```

### service-types: ServiceValidationResult

[Declaration source](service/types.ts#L414)

```text
type ServiceValidationResult = Readonly<{ readonly valid: true; readonly routes: readonly ServiceRoute[]; }> | Readonly<{ readonly valid: false; readonly issues: readonly ServiceValidationIssue[]; }>
  Validation result for a definition or implementation.
```

### service-types: ServiceValidationSubject

[Declaration source](service/types.ts#L381)

```text
type ServiceValidationSubject = CatalogEntryIdentity | ServiceRoute | AnyEndpointHandlerBinding | MiddlewareHandler | ResourceImplementationAny | ResiliencePolicy
  Definition or implementation value that may be attached to a compiler issue.
```

### service-types: ServiceValuePatch

[Declaration source](service/types.ts#L461)

```text
type ServiceValuePatch<Values extends ServiceRequestValues = ServiceRequestValues> = Readonly<readonly [Key in keyof Values]?: Exclude<Values[Key], undefined>>
  Fixed request state plus provider-neutral values contributed by runtime adapters.

  Request values remain partial while ordered adapters add them. Adapters cannot
  replace framework-owned fields such as the Request, host, inputs, resources,
  execution context, or compiled operation.
```
