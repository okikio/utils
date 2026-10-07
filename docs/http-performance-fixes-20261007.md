# Preparing HTTP work once

This change reduces repeated promise and parsing-policy preparation in the existing Fetch model. It preserves route
selection, request-local state, body admission, endpoint validation and response cleanup. The comparison baseline is Git
snapshot `ef81e5afcaa8cbb02da61283ea53824b9cc66b1e`. Runtime qualification and before/after measurements must establish
the outcome; the source changes alone do not establish a speed gain.

## Reuse one admitted parsing policy

A server normally chooses its byte budget before accepting traffic. Resolve that policy once, then pass it to each
request reader:

```ts
import { limits, parseJson } from '@okikio/http/request';
import { create, route } from '@okikio/server/http';

const policy = limits({ maximumBodyBytes: 64 * 1024 });
const app = create({
	routes: [route('POST', '/imports', async (request) => {
		const input = await parseJson(request, policy);
		return Response.json({ accepted: input });
	})],
});
const result = await app.fetch(
	new Request('https://example.invalid/imports', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ source: 'catalog' }),
	}),
);
console.log(await result.json());
```

Previously, each reader validated the options record, created a complete limit record and checked its numeric fields
again. The library now recognizes its own immutable policy records by exact object identity. Arbitrary caller records
still receive all checks, even when frozen. The identity table uses weak keys and does not retain policies after their
consumers release them.

Body readers also use the immutable default policy when options are omitted. Form parsing resolves one policy before
reading and retains its byte and field budgets through awaited decoding. Changing the original options during a read
cannot change that operation's admitted field count. Actual streamed bytes, malformed framing, media types, cancellation
and form contents still receive their existing checks.

The Utils comparison fixture now prepares its JSON and text budgets once per application, matching the configuration
lifetime of the Hono body-limit middleware. This setup change is separate from the production identity-reuse mechanism.
Measurements that include both changes show their combined effect; they cannot attribute the whole result to production
code alone.

## Keep promises where callers need them

Route dispatch performs synchronous selection and forwards the selected `Response` or promise. The public Fetch
operation remains promise-shaped, including final HEAD body cleanup. Non-HEAD responses forward their existing promise
without another async wrapper; synchronous failures remain promise rejections.

Each middleware continuation still returns a promise. It normalizes synchronous results with `Promise.resolve`, converts
synchronous failures to rejections and forwards an existing native promise without another async wrapper. Its
request-local guard rejects a repeated continuation before another handler call. Upstream middleware can still await
downstream work and recover its exact failure. Removing redundant awaits can change microtask scheduling and diagnostic
stack shape; neither exact microtask counts nor stack text is a supported contract.

## Avoid events with no audience

A compiled service with no declared observers no longer constructs and asynchronously emits unused lifecycle events.
Services with observers retain their event values and order. Response-body completion still disposes request ownership,
including cancellation and failure cleanup. Skipping observation therefore does not shorten the response's resource
lifetime.

The protected checks cover exact rejection identity, delayed results, repeated continuations, concurrent request
isolation, HEAD cancellation, parsing-budget mutation and rejection of caller-frozen invalid records. Service lifecycle
checks must also cover observed events and cleanup without observers. The final qualification report owns actual test
results and performance conclusions.

Service parsing options remain live inputs to the existing runtime. Preparing every service policy at construction would
change how later caller mutation and invalid options behave. That change requires an explicit snapshot contract and is
outside this reduction. Request contexts, requirement scopes and declared output validation also remain intact.

Empty service middleware and resilience stages now forward their downstream promises, and absent runtime adapters reuse
one immutable empty result. A header record created by the library also retains its admitted field projection under a
weak identity key. Repeated header reads avoid descriptor checks and canonicalization while preserving record grouping,
numeric-key ordering and separate cookies. Arbitrary caller records, native Headers and tuple lists still receive fresh
validation. These reductions were added after the first paired measurement phase and require the final phase's evidence.

## Keep provider diagnostics out of client input failures

A separate correctness repair follows the first paired performance snapshot. An unexpected request-body reader failure
previously became a client validation issue containing the original error message. That message can include private
provider diagnostics. The service now exposes only typed `RequestTransportError` issues as client input failures. Other
reader or configuration failures follow the existing Internal problem path with status 500 and a safe response body. The
failed service observer retains the original error's name and message as a diagnostic projection; it does not expose the
original Error object to clients.

The regression uses an independently chosen secret-bearing stream failure and checks that the response excludes its name
and message while the observer receives the diagnostic projection. Literal malformed JSON, unsupported media type and
schema-invalid JSON controls retain their existing 400, 415 and 400 responses. This repair is absent from the first
paired measurement candidate. It is present in the final paired candidate and the final runtime qualification described
in [the closure report](./http-performance-closure-20261007.md).

Body cancellation also receives a separate correctness repair after that snapshot. The reader joins cancellation before
releasing its lock. A rejected overflow cancellation cannot replace the typed `body-too-large` admission issue; it
becomes the transport error's private cause. When another primary failure and cleanup both fail, a native
`AggregateError` retains both values and identifies the primary value through `cause`. Successful abort cleanup
preserves the exact caller reason, including `null`. Controlled cancellation gates check settlement order and lock
release without elapsed-time thresholds. These cleanup changes are also absent from the first paired measurement
candidate and present in the final paired candidate.
