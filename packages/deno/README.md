# `@okikio/deno`

A media command needs to read `/srv/input` and launch `ffmpeg`. Deno requires the host to choose permissions for those
operations. `deno/permissions` turns an explicit permission list into CLI arguments, so the command launcher does not
have to assemble and escape the flags itself. Other submodules cover Deno-specific file, port and signal mechanics.

| Host's choice                 | Argument produced by the demo |
| ----------------------------- | ----------------------------- |
| Read files under `/srv/input` | `--allow-read=/srv/input`     |
| Launch `ffmpeg`               | `--allow-run=ffmpeg`          |

These rows describe the permission arguments to pass to Deno. Producing strings grants no permission to the current
process and launches no child. The host remains responsible for deciding which grants are appropriate.

## Build permissions for a media command

```ts runnable
import * as permissions from '@okikio/deno/permissions';
const args = permissions.args({ read: ['/srv/input'], run: ['ffmpeg'] });
console.log(JSON.stringify(args));
```

Expected output:

```text output
["--allow-read=/srv/input","--allow-run=ffmpeg"]
```

The input is a permission record with two scoped grants. The output is the exact two-argument array a launcher can use.
Try replacing the read scope with `true`: the resulting `--allow-read` is a broader grant. Choose scoped grants when the
executable only needs a known path.

## The small contracts behind the Deno adapters

| Entry                                     | Receives → returns                                   | Work and owner                                                                               |
| ----------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `permissions.args(grants)`                | `PermissionGrants` → readonly string array           | Encodes a plan; does not request permissions                                                 |
| `permissions.parse(arguments)`            | Iterable of `--allow-*` strings → `PermissionGrants` | Rejects unsupported flags and merges repeated grants                                         |
| `file.write(path, contents, { signal? })` | Path plus text/bytes → `Promise<void>`               | Owns a same-directory temporary file until rename/cleanup                                    |
| `port.get(hostname?)`                     | Hostname → port number                               | Opens a temporary listener on port zero, reads its assigned port, closes it before returning |
| `signals.attach(ctx, options?)`           | Owned Context → `void`                               | Attaches process stop listeners; that context owns removing them                             |

`PermissionGrants` is an ordinary partial record. Its keys are `read`, `write`, `net`, `env`, `sys`, `run`, `ffi` and
`import`. Each value is `true` for an unscoped grant, `false`/absent for no grant, or a readonly string array of scopes.
`args()` visits a fixed key order, deduplicates each list and doubles literal commas before joining scopes. This is why
two launchers can share the same grant model without having to implement CLI quoting independently.

For example, a launcher can pass `permissions.args({ read: ['./input'] })` as part of
`new Deno.Command(Deno.execPath(), { args: ['run', ...grants, 'import.ts'] })`. Constructing `Deno.Command` describes
the command; `spawn()` or `output()` is the later action that starts it. The host chooses grants and owns the child
process.

The other adapters have limits worth knowing before composing them. `file.write()` checks abort before work and before
rename; it does not interrupt an already-running filesystem call or promise crash durability. `port.get()` reports a
port that was free, not a reservation that stays held. Another process can bind it after return. Signal listeners are
process-wide and are installed only when you explicitly call `attach()`. File, port and signal operations need the
corresponding Deno runtime and permissions. See the [full adapter contracts](API.md).

## Build on the example

- Use permission arguments at a [Process](../process/README.md) host boundary where a Deno executable is launched. The
  process host owns the launch; these strings describe that executable's grants.
- Use `deno/signals` with an owned [Context](../context/README.md) for a command that must stop on a process signal. The
  context's cleanup removes attached listeners when that owner is disposed.

Use permission arguments when launching a child, file helpers for bounded filesystem operations, and port helpers when a
host needs a listener. These are explicit Deno adapters; portable algorithms belong in the other packages. Grant only
the capabilities your executable needs. Building an argument list does not grant the current process a permission.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

The public submodules are `@okikio/deno/permissions`, `@okikio/deno/file`, `@okikio/deno/port`, and
`@okikio/deno/signals`, with their contracts in `@okikio/deno/types`. The root export also groups the runtime operations
as `permissions`, `file`, `port` and `signals` namespaces.

## Scoped arguments and comma escaping

Import the submodule as a namespace:

```ts
import * as permissions from '@okikio/deno/permissions';

const args = permissions.args({
	read: true,
	write: ['/srv/output', '/srv/tmp,1'],
	run: ['chromium'],
});
```

`args()` produces stable `--allow-*` arguments. Scoped values are deduplicated without reordering. Literal commas are
escaped by doubling them, matching Deno's CLI syntax for comma-delimited permission scopes.

`parse()` accepts only `--allow-*` arguments. It does not silently ignore command options or entrypoints. Repeated
scoped grants are merged. An unscoped grant wins over scoped grants for the same permission.

## Round-trip existing arguments

`parse()` is useful when a host receives permission arguments and needs a normalized grant model before composing
another command:

```ts
const grants = permissions.parse([
	'--allow-read=/srv/input,/srv/cache',
	'--allow-net=example.invalid:443',
]);

const canonical = permissions.args(grants);
```

An unscoped grant such as `--allow-read` dominates scoped grants for the same permission. Unsupported flags are rejected
instead of being silently ignored.

This package constructs permission arguments. It does not decide which permissions a particular executable should
receive. That policy stays with the executable owner.
