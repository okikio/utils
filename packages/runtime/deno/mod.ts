/**
 * Describe the host permissions a Deno child needs and turn them into CLI arguments.
 * Deno restricts file, network and process operations through explicit grants. Keeping the
 * grant plan as data avoids hand-built flags that mishandle paths containing commas.
 *
 * The application chooses grants and owns launching the child. Building an argument list
 * does not change the current process's permissions. Use the file, port and signal subpaths
 * only in a Deno host that supplies those capabilities; portable algorithms need no Deno globals.
 *
 * @example
 * ```ts
 * import * as permissions from '@okikio/runtime/deno/permissions';
 * const args = permissions.args({ read: ['/srv/input'], run: ['ffmpeg'] });
 * console.log(JSON.stringify(args));
 * ```
 *
 * @module
 */
export * as file from './file.ts';
/** Explicit Deno permission descriptors and CLI argument conversion. */
export * as permissions from './permissions.ts';
/** Deno TCP port discovery for a short, caller-owned handoff. */
export * as port from './port.ts';
export * as signals from './signals.ts';
export type { PermissionGrant, PermissionGrants, PermissionName } from './types.ts';
