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

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](API.md).

## Run a complete example

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

## Purpose

`@okikio/deno` contains reusable Deno-specific mechanics that do not depend on a product domain.

The public submodules are `@okikio/deno/permissions`, `@okikio/deno/file`, `@okikio/deno/port`, and
`@okikio/deno/signals`, with their contracts in `@okikio/deno/types`. The root export also groups the runtime operations
as `permissions`, `file`, `port` and `signals` namespaces.

## Start here

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

## Convenience and the manual equivalent

| Convenience           | Manual equivalent                                                                                     | Concrete value                              |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `permissions.args()`  | sort permission names, merge repeated scopes, escape values, and emit the exact `--allow-*` arguments | deterministic Deno CLI permission arguments |
| `permissions.parse()` | tokenize Deno permission arguments and reconstruct normalized grants manually                         | one reversible permission vocabulary        |

`@okikio/deno` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with Deno.permissions
and Deno.Command permission flags directly.

The utility keeps permission names, grants, argument encoding, ordering, and merging deterministic.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.
