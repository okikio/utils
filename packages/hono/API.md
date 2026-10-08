# @okikio/hono contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import         | Source               | Reference     |
| -------------- | -------------------- | ------------- |
| `@okikio/hono` | [./mod.ts](./mod.ts) | [root](#root) |

## root

Import `@okikio/hono`. [Source](./mod.ts).

Reuse framework-neutral HTTP middleware around a Hono application. Reimplementing request correlation and response
headers inside each framework makes the host contracts drift.

Start with the adapter around an existing Hono app, then share middleware with a portable service or gateway. Hono still
owns its route handlers; the utility adapter owns the surrounding fetch composition. Host code starts the network
listener and configures logging. Read or cancel response bodies so tests and callers release stream ownership.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source                                    |
| ---------------- | ----------------------------------------------------------- |
| `HonoContext`    | External declaration: `hono/dist/types/index.d.ts`          |
| `Hono`           | External declaration: `hono/dist/types/index.d.ts`          |
| `HTTPException`  | External declaration: `hono/dist/types/http-exception.d.ts` |
| `http`           | [server contracts](../server/API.md)                        |
| `service`        | [server contracts](../server/API.md)                        |

### root: catchErrors

[Declaration source](mod.ts#L41)

```text
function catchErrors(options: http.ErrorOptions): (error: Error, ctx: HonoContext) => Promise<Response>
  Create a Hono `onError` callback backed by the generic safe error materializer.
```

### root: fetch

[Declaration source](mod.ts#L36)

```text
function fetch(app: Hono, middleware: readonly http.Middleware[]): http.Handler
  Wrap one Hono application with framework-neutral Fetch middleware.
```

### root: mount

[Declaration source](mod.ts#L28)

```text
function mount(app: Hono, runtime: service.ServiceRuntime): Hono
  Register every compiled service route on one caller-owned Hono application.
```
