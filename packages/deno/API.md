# @okikio/deno contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                     | Source                               | Reference                   |
| -------------------------- | ------------------------------------ | --------------------------- |
| `@okikio/deno`             | [./mod.ts](./mod.ts)                 | [root](#root)               |
| `@okikio/deno/file`        | [./file.ts](./file.ts)               | [file](#file)               |
| `@okikio/deno/permissions` | [./permissions.ts](./permissions.ts) | [permissions](#permissions) |
| `@okikio/deno/port`        | [./port.ts](./port.ts)               | [port](#port)               |
| `@okikio/deno/signals`     | [./signals.ts](./signals.ts)         | [signals](#signals)         |
| `@okikio/deno/types`       | [./types.ts](./types.ts)             | [types](#types)             |

## root

Import `@okikio/deno`. [Source](./mod.ts).

Express Deno permission grants as data and convert them to correctly escaped CLI arguments. Hand-built flags can
accidentally grant a whole directory or mishandle paths containing commas.

Use permission arguments when launching a child, file helpers for bounded filesystem operations, and port helpers when a
host needs a listener. These are explicit Deno adapters; portable algorithms belong in the other packages. Grant only
the capabilities your executable needs. Building an argument list does not grant the current process a permission.

### root: file

[Declaration source](mod.ts#L14)

````text
namespace file
  Express Deno permission grants as data and convert them to correctly escaped CLI arguments. Hand-built flags can accidentally grant a whole directory or mishandle paths containing commas.

  Use permission arguments when launching a child, file helpers for bounded filesystem operations, and port helpers when a host needs a listener. These are explicit Deno adapters; portable algorithms belong in the other packages. Grant only the capabilities your executable needs. Building an argument list does not grant the current process a permission.

  @example
      ```ts
      import * as permissions from '@okikio/deno/permissions';
      const args = permissions.args({ read: ['/srv/input'], run: ['ffmpeg'] });
      console.log(JSON.stringify(args));
      ```

  @module

  reference write: ./packages/deno/file.ts:10:1
    Atomically replace one file by writing a same-directory temporary file first.

    Same-directory rename keeps the final publication on one filesystem. The
    caller owns the semantic contract for the bytes; this utility owns only the
    generic write/rename cleanup mechanics.
````

### root: permissions

[Declaration source](mod.ts#L16)

````text
namespace permissions
  Explicit Deno permission descriptors and CLI argument conversion.

  reference args: ./packages/deno/permissions.ts:50:1
    Build canonical `--allow-*` arguments for one Deno subprocess.

    Scoped values are deduplicated without reordering them. Literal commas are
    escaped using Deno's doubled-comma CLI syntax.

    @example
        ```ts
        import * as permissions from '@okikio/deno/permissions';

        const args = permissions.args({
          read: true,
          write: ['/srv/output', '/srv/tmp,1'],
          run: ['chromium'],
        });
        ```

  reference allow: ./packages/deno/permissions.ts:61:1
    Build one canonical Deno `--allow-*` argument.
  reference parse: ./packages/deno/permissions.ts:73:1
    Parse permission arguments produced by {@link args} or equivalent Deno CLI syntax.

    The function accepts only `--allow-*` arguments. Pass command options and the
    entrypoint separately so unexpected input cannot be silently ignored.
  reference encodeList: ./packages/deno/permissions.ts:100:1
    Encode one scoped Deno permission list.
  reference decodeList: ./packages/deno/permissions.ts:107:1
    Decode one scoped Deno permission list.
  reference PermissionGrant: ./packages/deno/permissions.ts:153:15
  reference PermissionGrants: ./packages/deno/permissions.ts:153:32
  reference PermissionName: ./packages/deno/permissions.ts:153:50
````

### root: port

[Declaration source](mod.ts#L18)

```text
namespace port
  Deno TCP port discovery for a short, caller-owned handoff.

  reference get: ./packages/deno/port.ts:8:1
    Reserve an unused TCP port long enough to discover its assigned number.

    The listener closes before this function returns. The caller must bind the
    returned port immediately because another process can claim it afterward.
    Use this only for local child-process handoffs where the caller controls the
    short interval between discovery and bind.
```

### root: signals

[Declaration source](mod.ts#L19)

```text
namespace signals
  Deno process-signal integration for owned operation contexts.

  The context remains the lifetime owner. Signal listeners are removed through
  the context's cleanup stack, so executable roots do not repeat listener
  registration and `try/finally` cleanup.

  @module

  reference AttachOptions: ./packages/deno/signals.ts:12:1
    Options for attaching process stop signals to one owned context.
  reference attach: ./packages/deno/signals.ts:25:1
    Attach SIGINT and, by default, SIGTERM to one owned context.

    Listener cleanup is registered on the same context, so disposing the context
    always releases the process-global listeners.
```

### root: PermissionGrant

[Declaration source](mod.ts#L20)

```text
reference PermissionGrant: ./packages/deno/types.ts:4:1
```

### root: PermissionGrants

[Declaration source](mod.ts#L20)

```text
reference PermissionGrants: ./packages/deno/types.ts:7:1
```

### root: PermissionName

[Declaration source](mod.ts#L20)

```text
reference PermissionName: ./packages/deno/types.ts:1:1
```

## file

Import `@okikio/deno/file`. [Source](./file.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source                                 |
| ---------------- | -------------------------------------------------------- |
| `basename`       | [External source](https://jsr.io/@std/path/1.1.6/mod.ts) |
| `dirname`        | [External source](https://jsr.io/@std/path/1.1.6/mod.ts) |
| `join`           | [External source](https://jsr.io/@std/path/1.1.6/mod.ts) |

### file: write

[Declaration source](file.ts#L10)

```text
async function write(path: string, contents: string | Uint8Array, options: Readonly<{ signal?: AbortSignal; }>): Promise<void>
  Atomically replace one file by writing a same-directory temporary file first.

  Same-directory rename keeps the final publication on one filesystem. The
  caller owns the semantic contract for the bytes; this utility owns only the
  generic write/rename cleanup mechanics.
```

## permissions

Import `@okikio/deno/permissions`. [Source](./permissions.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source |
| ------------------ | ------------------------ |
| `PermissionGrant`  | [Source](types.ts)       |
| `PermissionGrants` | [Source](types.ts)       |
| `PermissionName`   | [Source](types.ts)       |

### permissions: allow

[Declaration source](permissions.ts#L61)

```text
function allow(name: PermissionName, grant: Exclude<PermissionGrant, false>): string
  Build one canonical Deno `--allow-*` argument.
```

### permissions: args

[Declaration source](permissions.ts#L50)

````text
function args(grants: PermissionGrants): readonly string[]
  Build canonical `--allow-*` arguments for one Deno subprocess.

  Scoped values are deduplicated without reordering them. Literal commas are
  escaped using Deno's doubled-comma CLI syntax.

  @example
      ```ts
      import * as permissions from '@okikio/deno/permissions';

      const args = permissions.args({
        read: true,
        write: ['/srv/output', '/srv/tmp,1'],
        run: ['chromium'],
      });
      ```
````

### permissions: decodeList

[Declaration source](permissions.ts#L107)

```text
function decodeList(value: string): readonly string[]
  Decode one scoped Deno permission list.
```

### permissions: encodeList

[Declaration source](permissions.ts#L100)

```text
function encodeList(values: Iterable<string>): string
  Encode one scoped Deno permission list.
```

### permissions: parse

[Declaration source](permissions.ts#L73)

```text
function parse(input: Iterable<string>): PermissionGrants
  Parse permission arguments produced by {@link args} or equivalent Deno CLI syntax.

  The function accepts only `--allow-*` arguments. Pass command options and the
  entrypoint separately so unexpected input cannot be silently ignored.
```

### permissions: PermissionGrant

[Declaration source](permissions.ts#L153)

```text
reference PermissionGrant: ./packages/deno/types.ts:4:1
```

### permissions: PermissionGrants

[Declaration source](permissions.ts#L153)

```text
reference PermissionGrants: ./packages/deno/types.ts:7:1
```

### permissions: PermissionName

[Declaration source](permissions.ts#L153)

```text
reference PermissionName: ./packages/deno/types.ts:1:1
```

## port

Import `@okikio/deno/port`. [Source](./port.ts).

### port: get

[Declaration source](port.ts#L8)

```text
function get(hostname: string): number
  Reserve an unused TCP port long enough to discover its assigned number.

  The listener closes before this function returns. The caller must bind the
  returned port immediately because another process can claim it afterward.
  Use this only for local child-process handoffs where the caller controls the
  short interval between discovery and bind.
```

## signals

Import `@okikio/deno/signals`. [Source](./signals.ts).

Deno process-signal integration for owned operation contexts.

The context remains the lifetime owner. Signal listeners are removed through the context's cleanup stack, so executable
roots do not repeat listener registration and `try/finally` cleanup.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source               |
| ---------------- | -------------------------------------- |
| `context`        | [context contracts](../context/API.md) |

### signals: attach

[Declaration source](signals.ts#L25)

```text
function attach(ctx: context.Owned, options: AttachOptions): void
  Attach SIGINT and, by default, SIGTERM to one owned context.

  Listener cleanup is registered on the same context, so disposing the context
  always releases the process-global listeners.
```

### signals: AttachOptions

[Declaration source](signals.ts#L12)

```text
interface AttachOptions
  Options for attaching process stop signals to one owned context.

  readonly message?: string
    Human-readable cancellation reason projected into the context.
  readonly term?: boolean
    Whether SIGTERM should be observed where the runtime supports it.
```

## types

Import `@okikio/deno/types`. [Source](./types.ts).

### types: PermissionGrant

[Declaration source](types.ts#L4)

```text
type PermissionGrant = boolean | readonly string[]
  One permission grant. `true` is unscoped; a list grants only the listed values.
```

### types: PermissionGrants

[Declaration source](types.ts#L7)

```text
type PermissionGrants = Readonly<Partial<Record<PermissionName, PermissionGrant>>>
  Permission grants used when constructing one Deno subprocess command.
```

### types: PermissionName

[Declaration source](types.ts#L1)

```text
type PermissionName = "read" | "write" | "net" | "env" | "sys" | "run" | "ffi" | "import"
  Deno permission names that can be granted through `--allow-*` CLI flags.
```
