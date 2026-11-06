# Exchange greetings over a WebSocket

A normal HTTP route sends one response to one request. A WebSocket starts with
an HTTP request that asks to switch protocols. After the switch, client and server
can each send messages until the connection closes. Use it for two-way live
interaction; use an ordinary GET for a single answer or SSE for a server event feed.

From the checkout root, prepare dependencies with `mise run prepare -- --kind deps`.
The complete host check uses Deno's native upgrade API:

```sh
deno run --frozen --allow-net=127.0.0.1 examples/websocket/check.deno.ts
```

It prints `Hello, Sam!` after a real HTTP upgrade and closes the connection. To
connect independently, start the host in one terminal:

```sh
deno run --frozen --allow-net=127.0.0.1:8000 examples/websocket/start.ts
```

In another terminal, choose a client command:

| Deno | Node | Bun |
| --- | --- | --- |
| `deno run --allow-net=127.0.0.1:8000 examples/websocket/client.ts` | `node examples/websocket/client.ts` | `bun examples/websocket/client.ts` |

Each client sends `Sam`, waits for `Hello, Sam!`, and closes. Press Ctrl+C in the
host terminal to stop it. The host uses Deno; Node and Bun run the native client,
not this Deno server. Utils' HTTP router is portable, but it does not supply a
universal listener or WebSocket upgrade API.

```text
websocket/
├── server.ts       # /status through Utils; /socket through Deno's upgrade API.
├── client.ts       # Native client: open, send, receive, close.
├── check.deno.ts   # Full real-network check for the Deno host.
├── start.ts        # Long-lived host and operator shutdown.
├── package.json    # Checkout dependency on the Utils server package.
└── deno.jsonc      # Private example; not published to JSR.
```

Read [the walkthrough](../../docs/server/12-websocket.md) before adding private
messages, reconnects or many clients. This local host is unauthenticated and has
no durable message history. Its two-connection limit and reply-buffer check are
demonstration policies, not measured service capacity.
