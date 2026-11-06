# Run a bounded activity through authenticated HTTP

Use `@okikio/activity/http` when an existing service can accept short activity attempts through a dedicated HTTP route.
The client implements the same engine-provider contract as the local, Worker and process adapters. The server borrows
an existing provider. Neither constructor opens a listener, configures credentials or starts a background loop.

This is a unary request/response adapter. It does not carry reverse permission, effect or heartbeat calls back to the
calling Scheduler. The receiving application must own those services and connect `control(attempt)` to the actual
claim authority when they are needed. Without that connection, heartbeat throws instead of claiming to renew a lease.
Use the optional [duplex HTTP adapter](./http/duplex.md) when reverse calls must reach the original caller over HTTP, or choose a Worker/process adapter when its transport matches the deployment.

## Connect a local provider to a Fetch route

This example creates both sides of the contract. The application mounts `accept` at the dedicated `/activity` route
using its existing Fetch-compatible server. `secret` and `endpoint` come from the application's credential and deployment
configuration. They do not come from an untrusted attempt body. Use Deno's `--env-file` flag or
[`@std/dotenv` parsing](https://jsr.io/@std/dotenv) if the application reads `.env` configuration;
this adapter supplies no configuration parser.

```ts
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as http from '@okikio/activity/http';
import * as local from '@okikio/activity/local';
import * as resource from '@okikio/capability/resource';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';

/** Build one application-owned service; keep it alive until the listener drains. */
export async function open(secret: string, endpoint: URL) {
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
	const owner = context.create({ id: 'analysis-service' });
	const resources = resource.create(resource.implementations(), { ctx: owner, host: {} });
	const provider = local.create({ engine: Engine, implementations: [implementation], resources });
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
	const client = http.create({
		engine: Engine,
		activities: [Length],
		url: endpoint,
		maximumBytes: 64 * 1024,
		headers: () => ({ authorization: `Bearer ${secret}` }),
	});
	return {
		accept,
		client,
		/** Drain the application's listener and requests before closing borrowed resources. */
		async [Symbol.asyncDispose]() {
			await resources[Symbol.asyncDispose]();
			await owner[Symbol.asyncDispose]();
		},
	};
}
```

Register `client` with the workflow Scheduler for `Engine`. Mount `accept` only at the intended route; the handler
checks method and protocol but does not own routing, TLS, server timeouts or listener shutdown. HTTPS is required by
default. `allowLoopbackHttp: true` permits plain HTTP only for `localhost`, `127.0.0.1` or `::1`. Redirects are always
rejected so credentials cannot follow a redirect to another service. The credentials callback runs per attempt so
rotation does not require reconstructing the client.

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
