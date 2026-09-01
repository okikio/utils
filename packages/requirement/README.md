`@okikio/requirement`
====================

Purpose
-------

`@okikio/requirement` is the provider-neutral declaration and activation seam for
policy families such as permissions and entitlements.

Start here
----------

A requirement connects one generic family/action to an exact domain definition:

```ts
import * as requirement from '@okikio/requirement';

const FileRead = Object.freeze({
  id: 'capability:file-read',
  kind: 'capability',
  description: 'Read one caller-selected file.',
});

const RequiredFileRead = requirement.define({
  family: 'permission',
  action: 'require',
  definition: FileRead,
});

console.log(requirement.document(RequiredFileRead));
```

The requirement itself does not know how `permission` works. The host supplies
the family interpreter at runtime.

Activate through an interpreter
-------------------------------

```ts
import * as context from '@okikio/context';

await using base = context.create({ id: 'example' });
const ctx = requirement.scope(base, {
  interpreters: {
    permission: {
      async apply(_ctx, entries) {
        console.log('apply', entries.map((entry) => entry.definition.id));
      },
    },
  },
});

await requirement.apply(ctx, RequiredFileRead);
```

Unknown active families reject by default. A permissive test host must opt into
`unknown: 'ignore'` explicitly.

A requirement has one family, action, and exact definition identity. It does
not contain a policy engine.

The runtime keeps three views distinct:

- **direct**: declared by the exact definition that is active now;
- **reachable**: can occur through referenced activities, workflows, or
  resources;
- **active**: must be interpreted at this execution point.

`requirements.bind()` attaches family-specific runtime views from reachable
metadata without activating it. `requirements.apply()` is the only operation
that interprets active requirements.

Unknown active families reject by default:

```ts
const ctx = requirements.scope(parent, {
  interpreters: {
    permission: permissions.interpreter(checker),
  },
  unknown: 'reject',
});
```

A deliberately permissive test or observational host can set
`unknown: 'ignore'`. Omission never silently disables an active requirement
family.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `requirement.define()` | freeze requirement identity/family/data metadata and validate stable IDs yourself | one provider-neutral capability dependency |
| `scope()` / `bind()` | resolve interpreters, attach the runtime to context, and preserve allowed requirement families manually | declarations become live behavior only at a host boundary |
| `document()` | walk composed requirements and build documentation metadata yourself | same definitions power runtime and docs |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/requirement` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with immutable requirement records grouped by family and an explicit switch that interprets active entries.

The utility adds reachability, scoping, family composition, and fail-closed handling for unknown active requirements.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Composition and unsupported requirements
----------------------------------------

`compose()` flattens requirement definitions/sets without activating providers.
`UnsupportedRequirementError` is raised when active interpretation uses the
`reject` policy and no configured interpreter owns the requirement family.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
