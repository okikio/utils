/**
 * Describe the actions an actor may perform, then ask the application's evaluator about a concrete target.
 * For example, a download can check permission to read one asset before returning its bytes.
 *
 * A permission names an action. A role groups permission definitions. Neither one authenticates a user or
 * proves that the user belongs to a role. The application supplies authentication, membership, and the
 * final access policy.
 *
 * @example
 * ```ts
 * import { permission, role } from '@okikio/authz';
 * const Read = permission.define({ id: 'dataset.read' });
 * const Editor = role.define({ id: 'editor', permissions: [Read] });
 * console.log(role.grants(Editor, Read));
 * ```
 * @module
 */
export * as permission from './permission/mod.ts';
export * as role from './role/mod.ts';

export * as entitlement from './entitlement/mod.ts';
