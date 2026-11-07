# Historical utility adoption from application repositories

This maintainer record describes an earlier transfer of utilities from Core, Intelligence and Signals. It is not an
application setup guide. To add utilities to your own application, start with the complete
[composition examples](./03-composition.md); the application keeps its business policy and host ownership.

The transfer changed standalone Utils; Core, Intelligence and Signals supplied the motivating use cases. Read the current package code and tests for the API you can use today. The application snapshots below show where
the ideas came from. They do not show how to connect those applications to the current packages.

Source snapshots inspected for this adoption: Core `776500556870`, Intelligence `c953eeaecec8`, and Signals
`d44923d32774`. Existing standalone working changes were preserved. These revisions show where the code came from, not
deployed application versions.

The utility adoption below predates the separately implemented
[durable workflow profile and Testcontainers suite](./workflows/01-basics.md). Its original checks do not certify that
later work. `resilience.poll` is process-local and must not be mistaken for durable dispatch.

## What moved and who owns it

| Source capability                          | Standalone owner                                                                                                    | Consumer responsibility                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared definition-only service compilation | `server/service.compileDefinition`, route inventory and OpenAPI                                                     | Author canonical definitions; bind implementations only for runtime execution. Static compilation retains effects, requirements and execution contracts.                                                                                              |
| Shared serialized gateway contracts        | `server/gateway.mountArtifact`, gateway OpenAPI                                                                     | Supply manifest/document, explicit route allowlist, origin, upstream authentication bindings and caller-facing security. Opaque artifact resource/requirement/workflow metadata rejects until a host capability binding API exists.                   |
| Shared internal routes                     | Gateway mount `internal` selection                                                                                  | Explicitly admit exact selected internal endpoints; never infer exposure from public documentation.                                                                                                                                                   |
| Shared bounded response reading            | `http/response.readBytes`, `readText`; `streams/bytes`                                                              | Choose a byte budget and cancellation signal. Cancellation releases the reader without waiting indefinitely for a hostile source's cancellation promise. Producer cleanup remains a separate lifetime obligation.                                     |
| Shared polling                             | `resilience.poll`                                                                                                   | Supply one iteration and an explicit retry classifier, own shutdown and durable queue/lease policy. Retry budgets count consecutive failures and reset after successful polls.                                                                        |
| Core resource isolation                    | `resource.create({ source })`, service runtime `source`                                                             | Supply raw values explicitly. Each resource validates its own fields at acquisition; `environment` means already-parsed values and cannot be combined with `source`. Adapters use `UnavailableError` for expected outages, producing a safe HTTP 503. |
| Core CSV                                   | `csv` dialect and `csv/write` serializer                                                                            | Keep preamble/header/order explicitly, consume successful EOF before trusting a streamed dialect, discard partial output on error. Spreadsheet rewriting is opt-in.                                                                                   |
| Core Deno operations                       | `deno/proxy`, `deno/readiness`, `deno/health`                                                                       | Own transport, listener addresses, signals, retry classification and readiness reports. Every polling loop reports independently. `/live` only proves the HTTP handler runs; neither probe proves durable queue progress.                             |
| Core and Intelligence process shutdown     | `process` lifecycle and optional `process/deno` system-kill host                                                    | Select process-group ownership explicitly. A denied signal requires independent leader settlement and group disappearance; unknown or permission-denied liveness never proves absence.                                                                |
| Core signatures and Intelligence hashing   | `hash`, `http/signature`                                                                                            | Full digests for integrity; compact tuple IDs for correlation with collision handling; HMAC callers own audience, expiry and replay policy. Existing separator-derived IDs need an explicit migration.                                                |
| Core browser mechanics                     | Optional `input` package                                                                                            | Own components, commands, gesture thresholds, rendering and disposal; test real browser behavior in the application.                                                                                                                               |
| Core JSON console output                   | `telemetry/json`                                                                                                    | Supply destination and application text-redaction policy. Known credential keys are filtered; raw Error objects are excluded. Hosts own LogTape configuration.                                                                                        |
| Intelligence operator mechanics            | `streams/json`, `deno/file.readJson`, exclusive `audit`, `dispose/run`, existing context deadlines and Deno signals | Own manifest schema, deployment identity, allowed actions, credentials, audit redaction and command policy. Successful cleanup timeout means waiting ended, not that arbitrary cleanup code stopped.                                                  |
| Intelligence schema adapters               | Optional `schema/time`, `schema/zod`                                                                                | Date codec uses UTC Z input and millisecond Date precision. Import Zod only through optional subpaths.                                                                                                                                                |

