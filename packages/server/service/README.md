# `@okikio/server/service`

Imagine declaring that `POST /notes` takes a title, but forgetting to connect the function that saves it. The
description alone cannot answer a request. A service joins the route description, the function that answers it, and
the live resources the function needs. The service compiler checks those links before you send the first request.

```text
Endpoint + response descriptions -> service.define
Exact handler + resource bindings -> service.implement -> compile
                                                       -> create runtime
Request -> parse and validate -> declared handler -> validate result -> Response
Runtime disposal -> finish owned resource cleanup
```

Definitions describe behavior; implementations supply code and resource factories. `compile()` links them into a checked
plan before requests arrive. `create()` supplies the live host and starts the service's runtime ownership, without
opening a listener. An injected host is borrowed; the service owns the resources its runtime constructs.

## Save a note and reject an invalid title

The service owns its request lifetimes and resource cleanup. The imported utilities supply their time and disposal
implementations locally; the application does not need to install global polyfills.

After the [checkout setup](../../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '@okikio/server/service';
import * as schema from '@okikio/schema';

const Saved = response.ok(schema.object({ title: schema.string() }), {
	id: 'note.saved',
	description: 'Saved note title.',
});
const Save = endpoint.post({
	id: 'note.save',
	path: '/notes',
	json: schema.object({ title: schema.string({ minLength: 1 }) }),
	responses: [Saved],
});
const Api = service.define({ id: 'notes', path: '/', endpoints: [Save] });
// This demo storage belongs to the process. The service contract does not make it durable.
const notes: string[] = [];
const implementation = service.implement(Api, {
	endpoints: [endpoint.handler(Save, ({ input }) => {
		// Transport validation checked the schema; trimming here is the application's normalization rule.
		const title = input.json.title.trim();
		notes.push(title);
		return response.create(Saved, { title });
	})],
});
await using runtime = service.create(service.compile(implementation), { host: {} });
for (const title of [' First note ', 42]) {
	const outgoing = await runtime.fetch(
		new Request('https://service.invalid/notes', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title }),
		}),
	);
	const body = await outgoing.json();
	console.log(outgoing.status, body.title);
}
console.log(notes.length);
```

Expected output:

```text output
200 First note
400 Invalid request
1
```

The first request saves a trimmed title in the local array and returns its checked JSON representation. The numeric
title receives `400 Invalid request` before the handler runs, so only one note is stored. `input.json.title` is inferred
as a string; the handler needs no assertion or cast. The response schema also checks the success body.

The local array makes the example reproducible and is not persistent storage: its notes disappear when the process ends.
A deployed application supplies its chosen storage as a declared resource. `await using` disposes this runtime when the
scope ends; no listener or network connection is opened.

The four setup calls serve different lifetimes. Keep `Saved`, `Save` and `Api` with the reusable API description;
bind the saving callback with `implement()` in the application. `compile()` checks those bindings once before traffic,
and `create()` owns the live runtime. Compilation produces ordinary JavaScript data, not another executable file.

`host: {}` means this example borrows no application clients. It is not a request context, a hostname or a listener.
When factories need an application-owned client, pass it through the typed host and keep its shutdown with its owner.
Omit `resources` and `middleware` when neither is needed; `implement()` already supplies empty collections.
For a single native `Request -> Response` function, [HTTP](../http/README.md) avoids these declaration stages entirely.

## Choose adjacent capabilities

Use Service to compile endpoint bindings, resources, requirements, and request lanes before traffic begins. Gateway
forwards that service elsewhere; Runtime supplies host capabilities. The application still owns listener startup and
shutdown.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

Continue in the [numbered guide](https://github.com/okikio/utils/blob/main/docs/server/08-service.md) for composition,
ownership, and failure behavior.
