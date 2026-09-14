`@okikio/requirement`
====================

`@okikio/requirement` is the open policy-family mechanism used by the service
compiler. A requirement says that one exact domain rule can become active. The
requirement package preserves identity, family, action, reachability, and runtime
activation without implementing the policy engine itself.

Define a requirement
--------------------

~~~~ typescript
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
~~~~

The generic requirement does not know whether `permission` means an RBAC role,
an ACL row, a relationship graph, a Zanzibar tuple, or a remote authorization
service. The application supplies the interpreter.

Interpret one family
--------------------

~~~~ typescript
const ctx = requirement.scope(parent, {
  interpreters: {
    permission: permission.interpreter(graphPermissionChecker),
    entitlement: entitlement.interpreter(entitlementProvider),
  },
  unknown: 'reject',
});

await requirement.apply(ctx, RequiredAccountRead);
~~~~

An active family with no interpreter rejects by default. A test or observational
host must choose `unknown: 'ignore'` explicitly when ignoring unknown families is
intentional.

Direct, reachable, and active requirements
------------------------------------------

The compiler keeps three states separate:

 -  **direct**: the exact service, endpoint, operation, middleware, workflow, or
    resource declares the requirement for the current work.
 -  **reachable**: a declared dependency can activate the requirement later.
 -  **active**: runtime work has reached the point where the interpreter must
    evaluate the requirement.

This distinction supports object and graph authorization. An endpoint can declare
that `AccountPermissions.Read` is reachable before the account ID exists. After
the handler resolves the concrete account, it can activate the declared
permission with that target. The compiler can still prove that the permission
family is part of the service contract before traffic starts.

What belongs here
-----------------

Requirements are appropriate for rules that answer whether work is allowed or
which policy state applies. Examples include:

 -  permissions
 -  entitlements
 -  quotas
 -  consent
 -  compliance rules
 -  feature eligibility
 -  organization or tenant admission rules

A requirement is not the right mechanism for every cross-cutting service feature.
Metrics and logs are observations. Usage and meter records are declared effects
when their announcement needs durable ownership.
Retries and rate limits are resilience policies. Live graph clients and stores
are resources.

This separation keeps each extension family honest about its runtime semantics.
