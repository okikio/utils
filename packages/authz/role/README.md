# Resolve a member's role, then check the picture

A role groups exact permission declarations, such as an editor's right to read assets. The application authenticates the
member and selects its canonical roles. Even an editor still needs the target policy: a read grant for one gallery does
not authorize every picture on the system.

Think of a role as a named set of candidate actions. `Editor` can include the `Read` permission, but the final policy
still decides which photo that member can read. The catalog maps a stored role name to a trusted definition; it does not
trust a request that simply claims `role: "editor"`.

The example first resolves membership, then builds a checker, then asks about two photos. It needs no login provider;
the hard-coded membership stands in for information your authenticated account lookup would supply.

From the `utils` checkout root, review `mise.toml` and run `mise trust`, `mise install`, and `mise run prepare -- --kind deps`.
Save the complete block as `gallery-role.ts` and run `mise exec -- deno run gallery-role.ts`. No server or database is needed.

```ts runnable=gallery-role.ts
import * as permission from '@okikio/authz/permission';
import * as role from '@okikio/authz/role';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
const TargetSchema = schema.object({ id: schema.string() });
const Read = permission.define({ id: 'asset.read', target: TargetSchema });
const Editor = role.define({ id: 'editor', permissions: [Read] });
const Roles = role.catalog('gallery', { Editor });
// This membership comes from the authenticated account, never from an untrusted URL.
const member = role.get(Roles, 'editor');
if (member === undefined) throw new Error('Unknown account role.');
// Role membership supplies candidate grants. The policy below also restricts the concrete target.
const checker = role.checker([member], {
	maximumRoles: 1,
	maximumGrants: 1,
	maximumChecks: 10,
	policy: (_ctx, request) => ({ allowed: TargetSchema.parse(request.target).id === 'photo-1' }),
});
await using owner = context.create({ id: 'gallery-request' });
const ctx = permission.scope(owner, { permissions: [Read], checker });
console.log(role.grants(Editor, Read));
console.log(await permission.check(ctx, Read, { id: 'photo-1' }));
console.log(await permission.check(ctx, Read, { id: 'photo-2' }));
```

```text output
true
true
false
```

The first answer is static membership: Editor includes the exact Read declaration. The next two are actual target
decisions through `permission.scope()`. Both granted requests invoke the mandatory policy; only photo-1 allows.
`role.get()` resolves an external role ID through trusted declarations. A caller-created object with the same ID is not
that declaration.

There are two distinct lookups. `role.get()` turns a stored membership ID into an exact role declaration; it makes no
access decision. `role.checker()` snapshots those trusted roles and combines their grants with `policy`. A missing grant
denies before the target policy runs. A grant only makes the target eligible for that policy, so the two photo checks can
still disagree. Create this actor-specific checker after resolving trusted membership, and replace it when membership changes.

Bounds count authored roles, grants including duplicates, and check requests. The adapter snapshots its grants, so
recreate it when membership changes. It owns no membership database, expiry or policy cache. Policy faults propagate;
missing access is not a reason to hide a broken provider as false. The operation owner closes its own lifetime at exit.

## Choose adjacent capabilities

Canonical permission objects belong in declarations. Authentication, external-ID lookup, membership, and the final
access decision remain application policy.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/authz/01-guide.md) explains the model, manual
alternatives, and composition.
