`@okikio/entitlement`
====================

Purpose
-------

`@okikio/entitlement` defines provider-neutral capability-access metadata. It does
not know about plans, subscriptions, billing databases, feature flags, or the
actor that is making a request.

Use it when several packages need to refer to the same capability by stable
identity and a host will decide whether that capability is available.


Start here
----------

```ts
import * as entitlement from '@okikio/entitlement';

export const ExportCsv = entitlement.define({
  id: 'export.csv',
  description: 'Allows CSV export.',
});
```

`define()` validates the stable ID and freezes the definition. It does not check
any user or account.

Group related definitions when callers need selection by key:

```ts
export const Features = entitlement.catalog('features', {
  ExportCsv,
  BulkImport: entitlement.define({ id: 'import.bulk' }),
});

export const ExportFeatures = entitlement.select(Features, ['ExportCsv']);
```


Contribute a requirement
------------------------

`entitlement.require()` converts one entitlement definition into a generic
`@okikio/requirement` value:

```ts
const required = entitlement.require(ExportCsv);
```

A service, resource, or another definition can retain that requirement. The
host's requirement interpreter decides how it is enforced. This package never
queries billing or persistence by itself.


Larger composition
------------------

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

The definitions remain plain immutable metadata. Product policy can change
without changing the utility.


Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `entitlement.define()` | freeze a stable capability ID/description object and validate identity yourself | provider-neutral capability identity |
| `catalog()` / `select()` / `compose()` | build and validate capability maps/subsets manually | the same catalog semantics as other definition utilities |
| `entitlement.require()` | construct the corresponding generic requirement record by hand | capability metadata composes with the shared requirement interpreter |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


The manual form is a frozen metadata object, a `Map` or object catalog, and a
`@okikio/requirement` record. `@okikio/entitlement` standardizes those shapes so
identity, selection, and composition behave like the other definition
utilities.


Source guide
------------

1. `mod.ts` contains the complete runtime API.
2. `types.ts` defines the immutable values.
3. `mod_test.ts`, when present, is the executable behavior reference.

The README is the primary user documentation; there is intentionally no separate
hand-written API reference.
