`@okikio/server/endpoint`
========================

Import-safe HTTP endpoint contracts, method operations, endpoint groups, direct
runtime handler bindings, validation, documentation, and OpenAPI projection.

The package describes HTTP behavior without creating a server or importing Hono.
Server compilation combines these values with middleware, resources, policies,
and host runtime implementations.

Authoring model
---------------

Use a method helper for the common single-operation case:

~~~~ts
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';

export const ListWidgets = endpoint.get({
  id: 'widgets.list',
  path: '/widgets',
  query: ListWidgetsQuery,
  responses: [response.ok(WidgetList, {
    id: 'widgets:list',
    description: 'Visible widgets.',
  })],
});
~~~~

Use path-independent operations plus `endpoint.define()` when several methods
share one path contract:

~~~~ts
export const GetWidget = endpoint.operation.get({
  id: 'widgets.get',
  responses: [WidgetDetail],
  problems: [WidgetNotFound],
});

export const UpdateWidget = endpoint.operation.patch({
  id: 'widgets.update',
  json: UpdateWidgetInput,
  responses: [WidgetDetail],
});

export const WidgetById = endpoint.define({
  id: 'widgets.by-id',
  path: '/:widgetId',
  param: WidgetPath,
  operations: [GetWidget, UpdateWidget],
});
~~~~

Request locations accept Standard Schema values directly: `param`, `query`,
`header`, `cookie`, `json`, `form`, and `raw`. `raw` is mutually exclusive with
parsed body contracts.


Schema projection for OpenAPI
-----------------------------

Endpoint validation depends only on Standard Schema. OpenAPI uses Standard JSON
Schema when the validator exposes it through `schema["~standard"].jsonSchema`.
Request documentation calls `input()`; response documentation calls `output()`.
This distinction is required for coercions and transforms.

~~~~ts
const document = await endpoint.openapi(ApiEndpoints, {
  title: 'Example API',
  version: '1.0.0',
});
~~~~

A documented endpoint input can provide `jsonSchema` when the HTTP wire shape is
more precise than the executable validator. Query definitions can expose their
transport syntax through `wireSchema()`. Response definitions have the matching
serialized-body override.

A composition root can still provide `schemaProjector` for a validator that does
not expose Standard JSON Schema. The default mode uses it as a fallback. Set
`schemaProjectorMode: 'override'` only when the application deliberately wants
its projector to supersede the validator's Standard JSON Schema projection.

Public schemas that cannot be represented fail OpenAPI generation instead of
silently becoming `{}`. Internal-only operations may remain opaque.

OpenAPI path parameters are projected as `in: "path"`; `param` remains only the
internal endpoint input-slot name.

`endpoint.input(...)` can also carry request parsing policy for that exact input
slot. For example, a query schema can opt into `bareQueryParameters: 'flag'`
without changing bare-query meaning for unrelated endpoints. Endpoint parsing
policy overrides the service host's generic parsing defaults. Hard runtime
policies such as a compiled body-size limit still win.

Runtime bindings
----------------

Handlers bind to exact imported definitions rather than IDs or registry keys:

~~~~ts
export const WidgetByIdHandlers = endpoint.handler(WidgetById, {
  get: async (context) => WidgetDetailResult,
  patch: async (context) => UpdatedWidgetResult,
});
~~~~

The binding retains the exact endpoint and operation objects. Service
compilation verifies exhaustive handler coverage and declared result envelopes.

Declaring side effects
----------------------

Use `effects` when code in an endpoint scope may announce an externally visible
side effect through `@okikio/effect`. The declaration says the effect is allowed
in that execution; it does not mean every request emits it.

~~~~ typescript
const EnrichCompany = endpoint.post({
  id: 'companies.enrich',
  path: '/companies/:companyId/enrich',
  effects: [UsageCommitted],
  responses: [Accepted],
});
~~~~

Groups and endpoint paths can contribute the same effect declarations. Service
compilation combines those definitions with service, service-policy, operation,
and middleware contributions. The live service runtime may supply an effect owner.

Composition and artifacts
-------------------------

- `endpoint.group()` creates a reusable path-prefixed endpoint collection.
- `endpoint.select()` creates a named key-preserving subset.
- `endpoint.compose()` flattens nested definitions, groups, catalogs, and
  selections while retaining direct identities.
- `endpoint.validate()` checks methods, paths, inputs, IDs, and result envelopes.
- `endpoint.document()` creates deterministic JSON-safe documentation.
- `endpoint.openapi()` projects an endpoint-only OpenAPI document. A service
  should normally generate OpenAPI from the compiler-resolved service graph so
  inherited policies and generated failures are included.

Definitions snapshot nested author-supplied arrays. Mutating the source arrays
after construction cannot alter the imported application graph.


Wire input and validated input
------------------------------

Standard Schema can intentionally have different input and output types.
`InferEndpointWireInputs` describes what exists on the transport side before
schema transforms; `InferEndpointInputs` describes the validated values exposed
to handlers. OpenAPI/request documentation is projected from the declared input
contract independently of whether an earlier middleware needs exact raw bytes.
This prevents raw-body authentication from erasing API documentation.
