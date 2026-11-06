# `@okikio/capability/requirement`

One report may need account access, an enabled export feature, and a quota check. `@okikio/capability/requirement` lets
the report declare those needs without embedding a particular billing or authorization SDK in its definition. The
application supplies the code that evaluates each kind of rule when the work reaches it.

A **family** groups rules with the same meaning, such as permission or entitlement. An **interpreter** is host-supplied
code that evaluates a family. **Declaring** a requirement records a need; **applying** it invokes the interpreter.

```text
Definition: "needs export.csv"
               |
               v
Active operation -> entitlement interpreter supplied by host
                             |
                   accept -> continue
                   reject / missing interpreter -> operation fails
```

This shows a rule becoming active. Inspection can describe reachable rules before execution, but inspection does not
perform admission. An interpreter's successful return must reflect its real policy; a callback that only logs cannot
secure the operation.

For example, a CSV export can declare “this account needs the export feature.” The host's interpreter is a callback
that looks at the account and either returns normally or rejects. Only the later `apply()` call invokes it. Keeping the
rule separate lets an HTTP request and a background job ask the same policy question without choosing a billing system.

`await requirement.apply(...)` means “do not start the protected work until the policy check completes.” A rejected
Promise stops that path unless the application catches it and deliberately chooses another response.

## Check an application's upload rule

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

After the [checkout setup](../../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as requirement from '@okikio/capability/requirement';
const Size = Object.freeze({ kind: 'upload-rule', id: 'upload.maximum-bytes', maximum: 1024 });
const NeedsSmallUpload = requirement.define({ family: 'upload', action: 'require', definition: Size });
const bytes = new Uint8Array([1, 2, 3]);
await using owner = context.create({ id: 'upload' });
const ctx = requirement.scope(owner, {
	interpreters: {
		upload: {
			/** Check only the exact declared upload rule against this request's bytes. */
			async apply(_ctx, entries) {
				for (const entry of entries) {
					if (entry.definition !== Size) throw new Error('Unknown upload rule.');
					if (bytes.byteLength > Size.maximum) throw new Error('The upload is too large.');
				}
			},
		},
	},
});
// Applying the requirement invokes the interpreter. A declaration alone does not check the upload.
await requirement.apply(ctx, [NeedsSmallUpload]);
console.log(`Upload admitted: ${bytes.byteLength} bytes`);
```

Expected output:

```text output
Upload admitted: 3 bytes
```

The example has an actual rule: the upload must contain at most 1,024 bytes. The three-byte fixture passes. Replace it
with `new Uint8Array(1025)` and `apply()` rejects before the "admitted" line. The callback owns that size check; the
utility owns routing and the default rejection when a family has no interpreter. No file is written or uploaded.

These are the small contracts being connected:

```text
RequirementDefinition
  kind:       "requirement"
  family:     "upload"               chooses the interpreter
  action:     "require"              chooses this family's operation
  definition: Size                   exact application-owned rule object

RequirementInterpreter
  apply(ctx, requirements): Promise<void>
  scope?(ctx, requirements): Context  optional attachment of runtime operations
```

`define()` records the rule; it does not execute the callback. `scope()` attaches callbacks to a borrowed Context view.
A Context is the operation's identity, signal, clock, and cleanup lifetime, not a policy engine. `apply()` groups active
requirements by family, calls the configured interpreter for each group, and returns `Promise<void>` when they all
accept. An interpreter rejects by throwing. A static declaration or `bind()` call does not activate a check.

This is deliberately a small protocol instead of a fixed set of billing and security APIs. Your application can add an
upload rule without teaching the requirement package about file sizes. An entitlement interpreter can use a subscription
database while a permission interpreter uses object grants. The [source contracts](./types.ts) includes the inspection
shapes that describe those needs without running them.

- **Require a product feature:** define the label through [Entitlement](../../authz/entitlement/README.md), keep its
  requirement in a [Service](../../server/service/README.md) contract, and have the host evaluate the account's access
  to that feature.
- **Acquire a protected resource:** attach declared needs to [Resource](../resource/README.md). The requirement
  mechanism routes active rules; [Permission](../../authz/README.md) supplies concrete target checks after the target is
  known. The resource still owns creation and cleanup, not the policy interpreter.

## Apply only the rules active for this operation

Attach requirements to definitions, inspect the reachable graph for deployment planning, and apply only the requirements
active on the current execution path. Each semantic family owns its interpreter and failures. The example interpreter
checks one local byte limit; replace that policy when the host has different rules. Missing interpreters reject by
default. Scope views borrow their owner context.

`@okikio/capability/requirement` is the open policy-family mechanism used by the service compiler. A requirement says
that one exact domain rule can become active. The requirement package preserves identity, family, action, reachability,
and runtime activation without implementing the policy engine itself.

## Preserve or replace an interpreter set

`scope(ctx)` preserves an existing requirement view. `scope(ctx, { interpreters })` explicitly replaces its interpreter
set, with unknown families rejecting unless the new options say otherwise. Capability's
[`scope`](../README.md#save-a-note-with-explicit-dependencies) reuses that same rule when adding resource and effect
capabilities. Neither scope construction nor static inspection activates a requirement. Only `apply` activates the
requirements supplied to that call.

## Choose adjacent capabilities

Use this for declarative requirements and an explicit interpreter. Authz supplies permission and feature vocabulary;
Resource supplies live dependencies. A requirement declaration alone enforces no policy.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/packages/16-requirement.md) explains the model,
manual alternatives, and composition.
