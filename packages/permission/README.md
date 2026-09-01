`@okikio/permission`
===================

Purpose
-------

A permission answers whether the current actor may perform one business action. A definition is import-safe metadata. It does not authenticate an actor or contact a policy provider.

Use `permissions.require()` to declare that an operation can need a permission. Use `permissions.check()` when denial is an ordinary branch. Use `permissions.assert()` when denial must stop the operation.

```ts
import * as permissions from '@okikio/permission';

const ReadAsset = permissions.define({
	id: 'asset.read',
	description: 'Read one asset.',
	target: AssetTargetSchema,
});

const permissionsCtx = permissions.scope(ctx, {
	permissions: [ReadAsset],
	checker,
});

if (await permissions.check(permissionsCtx, ReadAsset, { assetId })) {
	// The evaluator explicitly allowed the operation.
}

await permissions.assert(permissionsCtx, ReadAsset, { assetId });
```

`check()` returns `false` only for an explicit policy denial. Missing configuration, undeclared permissions, invalid targets, cancellation, deadlines, provider failures, and malformed provider responses throw instead of silently becoming denials.

Start here
----------

Keep business policy inside the evaluator when one permission already describes the real product action. For example, `asset.export` can internally account for workspace membership, ownership, administrator grants, legal holds, and organization policy.

Compose application checks only when one operation genuinely crosses independent authority questions:

```ts
const access = permissions.all(
	ImportMedia, // targetless definitions can participate directly
	permissions.on(ReadOrigin, { origin }),
	permissions.any(
		permissions.on(UseCredential, { credentialId }),
		permissions.on(ReadPublicSource, { origin }),
	),
);

await permissions.assert(permissionsCtx, access);
```

`all()` and `any()` describe boolean meaning. They do not define provider request order. The utility validates every atomic target and sends all leaves to the evaluator as one logical batch. A remote provider can then chunk that batch according to its own wire limit while preserving one logical authorization view.

A checker can return an error for one atomic decision without discarding successful decisions in the same logical batch. Composition remains fail closed without throwing away a decisive result: `any()` returns `true` when another branch explicitly allows, and `all()` returns `false` when another branch explicitly denies. If no decisive branch exists, the per-check error becomes `PermissionEvaluationError`. A whole-provider failure still rejects the checker call directly.

`not()` is deliberately absent. Negation interacts poorly with incomplete information and provider failures. Negative policy belongs in the policy evaluator where its complete authorization model is available.

Bulk checks
-----------

Use `batch()` when the caller needs the individual result for each object, such as filtering a page or accepting part of a bulk request.

```ts
const allowed = await permissions.batch(
	permissionsCtx,
	assets.map((asset) => permissions.on(ReadAsset, { assetId: asset.id })),
);
```

The `PermissionChecker` declares `maximumChecks`. This limit bounds the number of atomic checks in one logical operation. It is not a remote provider's wire batch size. A provider adapter can split one logical batch into several provider requests when required.

A typical single-resource operation should need one or a few logical checks. A bulk operation can legitimately need hundreds or thousands when each object has independent access policy. Do not authorize every HTTP resource or media packet independently when they inherit one already-authorized domain, origin, workspace, folder, or asset authority.

For example, importing 40 media items does not imply 40 checks for every policy dimension. If the items share one workspace and destination folder, reference six distinct origins, use three distinct credentials, and replace nine independently protected assets, the caller can reduce the operation to 20 meaningful checks: one workspace check, one folder check, six origin checks, three credential checks, and nine replacement checks. `batch()` or one `all()` expression sends those atomic decisions through one logical evaluator call. The provider can still split that call to match its own transport limits.

Targets
-------

A target schema belongs to the permission definition because the valid subject shape is part of the permission contract.

```ts
const ReadSource = permissions.define({
	id: 'source.read',
	target: SourceTargetSchema,
});
```

Omit `target` when the evaluator can derive the subject from the execution state that owns the check. A runtime-discovered target uses the schema and is validated before the evaluator sees it.

Scope and declaration safety
----------------------------

`permissions.scope()` creates a typed runtime view over an existing `@okikio/context` value. It borrows cancellation, deadline, clock, evaluator, and permission definitions. It owns no new lifetime and creates no hidden global registration. Permission and effect scopes use `context.view()`, so they can be nested without dropping each other's runtime fields.

Every runtime check must reference one exact permission definition declared by that scope. An undeclared dynamic check throws `UndeclaredPermissionError`. This preserves the architecture rule that static definitions describe everything runtime work can demand, even when the concrete target does not exist until later.

A shared resource must not cache one actor's permission answer. Create an actor-specific permission scope for the current use and evaluate actor-specific authority again when that use requires it.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `permission.define()` + `require()` | define permission identity and separately construct the requirement/interpreter metadata yourself | declaration stays separate from evaluation |
| `permission.all()` / `any()` | write recursive boolean composition and short-circuit evaluation manually | one explicit permission-expression tree |
| `check()` / `assert()` | resolve the checker from context, enforce evaluation limits, normalize provider errors, and convert deny to either boolean or exception | one evaluation contract for all callers |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/permission` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with a list of permission questions plus a host callback that answers each one.

The utility adds definitions, composition, scoped interpretation, batching, and consistent denial/error semantics.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Composition, interpretation, and expected errors
-----------------------------------------------

- `catalog()`, `select()`, and `compose()` build imported permission definition sets.
- `interpreter()` binds one permission family to the runtime checker that understands it.
- `MissingPermissionCheckerError` means no checker owns a requested permission family.
- `PermissionCheckLimitError` means one evaluation exceeded its configured check bound.
- `PermissionDecisionError` means a checker returned an invalid or contradictory decision.
- `PermissionDeniedError` is the explicit failure raised by `assert()` for a denied request.


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
