# `@okikio/authz/entitlement`

A reporting product offers CSV export to some accounts. `@okikio/authz/entitlement` names that feature once as
`export.csv`, so an endpoint, background activity, and product policy can refer to the same capability. Changing
subscription plans then changes the application's policy rather than scattered comparisons with plan names.

An **entitlement** describes which feature an account can use. A definition is a label and description; a
**requirement** carries that label to a host that can evaluate it. Neither value looks up a subscription or grants
access.

| Step                             | Value or action                   | What has happened?                                   |
| -------------------------------- | --------------------------------- | ---------------------------------------------------- |
| Define the feature               | `export.csv`                      | The feature has a stable name.                       |
| Call `entitlement.require()`     | A requirement record              | An operation can declare that it needs the feature.  |
| Apply through a host interpreter | Application-specific policy check | The host must decide whether this account may export. |

Read the table as separate responsibilities. Creating the first two values does not perform the final policy check.

## Name the feature that an export needs

Name the CSV export feature and turn it into a requirement. This first example inspects the declaration only; the next
example supplies the application policy that decides whether an actual export may proceed.

After the [checkout setup](../../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
import * as entitlement from '@okikio/authz/entitlement';
import * as requirement from '@okikio/capability/requirement';

// Name the feature independently of any account or subscription plan.
const Export = entitlement.define({ id: 'export.csv', description: 'Export rows as CSV.' });
// This describes a requirement. An application interpreter still decides whether to allow the export.
console.log(requirement.document(entitlement.require(Export))[0]?.definition);
```

Expected output:

```text output
export.csv
```

## Trace the feature into a requirement

The mini-demo creates an export feature, turns it into a requirement, and prints its documented definition ID:
`export.csv`. It does not contain an account or a policy decision. Try changing the feature ID to `report.history`; the
printed description of the requirement changes with it. An application must supply the policy interpreter before using
this metadata to gate real work.

The package's small data contracts explain the two calls:

```text
Export
  kind:        "entitlement"
  id:          "export.csv"
  description: "Export rows as CSV."

entitlement.require(Export)
  kind:       "requirement"
  family:     "entitlement"       selects the host's policy interpreter
  action:     "require"
  definition: Export              retains the exact feature object
```

`define()` checks the ID, freezes the metadata, and registers its identity. A lookalike object is not accepted.
`require()` creates a requirement pointing at that same object; it performs no account lookup. Separating these steps
allows a documentation tool to list required features without logging into a billing system, while the running
application can use its current account policy.

## Check feature access before returning a CSV download

Here the familiar goal is to return an exported row. The application's `enabled` set represents the features supplied by
its account policy. The host callback checks every active requirement before constructing the response. Removing
`Export.id` from the set makes `requirement.apply()` reject and prevents the download from being produced.

Save this program as `export-csv.ts` and run `mise exec -- deno run export-csv.ts` from the same checkout.

```ts runnable=export-csv.ts
import * as context from '@okikio/context';
import * as entitlement from '@okikio/authz/entitlement';
import * as requirement from '@okikio/capability/requirement';

// Name the feature independently of any account or subscription plan.
const Export = entitlement.define({ id: 'export.csv' });

// Trusted account-policy input, not proof that the caller is authenticated.
const enabled = new Set<string>([Export.id]);

// The policy view borrows this operation's cancellation and cleanup lifetime.
await using owner = context.create({ id: 'account-export' });
const ctx = requirement.scope(owner, {
	interpreters: {
		entitlement: entitlement.interpreter({
			async check(_ctx, definitions) {
				return definitions.map((definition) => ({ allowed: enabled.has(definition.id) }));
			},
		}),
	},
});

// Do not produce the export until the account policy accepts the feature.
await requirement.apply(ctx, [entitlement.require(Export)]);
const download = new Response('name,asset\nAda,photo.png\n', {
	headers: { 'content-type': 'text/csv' },
});
console.log((await download.text()).trim());

// Removing a feature changes the policy; the next admission must reject.
enabled.delete(Export.id);
try {
	await requirement.apply(ctx, [entitlement.require(Export)]);
	throw new Error('A disabled feature must not be accepted.');
} catch (error) {
	if (!(error instanceof entitlement.EntitlementDeniedError)) throw error;
	console.log('Export rejected');
}
```

```text output
name,asset
Ada,photo.png
Export rejected
```

`requirement.scope()` borrows the owner's cancellation lifetime and attaches the policy callback. `apply()` returns
`Promise<void>`: successful completion means the callback accepted the active requirements. `Response` remains the
normal Web API response. The CSV is a fixed fixture; an application must encode its real rows correctly. This local
example implements feature policy, not authentication or a billing-provider integration.

- **Gate a report export:** attach the requirement to a [Service](../../server/service/README.md) operation and supply
  an entitlement-family interpreter through [Requirement](../../capability/requirement/README.md). That interpreter can
  query the application's subscription or feature store; the application owns that lookup.
- **Separate plan access from object access:** a feature may be enabled for an account while one document remains
  private. Combine entitlement metadata with a [Permission](../README.md) check for the actual document, then use
  [CSV](../../format/csv/README.md) for the export format.

## Apply the feature rule before the export

Attach the requirement to a resource, activity or endpoint, then supply an entitlement-family requirement interpreter at
the application root. The definition documents a required capability; it does not itself allow access. Unknown
requirement families reject unless the owner explicitly chooses another policy. Use exact imported definitions so
billing policy and runtime admission describe the same feature.

## Choose adjacent capabilities

Use Permission for an action on a target and Entitlement for a feature requirement. Billing and membership are inputs
supplied by the application.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/authz/04-entitlement.md) explains the model, manual
alternatives, and composition.

## Explain a current policy decision

`explain(ctx, checker, requirements, { maximumChecks, maximumReasonLength })` returns immutable evidence in authored
order, retaining exact definitions and repeated requirements. Its status is `fault` if any provider answer faults,
otherwise `denied` if any denies, otherwise `allowed`. Empty requirements allow without a provider call. Batch bounds
apply before policy evaluation.

Provider errors are redacted; thrown provider failures become fault entries. Malformed answer batches throw
`EntitlementDecisionError`, and cancellation propagates. Reasons are absent unless `details: true`, then truncated to
the explicit UTF-16 code-unit limit. Details can contain application secrets; opt in only at an authorized diagnostic
surface. This is a current evaluation, with no inferred expiry, billing authority or cache. Use the interpreter for
enforcement.
