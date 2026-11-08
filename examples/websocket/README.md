# Exchange greetings over a WebSocket

A normal HTTP route sends one response to one request. A WebSocket starts with
an HTTP request that asks to switch protocols. After the switch, client and server
can each send messages until the connection closes. Use it for two-way live
interaction. Use an ordinary GET for a single answer, or server-sent events (SSE) when only the server needs to send
updates.

Follow the [checkout setup](../../README.md#work-on-the-repository) first. Run the commands below from the checkout
root. The check uses Deno's own WebSocket upgrade function and starts and stops its own local server:

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
no saved message history. It accepts two connections and checks how much reply data waits to be sent. These are
limits chosen for the example. They do not tell you how many clients a deployed service can support.
