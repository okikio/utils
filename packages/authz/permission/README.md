# `@okikio/authz/permission`

Imagine a gallery where anyone can read public pictures, while private pictures need an explicit grant.
`@okikio/authz/permission` asks a configured policy evaluator whether an action is allowed for a particular target and
makes that decision available as `true`, `false`, or an error. You avoid scattered checks that accidentally authorize
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

The setup separates three questions that must not be confused:

| Value | Question it answers | Why the application supplies it |
| --- | --- | --- |
| `Read` | Which action and target shape are being checked? | The same declaration can be shared by routes, documentation and policy. It contains no actor or decision. |
| `owner` | How long may this operation run? | Its Context carries cancellation and cleanup. Inside an existing request, use that request's Context instead of creating another owner. |
| `ctx` | Which checker and actions apply to this operation? | `permission.scope()` adds an actor-specific policy view while borrowing `owner`. It does not create a second cleanup owner. |

`maximumChecks: 10` accepts at most ten individual action/target questions in one logical call. It is not a limit of
ten requests over the owner's lifetime. The two calls in the example each ask one question. Choose the bound to match the
application's batch size and policy provider; it prevents an unexpectedly large expression from reaching the checker.
The checker remains explicit because the library cannot infer who owns a picture or which actor is trusted.

## Ask whether a picture can be read

These examples use the current experimental source checkout, not an assumed registry release. From the `utils`
repository root, review `mise.toml`, run `mise trust`, then `mise install` and `mise run prepare -- --kind deps`.
Save the following module as `example.ts` and run `mise exec -- deno run example.ts`.
[Checkout prerequisites](../../../README.md#work-on-the-repository) explain installing Mise.

```ts runnable
import * as context from '@okikio/context';
import * as permission from '@okikio/authz/permission';
import * as schema from '@okikio/schema';
const TargetSchema = schema.object({ id: schema.string() });
const Read = permission.define({ id: 'asset.read', target: TargetSchema });
await using owner = context.create({ id: 'reader' });
const ctx = permission.scope(owner, {
	permissions: [Read],
	checker: {
		maximumChecks: 10,
		async check(_ctx, requests) {
			return requests.map((entry) => ({ allowed: TargetSchema.parse(entry.target).id === 'public' }));
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

## Follow the two target decisions

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
application owns who the actor is and what its policy means. The [public source contracts](./mod.ts) covers expressions
such as `all()` and `any()` when one boolean question is no longer enough.

## Use that decision in an ordinary HTTP response

This complete version demonstrates the actual protected outcome. An allowed request returns the file text; a denied
request returns status 403. It uses the standard `Response` class and starts no HTTP listener.

```ts runnable=protected-response.ts
import * as context from '@okikio/context';
import * as permission from '@okikio/authz/permission';
import * as schema from '@okikio/schema';
const TargetSchema = schema.object({ id: schema.string() });
const Read = permission.define({ id: 'asset.read', target: TargetSchema });
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

- **Protect a download:** define the read action in [Endpoint](../../server/endpoint/README.md), bind a checker in the
  [Service](../../server/service/README.md), and assert access after resolving the actual asset. Then deliver bytes
  through [HTTP Response](../../http/response/README.md). A declaration alone does not protect that response.
- **Filter a search page:** check targets in a batch, return only allowed records, and use
  [Telemetry](../../telemetry/README.md) for diagnostics. Reporter success must never become the authority for
  permission decisions.

## Supply the real actor and policy

Start with one target, combine all()/any() expressions, then provide a provider-backed checker at the application root.
Declare reachable permissions for inspection but explicitly check the current target on each active path. Unknown or
undeclared definitions fail closed. This example evaluator implements a tiny public-asset rule; it does not authenticate
the caller or authorize every possible asset.

## Choose adjacent capabilities

The application supplies authenticated identity and the evaluator. Role groups trusted declarations; Entitlement
describes feature access rather than membership.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/authz/01-guide.md) explains the model, manual
alternatives, and composition.
