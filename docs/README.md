# Choose a task, then learn the mechanism

You can use one utility without learning the suite. Start with a familiar job, run its package example, and inspect the
result before adding another capability. Package READMEs provide independent entry examples and a map of every public
submodule. Deeper guides explain distinct tasks, limits, and failure recovery.

| What you need now                                | Read                                                                         | What you should be able to do afterward                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Find a package or a focused submodule            | [01 — Package map](./01-packages.md)                                         | Choose a capability and distinguish it from adjacent tools.                   |
| Understand unfamiliar utility concepts           | [02 — Learn](./02-learn.md)                                                  | Recognize ordinary values, definitions, owners, and results.                  |
| Combine a few packages                           | [03 — Composition](./03-composition.md)                                      | Run bounded input, discovery, and resource-backed operations.                 |
| Follow a larger user task                        | [Workflow recipes](./recipes/README.md)                                      | Build an import, search/draft flow, or recorded multi-step operation.         |
| Introduce utilities into an existing application | [04 — Adoption](./04-adoption.md)                                            | Keep business policy and host ownership explicit while adopting selectively.  |
| Select a supported host                          | [05 — Runtime](./05-runtime.md)                                              | Choose adapters and understand which capability each environment supplies.    |
| Inspect executable evidence                      | [06 — Scenarios](./06-scenarios.md)                                          | Locate actual tests and distinguish their claims from deployment guarantees.  |
| Compare utility choices                          | [07 — Outcomes](./07-outcomes.md), [08 — Alternatives](./08-alternatives.md) | Decide whether a utility's contract is needed or a native operation suffices. |

These are independent routes, not required chapters to finish before writing code. The
[repository README](../README.md#run-a-complete-example-from-this-checkout) gives the local setup and runnable-example
convention. Each larger recipe repeats the setup needed for its own task.

For persistent background work, [Workflows](./workflows/README.md) separates learning, integration, recovery, and
operations. For logs, traces, and metrics, [Telemetry design](./telemetry/03-design.md) explains what observations can
establish, and [setup](./telemetry/04-setup.md) supplies application-owned configuration and shutdown.

To publish a consequence of a business write, the [transactional outbox guide](./postgres/02-outbox.md) shows one SQL
transaction for acceptance and a separate sink receipt for safe redelivery. It explains what remains uncertain after
cancellation, lease expiry or a lost acknowledgement.

For HTTP beyond a single GET, keep one greeting application while adding [POST, forms and webhooks](./server/09-http-input.md),
[streamed bodies and replay cursors](./server/10-http-streaming.md), a [real MCP tool](./server/11-mcp.md), or [two-way WebSocket messages](./server/12-websocket.md). Each workflow
shows input, output, failure and ownership decisions before describing its deployment limits.

Maintainers can go directly to [testing](./maintenance/01-testing.md), [packaging](./maintenance/02-packaging.md),
[releases](./maintenance/03-releases.md), [migration](./maintenance/04-consolidation.md), or
[artifact ownership](./maintenance/05-artifacts.md), [capability checks](./maintenance/06-capabilities.md), or
[streaming, proxy and database fault drills](./maintenance/07-recovery.md). Exact field-level API reference comes from public source comments and
JSR; this repository does not maintain duplicate API.json or API.md exports.
