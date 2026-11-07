# Run an example before adopting its utility

Each directory contains a complete program and an executable check of its result.
Follow the [checkout setup](../README.md#work-on-the-repository) to install the tools and dependencies.
Pick an example by the behavior you want to see. Its README tells you what to run and what output confirms it.
To run the checks available for one JavaScript runtime, select `deno`, `node` or `bun`:

```sh
mise run test -- --suite examples --runtime deno
```

The runner uses `check.<runtime>.ts` when present, otherwise `check.ts`. It skips
an example with no check for the selected host. A passing Node run therefore
does not establish that the Deno WebSocket host was tested.

| Example | What it demonstrates |
| --- | --- |
| [MCP](./mcp/README.md) | Discover and call a checked tool over HTTP, reject invalid input, enforce host/origin policy, and close resources. |
| [Browser sessions](./sessions/README.md) | Keep real Chromium cookies across actions and close each temporary page. Its browser check is explicit and requires a browser installation. |
| [WebSocket](./websocket/README.md) | Upgrade a Deno HTTP connection, exchange a greeting, then close it; native clients run on all three hosts. |

You can copy the programs in these directories. Follow each README to find the files you need. You do not need
maintainer logs or generated reports to run the examples.