Signals adds no separate production utility module beyond the shared contract, HTTP and polling work in this inventory.
Standalone's explicit schema-projector precedence, separate input/output JSON Schema projection and problem typing
already existed and are retained. Capacity continues to accept Standard Schema directly; copied Zod/Valibot aliases add
no behavior and are not duplicated. Standalone's FIFO adapter, broader query equality and newer clock/workflow cleanup
behavior are also retained.

## A bounded import boundary

```ts
import * as csv from '@okikio/format/csv';
import { serialize } from '@okikio/format/csv/write';
import { readBytes } from '@okikio/http/response';

const bytes = await readBytes(response, 8 * 1024 * 1024, signal);
const document = csv.parseBytes(bytes, { headerRow: 1, maximumBytes: 8 * 1024 * 1024 });
const records = [
	...document.preamble,
	document.columns.map((column) => column.rawHeader),
	...document.rows.map((row) => row.values),
];
for await (const chunk of serialize(records, document.dialect, { maximumBytes: 16 * 1024 * 1024, signal })) {
	await writer.write(chunk);
}
```

`response`, `signal` and `writer` are caller-owned inputs. The writer must be aborted or its unpublished output
discarded after an error. Source dialect captures framing choices, not arbitrary original quoting, whitespace or
byte-for-byte source identity. Strict Windows-1252 output can reject a newly introduced character; offer standard UTF-8
output explicitly. CSV dialect validation uses Standard Schema without a Zod runtime dependency.

## Explicit local polling and readiness

```ts
import * as health from '@okikio/runtime/deno/health';
import { poll } from '@okikio/capability/resilience/poll';

await using probes = health.open({ port: 8081, hostname: '127.0.0.1', signal });
const report = probes.poller();
await poll(() => queue.poll(signal), {
	signal,
	intervalMs: 1000,
	isRetryable: (error) => error instanceof QueueUnavailable,
	onPoll: report,
});
```

The application supplies `queue`, `QueueUnavailable` and `signal`. Empty polls count as successful completed polls.
Permanent errors and exhausted consecutive retry attempts reject; the executable must fail or recover under its own
policy. Register one callback for each owned loop before it starts. Readiness does not automatically acquire
dependencies or restart a crashed process. The deployment starts a replacement, and the queue's own lease/receipt
protocol determines whether unfinished work can be retried.

## Verification and limits

Package tests exercise byte and record limits, cancellation, shared-resource borrowing, portable contract rejection,
reference/security composition, CSV round trips, parser budgets, audit exclusivity and cleanup failure preservation.
Deno wire tests exercise real loopback listeners, SOCKS transport and TLS server names. Portable Node selections run the
same TypeScript source. Mathematical and controlled DOM tests do not establish visual or device behavior.

Run the [source, npm, and container checks](./maintenance/01-testing.md) for current evidence. A passing import check
does not prove runtime behavior. A local container scenario does not prove a production deployment.

Use the maintained checks commands for the current revision. Historical
measurements describe earlier revisions and do not establish current support.

The durable PostgreSQL workflow profile and Testcontainers suite are now implemented separately. See
[the current workflow guide](./workflows/01-basics.md) for its supported instructions, explicit driver bridge, consumer
scenarios, recovery evidence and remaining limits. The utility checks above predate that addition.
