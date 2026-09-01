/**
 * Deno-specific reusable mechanics that do not depend on an application domain.
 *
 * Prefer submodule namespaces at call sites:
 *
 * ```ts
 * import * as permissions from '@okikio/deno/permissions';
 * ```
 *
 * @module
 */
export * as file from './file.ts';
export * as permissions from './permissions.ts';
export * as port from './port.ts';
export * as signals from './signals.ts';
export type { PermissionName, PermissionGrant, PermissionGrants } from './types.ts';
