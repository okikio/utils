# Deno

When your program starts another Deno program, it can decide which files that child may read or write and which
commands it may run. Build those choices as arguments first. Then use the
[complete two-file launch](../../packages/runtime/deno/README.md#launch-a-real-child-with-the-chosen-grants) to see the
child reject an ungranted file read. These are source-checkout examples: review `mise.toml`, run `mise trust`,
`mise install` and `mise run prepare -- --kind deps` from the repository root. Save the first block as `scoped-permissions.ts` and
run `mise exec -- deno run scoped-permissions.ts`.

## Permission values and their flags

`permissions.args(grants)` returns a list of strings to pass to the child command. Choose a value for each permission
such as `read`, `write` or `run`:

| Value for `read` | Argument produced | What it grants |
| --- | --- | --- |
| Omitted or `false` | No argument | No read access from this grant. It does not emit an explicit deny flag. |
| `true` | `--allow-read` | Read access without a path restriction. |
| `['/srv/input', '/srv/cache']` | `--allow-read=/srv/input,/srv/cache` | Read access scoped to those paths. |
| `[]` | Throws `TypeError` | An empty list is not a valid scope. Omit the value to emit no grant. |

### Build arguments for a child

Allow all reads, restrict writes to two directories, and let the child run only `chromium`. The second directory
contains a comma, so the generated argument must distinguish that character from the separator between paths:

```ts runnable=scoped-permissions.ts
import * as permissions from '@okikio/runtime/deno/permissions';

// Build child-process flags as data. This call neither starts a process nor grants it permissions.
const args = permissions.args({
	read: true,
	write: ['/srv/output', '/srv/tmp,1'],
	run: ['chromium'],
});
console.log(JSON.stringify(args));
```

```text output
["--allow-read","--allow-write=/srv/output,/srv/tmp,,1","--allow-run=chromium"]
```

`args()` produces stable `--allow-*` arguments. Scoped values are deduplicated without reordering. Literal commas are
escaped by doubling them, matching Deno's CLI syntax for comma-delimited permission scopes.

## Round-trip existing arguments

Use `permissions.parse(flags)` when you have existing permission flags and want to combine them with other grants
before building a child command. Pass only permission arguments, without the command name, entry file, or other options.
Save this block as `permission-roundtrip.ts` and run `mise exec -- deno run permission-roundtrip.ts`:

```ts runnable=permission-roundtrip.ts
import * as permissions from '@okikio/runtime/deno/permissions';

const grants = permissions.parse([
	'--allow-read=/srv/input,/srv/cache',
	'--allow-net=example.invalid:443',
]);

const canonical = permissions.args(grants);
console.log(JSON.stringify(canonical));
```

```text output
["--allow-read=/srv/input,/srv/cache","--allow-net=example.invalid:443"]
```

Repeated scoped grants for the same permission are merged. An unscoped grant such as `--allow-read` takes precedence
over all scoped read grants. Unknown permissions and other command arguments are rejected.

This package constructs permission arguments. It does not decide which permissions a particular executable should
receive. That policy stays with the executable owner.

## Choose the next host task

| Task | Focused entry and next action | Important limit |
| --- | --- | --- |
| Read configuration | `@okikio/runtime/deno/file`: `readJson(path, maximumBytes, signal?)`, then validate its returned unknown value with your schema | Requires read permission; strict UTF-8 and a byte bound do not establish the application shape. |
| Publish one file | Same entry: `write(path, text, { overwrite: 'create', durability: 'file' })` | A published file followed by sync failure raises `FilePublicationError`; reconcile rather than blindly retry. |
| Hold an available port | `@okikio/runtime/deno/port`: own `reserve()` with `using` and give its bound listener to an accepting server | `get()` closes its listener and leaves a bind race. Accepted connections need their own owner. |
| Stop on Ctrl-C | `@okikio/runtime/deno/signals`: attach to the operation Context | The Context owns removing process signal listeners; imports do not install them. |
| Expose service health | `@okikio/runtime/deno/health` and `/readiness` | Select loopback explicitly for local-only probes; health is not durable job progress. |

The [Deno README](../../packages/runtime/deno/README.md) and its exact source links retain the detailed host contracts.

## Explicit startup and operator boundaries

Use `@okikio/runtime/deno/proxy` for a connection you can close, `/readiness` to accept a limited number of
local TCP connections, or `/health` to report whether the service can respond. An import does not start a
listener, open a client, or change the process environment. Pass the addresses, limits, and signals when you
start the service.

If you enable a health listener, it listens on all IPv4 interfaces by default. Select a loopback hostname if
only clients on the same machine should reach it. Each readiness callback reports what happened in its own
loop, including a poll that found no work. Those reports do not tell you whether a queued job progressed or
survived a crash.

`file.readJson` checks that the input is a regular file and valid UTF-8. Set a byte limit before reading.
`file.audit` creates a new JSON Lines file with mode 0600, which gives only the owner read and write access.
It rejects overlapping appends and waits for each completed record to sync. Your application decides what to
record, what to hide, and how to recover a partial record. Use Context deadlines and `signals.attach` to stop
the work when needed.

See the [adoption guide](../04-adoption.md) for composition and verification limits.
