# Choose a task, then learn the mechanism

Pick the page that answers your question. If you're writing your first program with Utils, start with a package README:
it shows what to import, what to run, and what you should see. If you're deciding whether to use a utility at all,
start with the problem it solves. For example, [read a contact file](./recipes/01-import.md) to learn by doing, or
[follow a note through a retry](./postgres/02-outbox.md) to see why saving and sending need separate owners.

| What you need now                                | Read                                                                         | What you should be able to do afterward                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Find a package or a focused submodule            | [01 — Package map](./01-packages.md)                                         | Choose a capability and distinguish it from adjacent tools.                   |
| Understand unfamiliar utility concepts           | [02 — Read definitions and results](./02-learn.md)                                                  | Recognize ordinary values, definitions, owners, and results.                  |
| Combine a few packages                           | [03 — Composition](./03-composition.md)                                      | Run bounded input, discovery, and resource-backed operations.                 |
| Follow a larger user task                        | [Workflow recipes](./recipes/README.md)                                      | Build an import, search/draft flow, or recorded multi-step operation.         |
| Inspect where utilities came from | [04 — Adoption history](./04-adoption.md) | Trace the historical transfer from application repositories. |
| Select a supported host                          | [05 — Runtime](./05-runtime.md)                                              | Choose adapters and understand which capability each environment supplies.    |
| Inspect executable evidence                      | [06 — Scenarios](./06-scenarios.md)                                          | Locate actual tests and distinguish their claims from deployment guarantees.  |
| Compare utility choices                          | [07 — When built-ins are insufficient](./07-outcomes.md), [08 — Alternatives](./08-alternatives.md) | Decide whether a utility's contract is needed or a native operation suffices. |

These are independent routes, not required chapters to finish before writing code. The
[repository README](../README.md#run-a-complete-example-from-this-checkout) gives the local setup and runnable-example
convention. Each larger recipe repeats the setup needed for its own task.

For persistent background work, [Workflows](./workflows/README.md) separates learning, integration, recovery, and
operations. For logs, traces, and metrics, [Telemetry design](./telemetry/03-design.md) explains what observations can
establish, and [setup](./telemetry/04-setup.md) supplies application-owned configuration and shutdown.

For HTTP beyond a single GET, keep one greeting application while adding [POST, forms and webhooks](./server/09-http-input.md),
[streamed bodies and replay cursors](./server/10-http-streaming.md), a [real MCP tool](./server/11-mcp.md), or [two-way WebSocket messages](./server/12-websocket.md). Each workflow
shows input, output, failure and ownership decisions before describing its deployment limits.

Maintainers can go directly to [testing](./maintenance/01-testing.md), [packaging](./maintenance/02-packaging.md),
[releases](./maintenance/03-releases.md), [migration](./maintenance/04-consolidation.md), or
[artifact ownership](./maintenance/05-artifacts.md), [capability checks](./maintenance/06-capabilities.md), or
[streaming, proxy and database fault drills](./maintenance/07-recovery.md). Exact field-level API reference comes from public source comments and
JSR; this repository does not maintain duplicate API.json or API.md exports.
