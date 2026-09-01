/** Deno permission names that can be granted through `--allow-*` CLI flags. */
export type PermissionName = 'read' | 'write' | 'net' | 'env' | 'sys' | 'run' | 'ffi' | 'import';

/** One permission grant. `true` is unscoped; a list grants only the listed values. */
export type PermissionGrant = boolean | readonly string[];

/** Permission grants used when constructing one Deno subprocess command. */
export type PermissionGrants = Readonly<Partial<Record<PermissionName, PermissionGrant>>>;
