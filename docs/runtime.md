# Runtime and distribution contracts

Deno source is canonical. JSR publishes that source; the npm build projects supported public entries into emitted Node
packages. The same package name does not prove that every adapter or native capability works in every host.

## Choose the surface for your host

| Surface                   | Contract and qualification boundary                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deno source               | Run the checked-in TypeScript through its workspace/public imports. Unit, scenario, native Worker/process, and example gates qualify the applicable source behavior.                                                                                    |
| JSR                       | Source-native manifests and exports are authoritative. Workspace execution and publish checks are evidence for source/artifact contracts, not proof that a new registry version was deployed.                                                           |
| Emitted Node ESM/CommonJS | The npm projection emits separate runtime and declaration entries. The clean-consumer gate physically installs exact packed artifacts and imports/requires every included public subpath. Successful source tests alone do not establish this contract. |
| Deno-specific entries     | `@okikio/deno`, `process/deno`, and `worker/deno` remain explicit source-runtime adapters and are excluded from Node projections, including matching umbrella entries.                                                                                  |
| Browser                   | Pure parsing and Web API composition have selected bundle/source evidence. That does not qualify the entire suite in an actual browser or grant a global Worker, listener, filesystem, or process capability.                                           |
| Bun                       | No complete native Bun artifact/suite guarantee is established by this qualification. A compatible API shape is not execution evidence.                                                                                                                 |

The current npm metadata selects Node `>=26.10.0`, the runtime selected for artifact qualification. It does not claim
that older hosts pass the same emitted artifact and lifecycle gates. The ordinary Worker opener still needs a standard
module `Worker` constructor or a caller-supplied factory; importing its npm entry is not proof of a native Node Worker
execution. Use `process/node` for the Node child-process adapter; native lifecycle qualification is a separate gate from
entry imports.

The per-package [qualification matrix](./qualification.json) separates source, emitted package, scenario, and runtime
proof. [Packaging](./packaging.md) owns the exact build, clean-consumer, archive, export, and validator commands. A
report must name which of those gates actually passed and preserve blocked or unexecuted results.

## Install optional globals at the executable boundary

Lifecycle packages use Temporal and ECMAScript explicit resource management. On a host that lacks the corresponding
globals, import the explicit setup entries before using those packages:

```ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
```

Those entries preserve an existing native implementation and are intentionally side-effectful. Ordinary utility imports
do not install globals. `duration/temporal` instead provides a local Temporal ponyfill when the application wants
calendar arithmetic without global installation. Disposal also has direct local constructors:

```ts
import { DisposableStack, dispose } from '@okikio/dispose/ponyfill';

const cleanup = new DisposableStack();
cleanup.defer(() => console.log('Owned operation finished.'));
cleanup[dispose]();
```

The focused disposal root exports the same pure constructors. On a host without disposal protocol symbols, use the
exported local keys when registering resources; native `using` syntax needs the host symbols or explicit installer. Each
Worker or child has its own realm and needs its own setup when ambient lifecycle packages require globals. The
installation facade exposes matching `@okikio/utils/duration/*` and `@okikio/utils/dispose/*` entries.

## Own the native resource where it runs

A context carries local cancellation, time, and cleanup. A serialized snapshot carries identity and timestamps;
receiving work creates a new local signal. A task is one finite local operation. A Worker or process provider owns the
native handle and shutdown path. Cancellation requests cooperative stopping; disposing an owner joins the cleanup it
owns. Neither action migrates a JavaScript stack or makes an arbitrary callback safely interruptible.

Process-group termination is qualified on the applicable POSIX adapters. Windows currently offers direct-child mode; an
unsupported stronger mode rejects rather than claiming process-tree cleanup. Browser Web Worker support and a Node
worker factory need their own native execution evidence.

Workflow's bundled history and dispatch stores are in memory. Replacement-host and replay scenarios qualify logical
identity, claims, fencing, and recorded completion through those references. They do not prove persistent process-loss
recovery, a deployed database adapter, cross-computer transport, or Kubernetes admission. A durable provider must supply
authoritative atomic ownership, completion, lease time, and reconciliation at that storage boundary.

Applications own ambient configuration, provider credentials, LogTape configuration, tracing SDKs, network listeners,
and deployment. Generic utility imports do not start those owners. Read [composition](./composition.md) for complete
local examples and [scenarios](./scenarios.md) for the originating consumer patterns.
