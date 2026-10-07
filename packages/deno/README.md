# `@okikio/deno`

Express Deno permission grants as data and convert them to correctly escaped CLI arguments. Hand-built flags can
accidentally grant a whole directory or mishandle paths containing commas.

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

## Build on the example

Use permission arguments when launching a child, file helpers for bounded filesystem operations, and port helpers when a
host needs a listener. These are explicit Deno adapters; portable algorithms belong in the other packages. Grant only
the capabilities your executable needs. Building an argument list does not grant the current process a permission.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/deno` contains reusable Deno-specific mechanics that do not depend on a product domain.

The current public submodule is `@okikio/deno/permissions`.

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
