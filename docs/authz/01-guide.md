# Decide whether this actor may read this picture

A signed-in person may read one picture and be denied another. Authentication supplies the person's identity;
authorization decides what that identity may do to a particular target. A permission names the question, its target
schema checks the object identity, and your checker supplies the answer from trusted application policy.

The gallery below grants the current actor access to `photo-1`. The handler checks access before returning any contents.
A declaration alone never protects a response.

## Return the picture or a denial

From the `utils` checkout root, review `mise.toml` and run `mise trust`, `mise install`, and `mise run prepare -- --kind deps`.
Save the complete block as `gallery.ts` and run `mise exec -- deno run gallery.ts`. No server or database is needed.

```ts runnable=gallery.ts
import * as context from '@okikio/context';
import * as permission from '@okikio/authz/permission';
import * as schema from '@okikio/schema';

// Declare the action and the shape of the picture it applies to.
const TargetSchema = schema.object({ id: schema.string() });
const Read = permission.define({ id: 'asset.read', target: TargetSchema });

// These grants represent one authenticated actor's trusted policy data.
const grants = new Set(['photo-1']);

await using owner = context.create({ id: 'asset-download' });
const ctx = permission.scope(owner, {
	permissions: [Read],
	checker: {
		maximumChecks: 10,
		/** Apply this demo actor's grants to each concrete asset target. Authentication happens elsewhere. */
		async check(_ctx, requests) {
			return requests.map((entry) => ({ allowed: grants.has(TargetSchema.parse(entry.target).id) }));
		},
	},
});

/** Check the target before returning its contents; denial must not enter the read path. */
async function download(id: string): Promise<Response> {
	if (!await permission.check(ctx, Read, { id })) return new Response('Forbidden', { status: 403 });
	return new Response(`Contents of ${id}`);
}
// Exercise both branches without starting a web server.
const allowed = await download('photo-1');
const denied = await download('photo-2');
console.log(allowed.status, await allowed.text());
console.log(denied.status, await denied.text());
```

```text output
200 Contents of photo-1
403 Forbidden
```

The `TargetSchema` requires a string ID. `Read` describes the business action. `permission.scope()` attaches that action
and checker to a borrowed operation lifetime; it does not start another operation. The checker receives a batch and
returns one answer per entry in the same order. Our local Set stands in for the current actor's trusted grants.
`download()` branches on the answer before constructing the protected response.

`await` waits for each permission decision. `await using owner` releases operation-owned cleanup at the block's end;
this scope borrows that owner's cancellation signal and clock. Replace the local grants with a real policy lookup at
the application boundary, never with a caller-supplied assertion that a picture is public.

```text
photo ID -> validate target -> checker -> true  -> return contents
                                      -> false -> return 403
                                      -> error -> fail without exposing contents
```

Read each row as one possible decision. The diagram omits authentication and storage, which the application supplies.
Change the requested ID to `photo-2` and it remains denied. A malformed target or broken checker throws rather than
pretending to be an ordinary denial. Use `assert()` when denial must throw before later work; `check()` is useful when
a normal 403 branch is clearer.

The setup separates three questions that must not be confused:

| Value | Question it answers | Why the application supplies it |
| --- | --- | --- |
| `Read` | Which action and target shape are being checked? | The same declaration can be shared by routes, documentation and policy. It contains no actor or decision. |
| `owner` | How long may this operation run? | Its Context carries cancellation and cleanup. Inside an existing request, use that request's Context instead of creating another owner. |
| `ctx` | Which checker and actions apply to this operation? | `permission.scope()` adds an actor-specific policy view while borrowing `owner`. It does not create a second cleanup owner. |

`maximumChecks: 10` accepts at most ten individual action/target questions in one logical call. It is not a limit of
ten requests over the owner's lifetime. The two calls above each ask one question. Choose the bound to match the
application's batch size and policy provider; it prevents an unexpectedly large expression from reaching the checker.
The checker remains explicit because the library cannot infer who owns a picture or which actor is trusted.

## Filter a gallery page with the same policy

Keep this block below the first program in `gallery.ts`. It reuses its exact `Read`, `ctx` and grants; it does not create
another policy. `batch()` returns answers in input order, so the filter preserves the gallery order.

```ts
const pictures = [{ id: 'photo-1' }, { id: 'photo-2' }];
const decisions = await permission.batch(ctx, pictures.map((picture) => permission.on(Read, picture)));
console.log(pictures.filter((_picture, index) => decisions[index]).map((picture) => picture.id));
// ['photo-1']
```

The next sections are policy reference and composition sketches. Every additional action must be declared in its
scope, with a real checker that understands its target. Do not copy an undefined application action as a grant.

## Combine independent access questions

Keep business policy inside the evaluator when one permission already describes the real product action. For example,
`asset.export` can internally account for workspace membership, ownership, administrator grants, legal holds, and
organization policy.

Compose application checks only when one operation genuinely crosses independent authority questions:

Append this to the gallery program. It asks whether both pictures are readable, or at least one is readable.

