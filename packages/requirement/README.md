# `@okikio/requirement`

One report may need account access, an enabled export feature, and a quota check. `@okikio/requirement` lets the report
declare those needs without embedding a particular billing or authorization SDK in its definition. The application
supplies the code that evaluates each kind of rule when the work reaches it.

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

## Check an application's upload rule

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as requirement from '@okikio/requirement';
const Size = Object.freeze({ kind: 'upload-rule', id: 'upload.maximum-bytes', maximum: 1024 });
const NeedsSmallUpload = requirement.define({ family: 'upload', action: 'require', definition: Size });
const bytes = new Uint8Array([1, 2, 3]);
await using owner = context.create({ id: 'upload' });
const ctx = requirement.scope(owner, {
	interpreters: {
		upload: {
			async apply(_ctx, entries) {
				for (const entry of entries) {
					if (entry.definition !== Size) throw new Error('Unknown upload rule.');
					if (bytes.byteLength > Size.maximum) throw new Error('The upload is too large.');
				}
			},
		},
	},
});
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
database while a permission interpreter uses object grants. The [contract reference](API.md) includes the inspection
shapes that describe those needs without running them.

- **Require a product feature:** define the label through [Entitlement](../entitlement/README.md), keep its requirement
  in a [Service](../server/service/README.md) contract, and have the host evaluate the account's access to that feature.
- **Acquire a protected resource:** attach declared needs to [Resource](../resource/README.md). The requirement
  mechanism routes active rules; [Permission](../permission/README.md) supplies concrete target checks after the target
  is known. The resource still owns creation and cleanup, not the policy interpreter.

## Build on the example

Attach requirements to definitions, inspect the reachable graph for deployment planning, and apply only the requirements
active on the current execution path. Each semantic family owns its interpreter and failures. The example interpreter
checks one local byte limit; replace that policy when the host has different rules. Missing interpreters reject by
default. Scope views borrow their owner context.

`@okikio/requirement` is the open policy-family mechanism used by the service compiler. A requirement says that one
exact domain rule can become active. The requirement package preserves identity, family, action, reachability, and
runtime activation without implementing the policy engine itself.

## Define a requirement

```typescript
import * as requirement from '@okikio/requirement';

const AccountRead = Object.freeze({
	id: 'account:read',
	kind: 'permission',
	description: 'Read one account.',
});

const RequiredAccountRead = requirement.define({
	family: 'permission',
	action: 'require',
	definition: AccountRead,
});
```

The generic requirement does not know whether `permission` means an RBAC role, an ACL row, a relationship graph, a
Zanzibar tuple, or a remote authorization service. The application supplies the interpreter.

## Interpret one family

```typescript
const ctx = requirement.scope(parent, {
	interpreters: {
		permission: permission.interpreter(graphPermissionChecker),
		entitlement: entitlementInterpreter, // supplied by the application
	},
	unknown: 'reject',
});

await requirement.apply(ctx, RequiredAccountRead);
```

An active family with no interpreter rejects by default. A test or observational host must choose `unknown: 'ignore'`
explicitly when ignoring unknown families is intentional.

## Direct, reachable, and active requirements

The compiler keeps three states separate:

- **direct**: the exact service, endpoint, operation, middleware, workflow, or resource declares the requirement for the
  current work.
- **reachable**: a declared dependency can activate the requirement later.
- **active**: runtime work has reached the point where the interpreter must evaluate the requirement.

This distinction supports object and graph authorization. An endpoint can declare that `AccountPermissions.Read` is
reachable before the account ID exists. After the handler resolves the concrete account, it can activate the declared
permission with that target. The compiler can still prove that the permission family is part of the service contract
before traffic starts.

## What belongs here

Requirements are appropriate for rules that answer whether work is allowed or which policy state applies. Examples
include:

- permissions
- entitlements
- quotas
- consent
- compliance rules
- feature eligibility
- organization or tenant admission rules

A requirement is not the right mechanism for every cross-cutting service feature. Metrics and logs are observations.
Usage and meter records are declared effects when their announcement needs durable ownership. Retries and rate limits
are resilience policies. Live graph clients and stores are resources.

This separation keeps each extension family honest about its runtime semantics.
