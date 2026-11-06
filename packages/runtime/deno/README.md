# `@okikio/runtime/deno`

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

An application wants a media command to read one input directory and run ffmpeg. Turn that policy into explicit Deno
arguments. Constructing the arguments neither grants permissions to this process nor launches the command.

These examples use the current experimental source checkout, not an assumed registry release. From the `utils`
repository root, review `mise.toml`, run `mise trust`, then `mise install` and `mise run prepare -- --kind deps`.
Save the following module as `example.ts` and run `mise exec -- deno run example.ts`.
[Checkout prerequisites](../../../README.md#work-on-the-repository) explain installing Mise.

```ts runnable
import * as permissions from '@okikio/runtime/deno/permissions';
// Create an argument list only; the executable still decides whether to start a child with these permissions.
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

## Launch a real child with the chosen grants

The earlier array describes policy. This two-file example actually starts a Deno child. Save `child.ts` and `launch.ts`
at the checkout root, then run `mise exec -- deno run --allow-run launch.ts`. The parent needs permission to launch
Deno; the child receives only the grants built below. Granting process launch is a trusted application boundary.

```ts support=child.ts
try {
	await Deno.readTextFile('private-input.txt');
	console.log('Unexpected read access');
} catch (error) {
	if (!(error instanceof Deno.errors.NotCapable)) throw error;
	console.log('Child cannot read files');
}
```

```ts support=launch.ts
import * as permissions from '@okikio/runtime/deno/permissions';
const grants = permissions.args({ read: false, net: false });
const child = new Deno.Command(Deno.execPath(), {
	args: ['run', '--no-prompt', ...grants, new URL('./child.ts', import.meta.url).pathname],
	stdout: 'piped',
	stderr: 'piped',
});
const result = await child.output();
if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
console.log(new TextDecoder().decode(result.stdout).trim());
```

Expected terminal output: `Child cannot read files`. The absent file is deliberate: permission rejection happens before
the filesystem read. `false` omits a grant; it is not an explicit denial flag. `output()` starts the child and joins its
exit while collecting output. That is appropriate for this tiny fixed-output program, not an unknown verbose process.
For bounded capture, cancellation, progress and retirement use [Process](../../worker/process/README.md). Permission
strings neither sandbox a native executable nor decide the host's trust policy.

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

For example, a launcher can use the first example's `args` as part of
`new Deno.Command(Deno.execPath(), { args: ['run', ...args, 'import.ts'] })`. Constructing `Deno.Command` describes the
command; `spawn()` or `output()` is the later action that starts it. The host chooses grants and owns the child process.

The other adapters have limits worth knowing before composing them. `file.write()` checks abort before work and before
rename; it does not interrupt an already-running filesystem call or promise crash durability. `port.get()` reports a
port that was free, not a reservation that stays held. Another process can bind it after return. Signal listeners are
process-wide and are installed only when you explicitly call `attach()`. File, port and signal operations need the
corresponding Deno runtime and permissions. See the [public source contracts](./mod.ts).

## Grant only the host capabilities the operation needs

- Use permission arguments at a [Process](../../worker/process/README.md) host boundary where a Deno executable is
  launched. The process host owns the launch; these strings describe that executable's grants.
- Use `deno/signals` with an owned [Context](../../context/README.md) for a command that must stop on a process signal.
  The context's cleanup removes attached listeners when that owner is disposed.

Use permission arguments when launching a child, file helpers for bounded filesystem operations, and port helpers when a
host needs a listener. These are explicit Deno adapters; portable algorithms belong in the other packages. Grant only
the capabilities your executable needs. Building an argument list does not grant the current process a permission.

[Choose related utilities by outcome](../../../docs/07-outcomes.md) when the host task needs another package.

The public submodules are `@okikio/runtime/deno/permissions`, `@okikio/runtime/deno/file`, `@okikio/runtime/deno/port`,
and `@okikio/runtime/deno/signals`, with their contracts in `@okikio/runtime/deno/types`. The root export also groups
the runtime operations as `permissions`, `file`, `port` and `signals` namespaces.

## Choose adjacent capabilities

Use the Deno adapter only at a host that actually supplies Deno capabilities. Worker owns the transport-neutral request
protocol; Activity and Workflow can compose that protocol without importing Deno host globals.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/packages/04-deno.md) explains the model, manual
alternatives, and composition.
