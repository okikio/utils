# `@okikio/entitlement`

A reporting product offers CSV export to some accounts. `@okikio/entitlement` names that feature once as `export.csv`,
so an endpoint, background activity, and product policy can refer to the same capability. Changing subscription plans
then changes the application's policy rather than scattered comparisons with plan names.

An **entitlement** describes which feature an account can use. A definition is a label and description; a
**requirement** carries that label to a host that can evaluate it. Neither value looks up a subscription or grants
access.

| Step                             | Value or action                   | What has happened?                                   |
| -------------------------------- | --------------------------------- | ---------------------------------------------------- |
| Define the feature               | `export.csv`                      | The feature has a stable name.                       |
| Call `entitlement.require()`     | A requirement record              | An operation can declare that it needs the feature.  |
| Apply through a host interpreter | Application-specific policy check | The host must decide whether this account qualifies. |

Read the table as separate responsibilities. Creating the first two values does not perform the final policy check.

## Name the feature that an export needs

```ts runnable
import * as entitlement from '@okikio/entitlement';
import * as requirement from '@okikio/requirement';
const Export = entitlement.define({ id: 'export.csv', description: 'Export rows as CSV.' });
console.log(requirement.document(entitlement.require(Export))[0]?.definition);
```

Expected output:

```text output
export.csv
```

## Read the mini-demo

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

`define()` checks the ID and freezes the metadata. `require()` creates a requirement pointing at that same object; it
performs no account lookup. Separating these steps allows a documentation tool to list required features without logging
into a billing system, while the running application can use its current account policy.

## Check feature access before returning a CSV download

Here the familiar goal is to return an exported row. The application's `enabled` set represents the features supplied by
its account policy. The host callback checks every active requirement before constructing the response. Removing
`Export.id` from the set makes `requirement.apply()` reject and prevents the download from being produced.

```ts runnable=export-csv.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as entitlement from '@okikio/entitlement';
import * as requirement from '@okikio/requirement';
const Export = entitlement.define({ id: 'export.csv' });
const enabled = new Set([Export.id]);
await using owner = context.create({ id: 'account-export' });
const ctx = requirement.scope(owner, {
	interpreters: {
		entitlement: {
			async apply(_ctx, entries) {
				for (const entry of entries) {
					if (!enabled.has(entry.definition.id)) throw new Error('This account cannot export CSV.');
				}
			},
		},
	},
});
await requirement.apply(ctx, [entitlement.require(Export)]);
const download = new Response('name,asset\nAda,photo.png\n', {
	headers: { 'content-type': 'text/csv' },
});
console.log((await download.text()).trim());
```

```text output
name,asset
Ada,photo.png
```

`requirement.scope()` borrows the owner's cancellation lifetime and attaches the policy callback. `apply()` returns
`Promise<void>`: successful completion means the callback accepted the active requirements. `Response` remains the
normal Web API response. The CSV is a fixed fixture; an application must encode its real rows correctly. This local
example implements feature policy, not authentication or a billing-provider integration.

- **Gate a report export:** attach the requirement to a [Service](../server/service/README.md) operation and supply an
  entitlement-family interpreter through [Requirement](../requirement/README.md). That interpreter can query the
  application's subscription or feature store; this package supplies no billing-provider interpreter.
- **Separate plan access from object access:** a feature may be enabled for an account while one document remains
  private. Combine entitlement metadata with a [Permission](../permission/README.md) check for the actual document, then
  use [CSV](../csv/README.md) for the export format.

## Build on the example

Attach the requirement to a resource, activity or endpoint, then supply an entitlement-family requirement interpreter at
the application root. The definition documents a required capability; it does not itself allow access. Unknown
requirement families reject unless the owner explicitly chooses another policy. Use exact imported definitions so
billing policy and runtime admission describe the same feature.

## Group features for a report

Group related definitions when callers need selection by key. This continues the first example's `Export` definition:

```ts
export const Features = entitlement.catalog('features', {
	ExportCsv: Export,
	BulkImport: entitlement.define({ id: 'import.bulk' }),
});

export const ExportFeatures = entitlement.select(Features, ['ExportCsv']);
```

## Contribute a requirement

`entitlement.require()` converts one entitlement definition into a generic `@okikio/requirement` value:

```ts
const required = entitlement.require(Export);
console.log(requirement.document(required)[0]?.definition);
```

A service, resource, or another definition can retain that requirement. The host's requirement interpreter decides how
it is enforced. This package never queries billing or persistence by itself.

## Larger composition

```ts
const Reporting = entitlement.catalog('reporting', {
	ExportCsv: entitlement.define({ id: 'report.export.csv' }),
	History: entitlement.define({ id: 'report.history' }),
	Evidence: entitlement.define({ id: 'report.evidence' }),
});

const RequiredForAnalyst = entitlement.compose(
	entitlement.select(Reporting, ['History', 'Evidence']),
);

const requirements = RequiredForAnalyst.map(entitlement.require);
console.log(requirement.document(requirements).map((entry) => entry.definition).join(','));
```

The definitions remain plain immutable metadata. Product policy can change without changing the utility.

## Convenience and the manual equivalent

| Convenience                            | Manual equivalent                                                               | Concrete value                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `entitlement.define()`                 | freeze a stable capability ID/description object and validate identity yourself | provider-neutral capability identity                                 |
| `catalog()` / `select()` / `compose()` | build and validate capability maps/subsets manually                             | the same catalog semantics as other definition utilities             |
| `entitlement.require()`                | construct the corresponding generic requirement record by hand                  | capability metadata composes with the shared requirement interpreter |

The manual form is a frozen metadata object, a `Map` or object catalog, and a `@okikio/requirement` record.
`@okikio/entitlement` standardizes those shapes so identity, selection, and composition behave like the other definition
utilities.

## Source guide

1. `mod.ts` contains the complete runtime API.
2. `types.ts` defines the immutable values.
3. `mod.test.ts`, when present, is the executable behavior reference.

Read the [generated API reference](API.md) for the complete exported contracts and field descriptions.
