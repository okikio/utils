# Runtime and distribution contracts

Deno source is canonical. JSR publishes that source; the npm build projects supported public entries into emitted Node
packages. The same package name does not prove that every adapter or native capability works in every host.

## Run portable value code first

A URL query can contain several selected tags. This complete program parses both choices without a listener, file
access, Worker or process. From this source checkout, review `mise.toml`, then run `mise trust`, `mise install`, and
`mise run prepare -- --kind deps`. Save `runtime-check.ts` at the root:

```ts runnable=runtime-check.ts
import { parseQuery } from '@okikio/http/request';

console.log(JSON.stringify(parseQuery('?tag=photo&tag=audio')));
```

Run `mise exec -- deno run runtime-check.ts`. It prints:

```text output
{"tag":["photo","audio"]}
```

This checks portable parsing on Deno source. For a Node application, select the built npm package's ESM or CommonJS
entry and follow [the installed-consumer procedure](./maintenance/02-packaging.md). Do not infer Node artifact behavior
from a successful Deno run, or assume that a browser parser import can launch an OS process. The table below explains
which source, artifact and native-host checks support each choice.

## Choose the surface for your host

| Surface                   | Contract and checks boundary                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deno source               | Run the checked-in TypeScript through its workspace/public imports. Unit, scenario, native Worker/process, and example gates test the applicable source behavior.                                                                                    |
| JSR                       | Source-native manifests and exports are authoritative. Workspace execution and publish checks are evidence for source/artifact contracts, not proof that a new registry version was deployed.                                                           |
| Emitted Node ESM/CommonJS | The npm projection emits separate runtime and declaration entries. The clean-consumer gate physically installs exact packed artifacts and imports/requires every included public subpath. Successful source tests alone do not establish this contract. |
| Deno-specific entries     | `@okikio/runtime/deno`, `process/deno`, and `worker/deno` remain explicit source-runtime adapters and are excluded from Node projections, including matching umbrella entries.                                                                          |
| Browser                   | Pure parsing and Web API composition have selected bundle/source evidence. That does not test the entire suite in an actual browser or grant a global Worker, listener, filesystem, or process capability.                                           |
| Bun                       | No complete native Bun artifact/suite guarantee is established by this test. A compatible API shape is not execution evidence.                                                                                                                 |

The current npm metadata selects Node `>=26.10.0`, the runtime selected for artifact test. It does not claim
that older hosts pass the same emitted artifact and lifecycle gates. The ordinary Worker opener still needs a standard
module `Worker` constructor or a caller-supplied factory; importing its npm entry is not proof of a native Node Worker
execution. Use `process/node` for the Node child-process adapter; native lifecycle checks is a separate gate from
entry imports.

The [testing guide](./maintenance/01-testing.md) separates source tests, emitted package consumers, and container
recovery. Each check proves its observed scope. A test selection alone is not evidence that it passed.

## Choose local implementations or explicit global installation

Duration and Context use native Temporal when available and a local implementation otherwise. Context also uses the
owned disposal primitives. Their ordinary imports and operations do not require global installation. The complete
[Context profile-load example](../packages/context/README.md#download-with-a-budget) uses their clock and disposal APIs
around real Fetch calls.

For application code or dependencies that access the corresponding globals directly, import `@okikio/duration/polyfill`
and `@okikio/dispose/polyfill` explicitly from the executable's setup module.

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

Process-group termination is tested on the applicable POSIX adapters. Windows currently offers direct-child mode; an
unsupported stronger mode rejects rather than claiming process-tree cleanup. Browser Web Worker support and a Node
worker factory need their own native execution evidence.

The local workflow examples use in-memory history and dispatch. Those stores keep step results and current attempt
permission only while their process survives. They do not prove recovery from a fresh database connection after process
loss.

The optional [PostgreSQL profile](./workflows/01-basics.md) supplies a saved queue, step results, children, timers,
receipts, finalization, and repair. Its Testcontainers lane checks real SQL state after fresh Node and Deno execution
processes. It also runs separate HTTP service and worker containers, then kills and replaces workers. The
[test guide](./workflows/07-tests.md) distinguishes these checks from memory replay and production failover claims.

Applications own ambient configuration, provider credentials, LogTape configuration, tracing SDKs, network listeners,
and deployment. Generic utility imports do not start those owners. Read [composition](./03-composition.md) for complete
local examples and [scenarios](./06-scenarios.md) for the originating consumer patterns.

## Run a portable example in your own project

A filename such as `example.ts` describes one module, not a required parent
folder. Keep related files together when their imports are relative. In this
experimental checkout, prepare the workspace once with
`mise run prepare -- --kind deps`. In a separate application, install its utility
dependencies using that application's package manager and dependency policy.

| Runtime | Run one complete portable module |
| --- | --- |
| Deno | `deno run example.ts` |
| Node | `node example.ts` |
| Bun | `bun example.ts` |

The checkout pins Deno 2.9.7, Node 26.10.0, and Bun 1.4.2. Node strips the supported
TypeScript syntax directly. These commands do not grant missing Deno permissions
or make a host-specific adapter portable. A Web Worker example needs its Web
Worker host; a Node worker uses `@okikio/runtime/node/worker`; Deno filesystem and
listener adapters require Deno and their documented permissions.

For a complete multi-file program tested on all three runtimes, use the
[MCP example](../examples/mcp/README.md). It separates the shared Fetch application
from listener ownership and checks the real client/server conversation.
