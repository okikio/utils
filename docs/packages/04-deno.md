# Deno

A launcher chooses Deno capabilities explicitly. Begin by encoding that choice, then use the
[complete two-file launch](../../packages/runtime/deno/README.md#launch-a-real-child-with-the-chosen-grants) to see the
child reject an ungranted file read. These are source-checkout examples: review `mise.toml`, run `mise trust`,
`mise install` and `mise run prepare -- --kind deps` from the repository root. Save the first block as `scoped-permissions.ts` and
run `mise exec -- deno run scoped-permissions.ts`.

## Scoped arguments and comma escaping

Import the submodule as a namespace:

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

`parse()` accepts only `--allow-*` arguments. It does not silently ignore command options or entrypoints. Repeated
scoped grants are merged. An unscoped grant wins over scoped grants for the same permission.

## Round-trip existing arguments

`parse()` is useful when a host receives permission arguments and needs a normalized grant model before composing
another command:

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

An unscoped grant such as `--allow-read` dominates scoped grants for the same permission. Unsupported flags are rejected
instead of being silently ignored.

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

Import `@okikio/runtime/deno/proxy`, `/readiness` or `/health` for disposable transport, bounded loopback TCP admission
or optional liveness/readiness probes. Imports bind no listener, acquire no client and change no process environment.
Pass addresses, budgets and signals explicitly. A health listener defaults to all IPv4 interfaces when enabled; select a
loopback hostname when it should be local. Readiness callbacks report completed outcomes independently for each owned
loop, including empty polls. These are not queue-progress or crash-recovery guarantees.

`file.readJson` checks regular-file input and strict UTF-8 within a caller-selected byte budget. `file.audit`
exclusively creates a mode-0600 JSONL file, refuses concurrent appends and synchronizes each completed record. Hosts own
schemas, audit meaning, redaction and partial-record recovery. Existing context deadlines and `signals.attach` own
interruption; deployment maintenance policy stays in the executable.

See the [adoption guide](../04-adoption.md) for composition and verification limits.
