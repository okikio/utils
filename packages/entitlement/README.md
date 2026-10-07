# `@okikio/entitlement`

Declare which paid or enabled feature an operation requires without coupling its definition to a billing provider.
Scattered plan-name comparisons otherwise make the same feature mean different things in different services.

## Run a complete example

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

## Build on the example

Attach the requirement to a resource, activity or endpoint, then configure an entitlement interpreter at the application
root. The definition documents a required capability; it does not itself allow access. Unknown requirement families
reject unless the owner explicitly chooses another policy. Use exact imported definitions so billing policy and runtime
admission describe the same feature.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/entitlement` defines provider-neutral capability-access metadata. It does not know about plans, subscriptions,
billing databases, feature flags, or the actor that is making a request.

Use it when several packages need to refer to the same capability by stable identity and a host will decide whether that
capability is available.

## Start here

```ts
import * as entitlement from '@okikio/entitlement';

export const ExportCsv = entitlement.define({
	id: 'export.csv',
	description: 'Allows CSV export.',
});
```

`define()` validates the stable ID and freezes the definition. It does not check any user or account.

Group related definitions when callers need selection by key:

```ts
export const Features = entitlement.catalog('features', {
	ExportCsv,
	BulkImport: entitlement.define({ id: 'import.bulk' }),
});

export const ExportFeatures = entitlement.select(Features, ['ExportCsv']);
```

## Contribute a requirement

`entitlement.require()` converts one entitlement definition into a generic `@okikio/requirement` value:

```ts
const required = entitlement.require(ExportCsv);
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

The README is the primary user documentation; there is intentionally no separate hand-written API reference.
