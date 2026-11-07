# Expose a greeting as an MCP tool

Model Context Protocol (MCP) lets an application discover named operations and call
them through a standard message format. A **tool** is one such operation: `greet`
accepts a name and returns greeting text. An AI host can let a model suggest that
call; the host's client sends it after applying the host's permission policy.
This check is an ordinary client, so it needs no model.

The client first discovers available tools, then calls one with checked input.
This example exposes `greet` through Utils HTTP routing and MCP SDK 2.4.0. The SDK
reads and writes MCP messages. Before the SDK sees a request, the Utils route checks its Host and Origin headers.

## Run the checked example

From this repository's root, run `mise run prepare -- --kind deps`, then
`cd examples/mcp`. Choose one installed runtime:

| Runtime | Verify discovery and calls | Start a listener |
| --- | --- | --- |
| Deno 2.9.7 | `deno run --frozen --allow-net=localhost,127.0.0.1 check.ts` | `deno run --frozen --allow-net=localhost:8000,127.0.0.1:8000 start.ts` |
| Node 26.10.0 | `node check.ts` | `node start.ts` |
| Bun 1.4.2 | `bun check.ts` | `bun start.ts` |

The check uses a real loopback socket and SDK client, asserts these results, and
closes owned resources. It needs no AI service or credentials.

```text
["greet"]
[{"type":"text","text":"Hello, Sam!"}]
invalid true
blocked 403 403
```

Read the first two lines as separate checkpoints: the client first discovers the name `greet`, then receives a text
result from calling it. `invalid true` checks argument rejection, and the two `403` codes check that the outer HTTP
route rejects an unacceptable host and origin.

`start.ts` listens at `http://localhost:8000/mcp`. Press Ctrl+C to close it.
This is a development listener, not an authentication or deployment policy.

## Copy the parts you need

```text
mcp/
├── package.json   # Pinned SDK and local workspace dependencies.
├── deno.jsonc     # Explicitly excludes this example from JSR publication.
├── server.ts      # Defines the greet tool and HTTP admission.
├── listen.ts      # Converts HTTP streams; preserves response backpressure.
├── start.ts       # Owns listener startup and Ctrl+C cleanup.
└── check.ts       # Checks the documented outcome through the public protocol.
```

Keep these relative file names together in any parent directory you choose.
The repository is experimental: its Utils packages are local workspace members.
For a separate application, copy the TypeScript files, replace workspace ranges
with your chosen published Utils versions, and install the pinned SDK under that
application's dependency policy. Do not copy the checkout's workspace ranges
into a standalone npm project.

The Fetch application is the same on every runtime. The listener uses `Deno.serve` on Deno and Node's HTTP stream API on Node/Bun. Read the
[walkthrough](../../docs/server/11-mcp.md) for the mental model, policy boundaries,
and the distinction between MCP transport progress and durable application work.

Start with `server.ts` to see registration, then `check.ts` to see discovery and a
call. `listen.ts` converts network traffic into Web Requests. SDK v2 is the library
API, not a protocol called “MCP v2”; the server's `1.0.0` is this application's
version. The [walkthrough](../../docs/server/11-mcp.md#keep-library-versions-separate-from-protocol-versions)
explains those versions, streaming, and authentication before you add private tools.
