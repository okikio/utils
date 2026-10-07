# `@okikio/requirement`

Keep declarations of required capabilities separate from the host that interprets them. Hard-coding a billing or
permission SDK into each resource makes definitions impossible to inspect without starting that SDK.

## Run a complete example

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as requirement from '@okikio/requirement';
const Feature = Object.freeze({ kind: 'entitlement', id: 'export.csv' });
const NeedsExport = requirement.define({ family: 'entitlement', action: 'require', definition: Feature });
await using owner = context.create({ id: 'export' });
const applied: string[] = [];
const ctx = requirement.scope(owner, {
	interpreters: {
		entitlement: {
			async apply(_ctx, entries) {
				applied.push(...entries.map((entry) => entry.definition.id));
			},
		},
	},
});
await requirement.apply(ctx, [NeedsExport]);
console.log(applied.join(','));
```

Expected output:

```text output
export.csv
```

## Build on the example

Attach requirements to definitions, inspect the reachable graph for deployment planning, and apply only the requirements
active on the current execution path. Each semantic family owns its interpreter and failures. The example interpreter
records admission in memory; replace it with real policy before using it for access control. Missing interpreters reject
by default. Scope views borrow their owner context.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

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
		entitlement: entitlement.interpreter(entitlementProvider),
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
