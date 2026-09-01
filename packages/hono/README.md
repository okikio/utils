`@okikio/hono`
====================

Purpose
-------

This package adapts framework-neutral HTTP and service runtimes to Hono. The
service compiler and `service.create()` do not require Hono. Import this package
only when a host wants Hono routing, Hono-native middleware, or Hono context
features.

Start here
----------

Wrap an ordinary Hono application with generic Fetch middleware:

```ts
import { Hono } from 'hono';
import * as hono from '@okikio/hono';
import * as http from '@okikio/server/http';

const app = new Hono();
app.get('/health', (ctx) => ctx.json({ status: 'ok' }));
app.onError(hono.catchErrors());

const handler = hono.fetch(app, [http.securityHeaders()]);
const response = await handler(new Request('https://service.invalid/health'));
```

Mount a compiled service runtime
--------------------------------

```ts
import { Hono } from 'hono';
import * as http from '@okikio/server/http';
import * as hono from '@okikio/hono';

const app = new Hono();
hono.mount(app, serviceRuntime);
app.get('/health', (ctx) => ctx.json({ status: 'ok' }));
app.onError(hono.catchErrors());

export default {
	fetch: hono.fetch(app, [
		http.securityHeaders(),
		http.cors(),
	]),
};
```

`hono.mount()` registers `ServiceRuntime.routes` in the canonical order produced by the service
runtime. This matters because Hono resolves matching handlers in registration order, while the
framework-neutral runtime explicitly prefers more specific static routes and explicit `HEAD` routes.

Hono-specific middleware remains valid. The generic HTTP middleware is useful
when the same behavior must also work with `Deno.serve`, Node fetch adapters,
workers, tests, or another framework.


Framework ownership
-------------------

Keep endpoint definitions, validation, resources, and business behavior in the
framework-neutral server packages. Use Hono for the host features that are
actually Hono-specific, such as its router, context helpers, or native
middleware.

```ts
const app = new Hono();
hono.mount(app, serviceRuntime);

app.use('/admin/*', honoNativeAdminMiddleware);
app.onError(hono.catchErrors({ expose: false }));

export default { fetch: hono.fetch(app, genericHttpMiddleware) };
```

This direction matters for tests and alternate runtimes: the same
`serviceRuntime` can still be called directly as a Fetch handler without Hono.


Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `hono.mount()` | translate one service runtime into Hono routes and adapt request/response/context behavior manually | reuse service contracts without making Hono the contract owner |
| `hono.fetch()` | compose middleware around Hono fetch handling and preserve Web `Request`/`Response` semantics yourself | one Web-standard handler boundary |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/hono` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics by registering each Fetch handler on Hono and translating thrown server failures by hand.

The adapter mounts the framework-neutral server runtime without moving service semantics into Hono.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
