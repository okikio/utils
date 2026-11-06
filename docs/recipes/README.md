# Build a complete task from focused utilities

Choose the result you need. Each recipe supplies local input, complete programs, expected output, and the application's
remaining responsibilities. Read one recipe independently; the numbers organize this folder rather than prescribing a
curriculum.

| Your task                                         | Start here                                  | What you will learn                                                                   |
| ------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Import a file and keep useful row-level feedback  | [01 — Contact import](./01-import.md)       | Add validation, bounded work, cancellation, and receipts only as requirements appear. |
| Reuse a search action and restore its saved input | [02 — Search and drafts](./02-search.md)    | Connect Query, Commands, Context state, and an explicit backing store.                |
| Reuse completed jobs in a multi-step operation    | [03 — Recorded work](./03-recorded-work.md) | Connect Activity, resources, engine placement, dispatch, history, and Workflow.       |

For smaller combinations, [Composition](../03-composition.md) covers bounded import, sitemap discovery, and a
controllable manifest save. For actual process-loss recovery, the [durable workflow guide](../workflows/01-basics.md)
connects the service, database, and executors; the recorded-work recipe explicitly uses memory.

## Run and adapt a recipe

From this checkout, install the pinned tools and dependencies:

```sh
mise install
mise run prepare -- --kind deps
```

Copy one `ts runnable` block into a `.ts` file at the repository root, then run `mise exec -- deno run example.ts`. Each
block is independent unless companion `support` files are explicitly named. The following `text output` fence is output
to compare, not code to paste. `mise run test -- --suite docs` compiles and executes the marked programs in maintained guides and
package READMEs.

The examples use local data and public workspace exports. They are not claims of registry publication, database
deployment, or browser interaction. Replace the named application-owned source or destination deliberately, then
propagate its cancellation and failure contracts. Do not add a queue, workflow, or persistence adapter when the smaller
program already meets your requirements.
