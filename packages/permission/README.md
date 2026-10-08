# `@okikio/permission`

Imagine a gallery where anyone can read public pictures, while private pictures need an explicit grant.
`@okikio/permission` asks a configured policy evaluator whether an action is allowed for a particular target and makes
that decision available as `true`, `false`, or an error. You avoid scattered checks that accidentally authorize
different objects under the same action name.

A **permission** names an action, such as `asset.read`. A **target** identifies the object involved. The **checker** is
application-supplied code that knows the actor and access policy. Declaring a permission does not authenticate anyone or
restrict the operating system by itself.

```text
Caller wants asset.read on { id: "public" }
                  |
                  v
Validate target -> configured checker -> true: caller may continue
                                         false: caller must deny
                                         error: check did not succeed
```

This shows one ordinary check. `check()` reports a decision; the application must branch on it, or use `assert()` to
stop denied work. A missing or broken checker throws rather than silently producing an ordinary denial.

## Ask whether a picture can be read

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as permission from '@okikio/permission';
import { z } from 'zod';
const TargetSchema = z.object({ id: z.string() });
const Read = permission.define({ id: 'asset.read', target: TargetSchema });
await using owner = context.create({ id: 'reader' });
const ctx = permission.scope(owner, {
	permissions: [Read],
	checker: {
		maximumChecks: 10,
		async check(_ctx, requests) {
			return requests.map((entry) => ({ allowed: TargetSchema.safeParse(entry.target).data?.id === 'public' }));
		},
	},
});
console.log(await permission.check(ctx, Read, { id: 'public' }));
console.log(await permission.check(ctx, Read, { id: 'private' }));
```

Expected output:

```text output
true
false
```

## Read the mini-demo

The demo's checker implements one deliberately small rule: an ID equal to `public` is allowed. The two inputs
`{ id: 'public' }` and `{ id: 'private' }` therefore print `true` and `false`. No login service or database is involved.
Try another string ID and it remains denied. In a real gallery, the checker must incorporate the authenticated actor and
the application's complete policy rather than trusting the caller to label an asset public.

The familiar application code is still `if (await permission.check(...)) { ... }`. The extra definitions make the
question consistent across callers and validate the target before evaluating policy. A Context here is the caller's
operation identity, cancellation signal, clock, and cleanup owner. `permission.scope()` borrows that lifetime and
attaches the allowed actions and checker; it does not log in a user or start a separate runtime.

| Contract                                 | What crosses the boundary                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `PermissionDefinition`                   | A stable `id`, optional target schema, and `kind: 'permission'`.                               |
| `PermissionRequest`                      | The exact `definition` and its schema-validated `target`.                                      |
| `PermissionChecker.check(ctx, requests)` | Returns one decision for every request, in matching order.                                     |
| `PermissionDecision`                     | `{ allowed: true }`, `{ allowed: false }`, or `{ error }`, with optional denial/allow reasons. |
| `permission.check()`                     | `Promise<boolean>`; target, declaration, or checker failures reject.                           |
| `permission.assert()`                    | `Promise<void>`; denial rejects before protected work continues.                               |

Under the hood, a check verifies that the exact action was declared, validates its target, collects the atomic
questions, enforces `maximumChecks`, calls the checker, and evaluates the returned decisions. The batch interface lets a
database-backed checker evaluate a page of assets together. The package owns valid questions and decision shape; the
application owns who the actor is and what its policy means. The [contract reference](API.md) covers expressions such as
`all()` and `any()` when one boolean question is no longer enough.

## Use that decision in an ordinary HTTP response

This complete version demonstrates the actual protected outcome. An allowed request returns the file text; a denied
request returns status 403. It uses the standard `Response` class and starts no HTTP listener.

```ts runnable=protected-response.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as permission from '@okikio/permission';
import { z } from 'zod';
const TargetSchema = z.object({ id: z.string() });
const Read = permission.define({ id: 'asset.read', target: TargetSchema });
const grants = new Set(['photo-1']);
await using owner = context.create({ id: 'asset-download' });
const ctx = permission.scope(owner, {
	permissions: [Read],
	checker: {
		maximumChecks: 10,
		async check(_ctx, requests) {
			return requests.map((entry) => ({ allowed: grants.has(TargetSchema.parse(entry.target).id) }));
		},
	},
});
async function download(id: string): Promise<Response> {
	if (!await permission.check(ctx, Read, { id })) return new Response('Forbidden', { status: 403 });
	return new Response(`Contents of ${id}`);
}
const allowed = await download('photo-1');
const denied = await download('photo-2');
console.log(allowed.status, await allowed.text());
console.log(denied.status, await denied.text());
```

```text output
200 Contents of photo-1
403 Forbidden
```

The grants are local policy data for this example. In a service, build them from trusted actor and object information;
letting a request choose its own grants would defeat the check. The utility cannot repair an incorrect policy.

- **Protect a download:** define the read action in [Endpoint](../server/endpoint/README.md), bind a checker in the
  [Service](../server/service/README.md), and assert access after resolving the actual asset. Then deliver bytes through
  [HTTP Response](../http/response/README.md). A declaration alone does not protect that response.
- **Filter a search page:** check targets in a batch, return only allowed records, and use
  [Telemetry](../telemetry/README.md) for diagnostics. Reporter success must never become the authority for permission
  decisions.

## Build on the example

Start with one target, combine all()/any() expressions, then provide a provider-backed checker at the application root.
Declare reachable permissions for inspection but explicitly check the current target on each active path. Unknown or
undeclared definitions fail closed. This example evaluator implements a tiny public-asset rule; it does not authenticate
the caller or authorize every possible asset.

## Purpose

A permission answers whether the current actor may perform one business action. A definition is import-safe metadata. It
does not authenticate an actor or contact a policy provider.

Use `permissions.require()` to declare that an operation can need a permission. Use `permissions.check()` when denial is
an ordinary branch. Use `permissions.assert()` when denial must stop the operation.

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

`check()` returns `false` only for an explicit policy denial. Missing configuration, undeclared permissions, invalid
targets, cancellation, deadlines, provider failures, and malformed provider responses throw instead of silently becoming
denials.

## Start here

Keep business policy inside the evaluator when one permission already describes the real product action. For example,
`asset.export` can internally account for workspace membership, ownership, administrator grants, legal holds, and
organization policy.

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

`all()` and `any()` describe boolean meaning. They do not define provider request order. The utility validates every
atomic target and sends all leaves to the evaluator as one logical batch. A remote provider can then chunk that batch
according to its own wire limit while preserving one logical authorization view.

A checker can return an error for one atomic decision without discarding successful decisions in the same logical batch.
Composition remains fail closed without throwing away a decisive result: `any()` returns `true` when another branch
explicitly allows, and `all()` returns `false` when another branch explicitly denies. If no decisive branch exists, the
per-check error becomes `PermissionEvaluationError`. A whole-provider failure still rejects the checker call directly.

`not()` is deliberately absent. Negation interacts poorly with incomplete information and provider failures. Negative
policy belongs in the policy evaluator where its complete authorization model is available.

## Bulk checks

Use `batch()` when the caller needs the individual result for each object, such as filtering a page or accepting part of
a bulk request.

```ts
const allowed = await permissions.batch(
	permissionsCtx,
	assets.map((asset) => permissions.on(ReadAsset, { assetId: asset.id })),
);
```

The `PermissionChecker` declares `maximumChecks`. This limit bounds the number of atomic checks in one logical
operation. It is not a remote provider's wire batch size. A provider adapter can split one logical batch into several
provider requests when required.

A typical single-resource operation should need one or a few logical checks. A bulk operation can legitimately need
hundreds or thousands when each object has independent access policy. Do not authorize every HTTP resource or media
packet independently when they inherit one already-authorized domain, origin, workspace, folder, or asset authority.

For example, importing 40 media items does not imply 40 checks for every policy dimension. If the items share one
workspace and destination folder, reference six distinct origins, use three distinct credentials, and replace nine
independently protected assets, the caller can reduce the operation to 20 meaningful checks: one workspace check, one
folder check, six origin checks, three credential checks, and nine replacement checks. `batch()` or one `all()`
expression sends those atomic decisions through one logical evaluator call. The provider can still split that call to
match its own transport limits.

## Targets

A target schema belongs to the permission definition because the valid subject shape is part of the permission contract.

```ts
const ReadSource = permissions.define({
	id: 'source.read',
	target: SourceTargetSchema,
});
```

Omit `target` when the evaluator can derive the subject from the execution state that owns the check. A
runtime-discovered target uses the schema and is validated before the evaluator sees it.

## Scope and declaration safety

`permissions.scope()` creates a typed runtime view over an existing `@okikio/context` value. It borrows cancellation,
deadline, clock, evaluator, and permission definitions. It owns no new lifetime and creates no hidden global
registration. Permission and effect scopes use `context.view()`, so they can be nested without dropping each other's
runtime fields.

Every runtime check must reference one exact permission definition declared by that scope. An undeclared dynamic check
throws `UndeclaredPermissionError`. This preserves the architecture rule that static definitions describe everything
runtime work can demand, even when the concrete target does not exist until later.

A shared resource must not cache one actor's permission answer. Create an actor-specific permission scope for the
current use and evaluate actor-specific authority again when that use requires it.

## Convenience and the manual equivalent

| Convenience                         | Manual equivalent                                                                                                                       | Concrete value                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `permission.define()` + `require()` | define permission identity and separately construct the requirement/interpreter metadata yourself                                       | declaration stays separate from evaluation |
| `permission.all()` / `any()`        | build a boolean tree, validate all target leaves, batch evaluator questions, then combine decisions and errors                          | one explicit permission-expression tree    |
| `check()` / `assert()`              | resolve the checker from context, enforce evaluation limits, normalize provider errors, and convert deny to either boolean or exception | one evaluation contract for all callers    |

`@okikio/permission` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with a list of
permission questions plus a host callback that answers each one.

The utility adds definitions, composition, scoped interpretation, batching, and consistent denial/error semantics.

## Composition, interpretation, and expected errors

- `catalog()`, `select()`, and `compose()` build imported permission definition sets.
- `interpreter()` binds one permission family to the runtime checker that understands it.
- `MissingPermissionCheckerError` means no checker owns a requested permission family.
- `PermissionCheckLimitError` means one evaluation exceeded its configured check bound.
- `PermissionDecisionError` means a checker returned an invalid or contradictory decision.
- `PermissionDeniedError` is the explicit failure raised by `assert()` for a denied request.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

Read the [generated API reference](API.md) for the complete exported contracts and field descriptions.
