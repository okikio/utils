/**
 * Express Deno permission grants as data and convert them to correctly escaped CLI arguments. Hand-built flags can accidentally grant a whole directory or mishandle paths containing commas.
 *
 * Use permission arguments when launching a child, file helpers for bounded filesystem operations, and port helpers when a host needs a listener. These are explicit Deno adapters; portable algorithms belong in the other packages. Grant only the capabilities your executable needs. Building an argument list does not grant the current process a permission.
 *
 * @example
 * ```ts
 * import * as permissions from '@okikio/deno/permissions';
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
