# @okikio/utils

Use these TypeScript utilities to read a CSV file, give a download a time limit, or save a job so a worker can pick it
up later. Each package solves one part of the job. Start with that package, then add others when you need them. For
example, Duration expresses a two-second limit and Context passes that limit to the work that should stop.

This checkout contains 27 experimental packages. The `@okikio/utils` package lets you install the suite together and
import one part at a time, such as `@okikio/utils/format/csv`. That import uses the same CSV code as the individual
Format package. The examples below use the code in this checkout; `0.0.0` does not indicate a published version.

## Choose by what you need to do

If you have no package in mind yet, try the [first runnable example](#run-a-complete-example-from-this-checkout).
If you have a job in mind, use the table to find a package. The [docs home](docs/README.md) also points to tutorials
that combine packages and guides that explain what happens when something fails.

| You need to                                               | Start here                                      | Add another utility when                                                               |
| --------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Write readable time settings or convert units             | [Duration](packages/duration/README.md)         | Context needs a deadline or an operation needs a retry delay.                          |
| Validate filters, sorting and pagination in an HTTP query | [Query](packages/query/README.md)               | A server or storage adapter executes the validated request.                            |
| Stop related work and observe its progress                | [Context](packages/context/README.md)           | Work needs a resource, explicit requirements, or a recorded workflow.                  |
| Save a draft or progress value and reopen it              | [Stored state](docs/context/03-stored-state.md) | Storage supplies the chosen memory, browser or PostgreSQL backing.                     |
| Validate values and share JSON Schema representations     | [Schema](packages/schema/README.md)             | A tool consumes a Standard Schema validator or a separate input/output JSON converter. |
| Borrow resources, enforce requirements or deliver effects | [Capability](packages/capability/README.md)     | Task or Activity needs the same composed capabilities.                                 |
| Select named definitions or transform structured data     | [Collection](packages/collection/README.md)     | Schema validates a value's meaning or another package uses the selected definitions.   |
| Collect text, forms, files or device interaction          | [Input](packages/input/README.md)               | A command updates shared state or triggers optional feedback.                          |
| Parse CSV or Sitemap data                                 | [Format](packages/format/README.md)             | Streams or Scheduler processes a large input incrementally.                            |
| Bound concurrent work or schedule a queue                 | [Scheduler](packages/scheduler/README.md)       | Storage persists jobs, or Worker places work in another thread/process.                |

The [complete package map](docs/01-packages.md) includes Schema, Result, Dispose, Pool, HTTP, Server, Storage, Runtime,
Worker, Activity, Task, Workflow and the other packages. Each package README explains its own defaults, failures and
resource ownership.

## Run a complete example from this checkout

Open a terminal in the folder that contains this README. Install [Mise](#work-on-the-repository) if needed; it selects the Deno
version used by these examples. Review `mise.toml`, then prepare the checkout once:

```sh
mise trust
mise install
mise run prepare -- --kind deps
```

Copy the first TypeScript example below into `readable-time.ts` in that folder. Run
`mise exec -- deno run readable-time.ts` and compare the printed lines with the output below the example.
For later examples, use the filename shown in the instructions. Keep any named companion files (`support=filename.ts`)
beside the file you run. Unmarked code fragments may require values from your own application.

Process examples explicitly need subprocess permission, and Worker examples need their listed companion files and
module-read permission. Their focused READMEs name those requirements. Run `mise run test -- --suite docs` to compile and execute
maintained examples together. Passing local examples does not establish database, browser, or deployment support. The
[repository checks](#work-on-the-repository) explain the separate runtime and integration checks.

## Write time in the units you mean

If an option expects milliseconds, typing `2500` makes a reader work out how long it means. `sec(2.5)` puts the unit
beside the number. It returns a duration value you can format for display or convert to the units another API expects.

```ts runnable=readable-time.ts
import { days, elapsed, hr, min, ms, ns, sec, total } from '@okikio/duration';

console.log(sec(2.5).toString(), ms(0.5).toString(), ns(1n).toString());
console.log(elapsed(days(2)), total(min(90), 'hours'));
console.log(hr(1.5).toString());
```

```text output
PT2.5S PT0.0005S PT0.000000001S
172800000 1.5
PT1H30M
```

The first line prints standard duration text: `PT2.5S` means two and a half seconds. The second prints two days in
milliseconds and ninety minutes in hours. The last prints an hour and a half as one hour and thirty minutes.

Use `elapsed()` for fixed timer arithmetic: a day is 24 hours and a week is seven days. Use `total()` with a real
`relativeTo` date or zoned date-time when calendar length matters. Months, years and daylight-saving transitions need
that explicit calendar choice. [Duration's guide](packages/duration/README.md) covers conversions, rounding, exact
bigint nanoseconds and the independently usable unit, conversion and instant subpaths.

## Keep a download and its cleanup together

A download returns data. Its owner decides when the work must stop and which cleanup must finish. A Context groups
that cancellation signal and cleanup so related functions can borrow the same lifetime.

Save this as `owned-import.ts` and run `mise exec -- deno run owned-import.ts`. The `data:` URL is a complete offline
input; no network permission is needed:

```ts runnable=owned-import.ts
import * as context from '@okikio/context';

await using operation = context.create({ id: 'import' });
operation.defer(() => console.log('Closed import.'));
const reply = await fetch('data:text/plain,photo-1', { signal: operation.signal });
console.log(await reply.text());
```

```text output
photo-1
Closed import.
```

`await` waits for a Promise's result. `await using` has a different job: it disposes `operation` when this module ends,
including on failure, and waits for registered cleanup. Here the cleanup prints its message after the body has been
read. Pass `operation.signal` to each cooperating operation; merely creating a Context does not interrupt unrelated work.

## Add progress and test the import's deadline

The Context tells the import when to stop and runs cleanup when it closes. A state cell holds the current progress.
Give the display the cell's reader so it can watch for changes without making them. A Context view can carry that
reader without creating a second deadline or taking over cleanup.

```ts runnable=progress-lifetime.ts
import * as context from '@okikio/context';
import { elapsed, ms, sec } from '@okikio/duration';

const clock = new context.TestClock();
// Keep time and cleanup under one owner; the child adds a two-second deadline.
await using operation = context.create({ id: 'import', clock });
await using step = context.timeout(operation, sec(2));

// The cell writes progress. Its reader lets the display observe without changing it.
using progress = context.state.create({ completed: 0 });
const visible = context.view(step, { progress: progress.reader });
using display = visible.progress.subscribe(({ value }) => console.log(`Completed ${value.completed}`));

// Advancing the test clock releases this wait without sleeping in real time.
const waiting = context.wait(step, ms(250));
clock.advance(ms(250));
await waiting;
progress.set({ completed: 1 });
console.log(elapsed(context.remaining(step)!));
```

```text output
Completed 1
1750
```

The display receives the progress update; it does not control the deadline. The remaining `1750` milliseconds come
from the child's original two seconds minus the `250` milliseconds advanced by the test:

| Object | What it controls |
| --- | --- |
| `clock` | When waits and deadlines advance in this test |
| `operation` and `step` | Cancellation and cleanup, with the child's deadline |
| `progress` | The current completed count |
| `visible.progress` and `display` | Read access and a subscription to updates |

This example uses deterministic time so it runs immediately. A production Context defaults to its system clock. Pass its
`signal` to Fetch or another cooperative operation. Register cleanup with the owner that acquired the resource.
[Context](packages/context/README.md) also provides independent state and EventTarget-to-Observable APIs; neither
requires starting a task or workflow.

Use `state.open()` when that observed value needs a backing store. Its asynchronous writes save before publishing;
readers keep the same synchronous observation API. Memory supports reopening within one process, Web Storage follows the
supplied browser storage lifetime, and PostgreSQL supports reopening from another process. Conflicts require an explicit
reload. The [stored-state guide](docs/context/03-stored-state.md) explains these guarantees, cancellation, and how to
supply another backing without changing callers.

## Collect input before deciding its meaning

Input preserves native values and repeated fields. Schema decides which values your application accepts. This example
uses standard FormData and the owned Schema package; file values can pass through the same collection path without their
bodies being read.

```ts runnable=form-values.ts
import { forms } from '@okikio/input';
import * as schema from '@okikio/schema';

const Details = schema.object({
	title: schema.string({ minLength: 1 }),
	tags: schema.array(schema.string()),
});
const submitted = new FormData();
submitted.append('title', 'Field notes');
submitted.append('tags', 'research');
submitted.append('tags', 'draft');

const result = await forms.validate(Details, submitted, { multiple: ['tags'] });
if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join('; '));
console.log(result.value.title, result.value.tags.join(', '));
```

```text output
Field notes research, draft
```

The same form operations accept native forms or structural readers. Input also provides text composition handling,
keyboard shortcuts, pointer sessions, geometric gestures, clipboard data, bounded file selection and gamepad snapshots.
[Its guide](packages/input/README.md) explains how an ordinary typed command can be reused across several interaction
styles. [Feedback](docs/input/03-feedback.md) is a separate family for text status, optional haptics and audio, and
finite visual cues.

## Use one subpath, one package, or several packages

These imports select the same state implementation:

```ts support=import-choices.ts
import * as state from '@okikio/context/state';
import * as context from '@okikio/context';
import * as installedContext from '@okikio/utils/context';

export const direct = state.create;
export const grouped = context.state.create;
export const fromOneInstallation = installedContext.state.create;
```

A focused subpath exposes an independently useful family. A package root groups its families and provides common
operations where their names are unambiguous. A namespace such as `context.state` is an import organization choice; it
creates no global registry or additional lifetime. Each call to `create()` creates a separate state owner.

Use focused imports in reusable modules. `@okikio/utils/all` intentionally imports the broad namespace graph and is
appropriate only when the application wants that whole graph. The [composition guide](docs/03-composition.md) shows
larger workflows with visible inputs, outputs, cancellation and cleanup.

Applications keep their own product policy, credentials, environment discovery, presentation, logging configuration and
deployment. Storage adapters make their actual persistence guarantees explicit. A local task, an in-memory queue and a
durable workflow solve different jobs; the [workflow guide](docs/workflows/01-basics.md) explains when saved history and
worker recovery become necessary.

To return work to a particular thread or process inside a provider pool, see
[Physical hosts](docs/workflows/19-hosts.md). To reuse a live resource there
between activities, see [Resource sessions](docs/workflows/18-sessions.md).

## Build a larger result

Start with a complete task and add only the mechanisms its requirements justify:

| Goal                                                                | Complete walkthrough                              | What the application supplies                                               |
| ------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| Preview an uploaded file, validate contacts, and report corrections | [Contact import](docs/recipes/01-import.md)       | Column mapping, contact policy, and the real destination.                   |
| Reuse a search action and restore its saved input                   | [Search and drafts](docs/recipes/02-search.md)    | Allowed search fields, provider, UI bindings, and backing store.            |
| Reuse completed jobs in a photo operation                           | [Recorded work](docs/recipes/03-recorded-work.md) | Activity implementations, resource providers, and logical identity.         |
| Accept background work and recover after a worker dies              | [Durable workflows](docs/workflows/01-basics.md)  | SQL pool, transactions, deployment, authorization, and repeat-safe effects. |

These are different requirements, not mandatory levels of framework adoption. A regular function or focused utility can
be the final solution. Each recipe provides its own setup, input, output, and failure explanation.
[The learning guide](docs/02-learn.md) connects the return shapes to ordinary JavaScript, and
[the package map](docs/01-packages.md) links every implementation package and focused capability.

## Find the submodule before building it yourself

Each implementation package README includes a complete import choice map, with a concrete job for every public submodule
and links to its exact source contract. Examples include `streams/reader` for inspectable cleanup,
`collection/record/change` for explicit JSON removals, `http/signature` for authenticated bytes, `context/state` for
local or saved observations, and `capability/resilience/attempt` for an ordinary repeat-safe read. The matching
`@okikio/utils/` entries forward the same implementations.

The packages remain experimental. Read the focused contract before depending on a default, and use the runnable example
to check the behavior you intend to adopt. The [migration guide](docs/maintenance/04-consolidation.md) explains removed
package names and changed ownership; historical delivery receipts are kept separately from current usage instructions.

## Work on the repository

Mise selects the tool versions and runs the repository commands. The programs those commands call live in
[the private tools workspace](tools/README.md). A package keeps its own tests beside its code. Tests that
use several packages together live in `tests/`.

For a ZIP checkout, install [Mise](https://mise.jdx.dev/getting-started.html) version 2026.10.3 or newer, then extract
the archive. Run the following commands from the directory containing the extracted `utils` folder. These tasks work
without initializing a Git repository. Review `utils/mise.toml` before trusting the local configuration:

```sh
cd utils
mise trust
mise install
mise run prepare -- --kind deps
mise run check
mise run test -- --runtime node
mise run test -- --runtime deno
mise run test -- --runtime bun
mise run test -- --suite docs
```

`check --kind portable` compiles browser, Worker and Node consumers with separate ambient types. `test --suite browser` uses real
Chromium. `mise run test -- --suite packages` builds and installs emitted archives before running consumer checks. PostgreSQL and Docker
tests have explicit resource tasks. Read [testing](docs/maintenance/01-testing.md),
[packaging](docs/maintenance/02-packaging.md), and [releases](docs/maintenance/03-releases.md) for the exact commands.
For long PostgreSQL lifetimes, `mise run test -- --suite soak` explicitly runs two hours of guarded writes, renewable claims and
a midpoint primary promotion. Read the [lease and soak instructions](docs/maintenance/07-recovery.md#keep-permission-alive-during-a-long-database-run)
before running it; its short harness mode does not test multi-hour behavior. All local run evidence stays in `.tmp/`.

Each package also owns independent unit tests and focused Mitata benchmarks. For example, check Pool's lease and
saturation behavior before measuring its cost:

```sh
deno task --cwd=packages/pool test
deno task --cwd=packages/pool bench:check
deno task --cwd=packages/pool bench
```

Root `tests/` and `bench/` retain the larger integration and end-to-end workflows. Package READMEs name the local
comparison, the guarantees it omits, and the root workflow needed to assess the complete system.

Benchmarks have their own correctness and measurement tasks. A passing correctness check does not establish a
performance gain. The [benchmark guide](docs/benchmarks/01-running.md) explains workloads and reports; the
[artifact policy](docs/maintenance/05-artifacts.md) distinguishes source fixtures, generated output, and historical
evidence.

For each package’s advanced scenario, existing boundary tests and remaining checks, use the
[capability evidence guide](docs/maintenance/06-capabilities.md). It distinguishes complete examples, contract checks,
benchmark comparisons and deployment evidence.
