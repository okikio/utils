# Run a bounded activity through authenticated HTTP

Suppose one service needs another to measure a string's length. The caller sends the string and receives a
checked result without running the counting function itself. Use `@okikio/activity/http` to connect the caller to an
existing service that exposes short jobs through a dedicated HTTP route.

The client fits the same job-running interface as the local, Worker and process adapters. On the server, the route
passes admitted work to a provider you supply. Your application opens the listener and configures credentials.

One attempt uses one request and one response. This pattern is called **unary**. A running job cannot use that
exchange to ask the caller to check a permission, accept an announcement, or renew its temporary right to finish the
job. The receiving application must supply those operations if needed. For renewal, connect `control(attempt)` to
the owner that can actually renew the claim. Without it, a renewal request through `heartbeat()` throws.
Use the optional [duplex HTTP adapter](./http/duplex.md) when reverse calls must reach the original caller over HTTP, or choose a Worker/process adapter when its transport matches the deployment.

## Connect a local provider to a Fetch route

This example creates both sides of the contract. The application mounts `accept` at the dedicated `/activity` route
using its existing Fetch-compatible server. `secret` and `endpoint` come from the application's credential and deployment
configuration. They do not come from an untrusted attempt body. Use Deno's `--env-file` flag or
[`@std/dotenv` parsing](https://jsr.io/@std/dotenv) if the application reads `.env` configuration;
this adapter supplies no configuration parser.

```ts support=service.ts
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as http from '@okikio/activity/http';
import * as local from '@okikio/activity/local';
import * as resource from '@okikio/capability/resource';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';

/** Build one application-owned service; keep it alive until the listener drains. */
export async function open(secret: string, endpoint: URL, allowLoopbackHttp = false) {
	// Both ends use the same identities and schemas; these declarations start no work.
	const Engine = engine.define({ id: 'analysis.http' });
	const Length = activity.define({
		id: 'text.length',
		version: '1',
		input: codec.identity(schema.string()),
		result: codec.identity(schema.number()),
		placement: engine.require(Engine),
	});
	const implementation = activity.implement(Length, {
		/** A short operation needs no remote heartbeat or externally committed effect. */
		async run(ctx) {
			return ctx.input.length;
		},
	});

	// The service owns these resources. The handler only borrows its provider.
	const owner = context.create({ id: 'analysis-service' });
	const resources = resource.create(resource.implementations(), { ctx: owner, host: {} });
	const provider = local.create({ engine: Engine, implementations: [implementation], resources });

	// Authenticate the caller before admitting an activity attempt.
	const accept = http.handler({
		provider,
		activities: [Length],
		maximumBytes: 64 * 1024,
		concurrency: 8,
		// Replace this demo equality check with the application's token verifier.
		authenticate: (request) => request.headers.get('authorization') === `Bearer ${secret}`,
		// This service accepts only this activity from its trusted Scheduler.
		// A multi-tenant host must also verify tenant, registration, generation and claim authority.
		authorize: (_request, attempt) => attempt.engineId === Engine.id && attempt.activityId === Length.id,
	});

	// This client can be registered as an executor's provider for the declared engine.
	const client = http.create({
		engine: Engine,
		activities: [Length],
		url: endpoint,
		maximumBytes: 64 * 1024,
		allowLoopbackHttp,
		headers: () => ({ authorization: `Bearer ${secret}` }),
	});
	return {
		Engine,
		Length,
		accept,
		client,
		/** Drain the application's listener and requests before closing borrowed resources. */
		async [Symbol.asyncDispose]() {
			try {
				await resources[Symbol.asyncDispose]();
			} finally {
				await owner[Symbol.asyncDispose]();
			}
		},
	};
}
```

Register `client` with the workflow Scheduler for `Engine`. Mount `accept` only at the intended route; the handler
checks method and protocol but does not own routing, TLS, server timeouts or listener shutdown. HTTPS is required by
default. `allowLoopbackHttp: true` permits plain HTTP only for `localhost`, `127.0.0.1` or `::1`. Redirects are always
rejected so credentials cannot follow a redirect to another service. The credentials callback runs per attempt so
rotation does not require reconstructing the client.

## Make one complete call over a real socket

The following Deno entry starts a loopback listener, registers the client as an executor's provider, and asks a workflow
to count `hello`. A Scheduler connects the workflow's requested activity to dispatch; an executor takes that request
and calls the HTTP provider. The server then invokes the local implementation above. The checked answer travels back
through the same owners to the workflow. None of those objects starts a remote machine.

Save both named blocks beside each other in the prepared repository and run
`mise exec -- deno run --allow-net call.ts`. This uses Deno's listener API; the adapter itself accepts Web `Request` and
`Response` objects, so a Node or Bun application's Fetch-compatible route can mount the same `accept` handler.
The fixed demo secret and loopback HTTP are local teaching choices. Use HTTPS and an actual credential verifier for a
deployed service.

```ts support=call.ts
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as workflow from '@okikio/workflow';
import * as dispatch from '@okikio/workflow/dispatch';
import { open } from './service.ts';

let service: Awaited<ReturnType<typeof open>> | undefined;
const listener = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, (request) => {
	if (new URL(request.url).pathname !== '/activity') return new Response(null, { status: 404 });
	return service?.accept(request) ?? new Response(null, { status: 503 });
});

try {
	const endpoint = new URL(`http://127.0.0.1:${listener.addr.port}/activity`);
	service = await open('local-demo-secret', endpoint, true);
	const { Engine, Length, client } = service;
	const Count = workflow.define({
		id: 'text.count',
		version: '1',
		input: schema.string(),
		result: schema.number(),
		activities: [Length],
	});
	const count = workflow.implement(Count, function* (ctx) {
		return yield* ctx.trigger(Length, ctx.input);
	});

	// These owners close in reverse order after the awaited call settles.
	await using owner = context.create({ id: 'http-caller' });
	await using jobs = dispatch.memory();
	await using scheduler = workflow.scheduler({ activityDispatch: jobs });
	await using executor = await workflow.executor({
		dispatch: jobs,
		engine: Engine,
		hostId: 'http-service',
		capacity: 1,
		provider: client,
	});
	await using run = await workflow.context({ definition: Count, runId: 'count-1', input: 'hello', ctx: owner });
	console.log('Length:', await workflow.run({ ctx: run, implementation: count, scheduler }));
} finally {
	// Stop accepting requests and join active handlers before closing their borrowed resources.
	await listener.shutdown();
	await service?.[Symbol.asyncDispose]();
}
```

Expected output is `Length: 5`. The dispatch store is in memory: this example proves the HTTP round trip and cleanup
order, not recovery after process loss. Keep the listener's drain before service disposal when mounting the handler in
another server. That order prevents an active request from borrowing a resource that its application has already closed.

## Know what a lost response means

Authentication runs before body parsing and execution admission. Authorization runs after the bounded body passes the
shared activity-envelope schema. It must establish that this caller can dispatch this exact attempt: an identity or a
client-supplied `admitted` flag is not proof of permission. The server's provider and `control` supply the actual resource,
permission and effect owners. The HTTP client cannot forward its own `ActivityAttemptControl` through a unary response.

The default body budget is 1 MiB per direction, at most 16 MiB. JSON encoding reuses the Streams package; the budget
limits accepted output, not the temporary allocation required to serialize a caller-owned object. At most 16 requests
are active by default, including requests still reading their bodies. Excess requests receive 503. The application
must additionally set upload, execution and idle timeouts on its server and bound each Scheduler attempt's lifetime.

A network failure, rejection, malformed result, redirect, or cancellation after dispatch returns `lost`. The remote
activity may already have committed a side effect. The transport never retries, deduplicates claims or guarantees
exactly-once execution. The application must reconcile its durable claim and effect receipts before retrying uncertain
work. Cancellation before sending returns `cancelled`; cancellation after dispatch only stops waiting. Fetch request
signals propagate to the borrowed provider, but host cancellation and cleanup remain cooperative.

The server returns body-free 400 (invalid input), 401 (authentication), 403 (authorization), 404 (unknown activity),
405 (method), 413 (request budget), 415 (protocol/content type), 500 (host error), 503 (admission), or 507 (response budget).
A successful response contains the existing validated activity result protocol. Failure payloads use the activity's
exact declared failure catalog. No credential or server exception body is returned in error responses.

The neighboring `http.test.ts` opens real loopback listeners and tests success through `local.create()`, denial,
malformed/oversized input, concurrent admission, unsupported heartbeat, disconnect cleanup and redirect rejection.
`http.bench.ts` measures authenticated Fetch-handler overhead against a direct provider call at 1 and 32 sequential
attempts. Its untimed oracle runs with `--check`; its timings exclude sockets, TLS and actual activity work.