```ts
// Must this actor be able to read both pictures?
const both = permission.all(
	permission.on(Read, { id: 'photo-1' }),
	permission.on(Read, { id: 'photo-2' }),
);

// Is access to at least one picture enough?
const either = permission.any(
	permission.on(Read, { id: 'photo-1' }),
	permission.on(Read, { id: 'photo-2' }),
);
console.log(await permission.check(ctx, both)); // false
console.log(await permission.check(ctx, either)); // true
```

`all()` and `any()` describe boolean meaning. They do not define provider request order. The utility validates every
atomic target and sends all leaves to the evaluator as one logical batch. A remote provider can then chunk that batch
according to its own wire limit while preserving one logical authorization view.

A checker can return an error for one atomic decision without discarding successful decisions in the same logical batch.
Composition remains fail closed without throwing away a decisive result: `any()` returns `true` when another branch
explicitly allows, and `all()` returns `false` when another branch explicitly denies. If no decisive branch exists, the
per-check error becomes `PermissionEvaluationError`. A whole-provider failure still rejects the checker call directly.

A returned fault leaves that leaf unanswered; it is not an explicit denial. Use this table to read a combined result:

| Answers in the logical batch | `all()` | `any()` |
| --- | --- | --- |
| Every leaf allows | Allows | Allows |
| At least one denies; no faults | Denies | Allows if another leaf allows; otherwise denies |
| A fault and an explicit denial | Denies | Throws unless another leaf allows |
| A fault and an explicit allow | Throws unless another leaf denies | Allows |
| Only faults | Throws | Throws |

This table covers valid returned decisions. Invalid targets, malformed checker responses, missing configuration and a
checker that throws reject the call; they are not extra false leaves.

`not()` is deliberately absent. Negation interacts poorly with incomplete information and provider failures. Negative
policy belongs in the policy evaluator where its complete authorization model is available.

## Bulk checks

Use `batch()` when the caller needs the individual result for each object, such as filtering a page or accepting part of
a bulk request.

The gallery filter above is the complete bulk example. It uses `{ id }`, exactly as `TargetSchema` declares; do not
substitute a differently named property just because an application's storage model uses one.

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

`Read` already declares `TargetSchema`, so `permission.on(Read, { id: 'photo-1' })` supplies a checked target.
`{ assetId: 'photo-1' }` would not satisfy this contract.

Leave out `target` if the checker can find it in the current request. If the request supplies the target later,
the permission code checks it against the schema before giving it to the checker.

## Scope and declaration safety

Call `permission.scope()` to give the current operation a permission checker and the definitions it may check.
The resulting view still uses the same context, clock, deadline, and cancellation signal. It creates no new
lifetime or global registration. Permission and effect scopes both use `context.view()`, so either can wrap the
other without losing its fields.

Every runtime check must reference one exact permission definition declared by that scope. An undeclared dynamic check
throws `UndeclaredPermissionError`. This preserves the architecture rule that static definitions describe everything
runtime work can demand, even when the concrete target does not exist until later.

A shared resource must not cache one actor's permission answer. Create an actor-specific permission scope for the
current use and evaluate actor-specific authority again when that use requires it.

## Composition, interpretation, and expected errors

- `catalog()`, `select()`, and `compose()` build imported permission definition sets.
- `interpreter()` binds one permission family to the runtime checker that understands it.
- `MissingPermissionCheckerError` means no checker owns a requested permission family.
- `PermissionCheckLimitError` means one evaluation exceeded its configured check bound.
- `PermissionDecisionError` means a checker returned an invalid or contradictory decision.
- `PermissionDeniedError` is the explicit failure raised by `assert()` for a denied request.

Read the [public source](../../packages/authz/permission/mod.ts) for the complete exported contracts and field
descriptions.

## Group permissions into roles

Start with the [package example](../../packages/authz/role/README.md). Roles and permissions share the authorization
package. Read the permission chapters before binding an application policy.

Definitions and their permission arrays are frozen snapshots. `get` resolves external IDs back to trusted catalog
entries. `grants` uses exact declaration identity: recreating an object with the same ID does not grant access.
Duplicate permission identities reject at definition time. Import the canonical declarations wherever they are needed.

The package supplies no authentication, user membership, inheritance, persistence or authorization bypass. Applications
own those decisions and interpret permission requirements through their configured checker.

## Without this utility

Keep a canonical set of permission objects. Create role objects that refer to that set. Copy and freeze each permission
array. Resolve an external role ID through a trusted map before checking grants. Comparing an arbitrary object's ID is
insufficient for this package's identity contract. The utility owns declaration checks and catalog operations; the
application owns authenticated membership and the final access decision.

## Decide which bookkeeping to keep in your application

| Convenience                         | Manual equivalent                                                                                                                       | Concrete value                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `permission.define()` + `require()` | define permission identity and separately construct the requirement/interpreter metadata yourself                                       | declaration stays separate from evaluation |
| `permission.all()` / `any()`        | build a boolean tree, validate all target leaves, batch evaluator questions, then combine decisions and errors                          | one explicit permission-expression tree    |
| `check()` / `assert()`              | resolve the checker from context, enforce evaluation limits, normalize provider errors, and convert deny to either boolean or exception | one evaluation contract for all callers    |

`@okikio/authz/permission` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with a
list of permission questions plus a host callback that answers each one.

The utility adds definitions, composition, scoped interpretation, batching, and consistent denial/error semantics.
