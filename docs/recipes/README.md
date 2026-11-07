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

Follow the [checkout setup](../../README.md#work-on-the-repository) to install Mise and review the repository settings.
From the folder that contains the root README, run:

```sh
mise install
mise run prepare -- --kind deps
```

Save one `ts runnable` block as the `.ts` file named in its recipe. Use that same filename in the run command. For
example, save the search program as `search.ts` and run `mise exec -- deno run search.ts` from the root. A recipe
will name any companion files it needs. Compare the terminal result with the `text output` block rather than copying
that block into the program. `mise run test -- --suite docs` runs the marked programs in the maintained guides and
package READMEs.

The examples use local data and public workspace exports. They are not claims of registry publication, database
deployment, or browser interaction. Replace the named application-owned source or destination deliberately, then
propagate its cancellation and failure contracts. Do not add a queue, workflow, or persistence adapter when the smaller
program already meets your requirements.
