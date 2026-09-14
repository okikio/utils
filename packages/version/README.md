`@okikio/version`
=================

Purpose
-------

`@okikio/version` parses and reconciles software-version evidence without
pretending that every product follows Semantic Versioning.

It separates a *version scheme* from an observed *version candidate*. A scheme
owns parsing, equivalence, refinement, and release ordering. Resolution then
combines compatible evidence while retaining real conflicts.

The ordinary problem
--------------------

String comparison is not version comparison:

```ts
['2.10.0', '2.9.0'].sort();
// ['2.10.0', '2.9.0'] -- lexical order, not release order
```

Even a SemVer-only parser is insufficient when one source reports `2`, another
reports `2.4`, and a vendor uses four-part numeric releases such as `2.11.16.1`.
An evidence system also needs to distinguish refinement from contradiction.

Use the utility
---------------

Create a catalog of the schemes that are valid for the technology being
observed, then resolve candidates through it:

```ts
import * as version from '@okikio/version';

const schemes = version.createVersionSchemeCatalog([
  version.semanticVersionScheme,
  version.numericDottedVersionScheme,
]);

const resolution = version.resolveVersionCandidates([
  {
    value: '2',
    schemeId: 'semver',
    source: 'html-meta',
    sourcePriority: 60,
  },
  {
    value: '2.4.6',
    schemeId: 'semver',
    source: 'asset-path',
    sourcePriority: 30,
  },
], schemes);

console.log(resolution.status);                  // refined
console.log(resolution.selected?.parsed.normalizedValue); // 2.4.6
```

A precise compatible candidate outranks a coarse family even when the coarse
source has higher source priority. Incompatible exact candidates remain in
`conflicts` instead of being silently discarded.

`semanticVersionScheme` uses `@std/semver` for exact Semantic Versioning while
also representing coarse major and release-line observations. The numeric
scheme keeps dotted product versions separate from SemVer semantics.

Use with other utilities
------------------------

CSV evidence can stay structurally neutral until version resolution interprets
one column as software-version observations:

```ts
import * as csv from '@okikio/csv';
import * as version from '@okikio/version';

const document = csv.parse('source,version\nmeta,2\nasset,2.4.6\n');
const schemes = version.createVersionSchemeCatalog([version.semanticVersionScheme]);

const candidates = document.rows.map((row, index) => ({
  source: row.values[0] ?? `row-${index + 1}`,
  value: row.values[1] ?? '',
  schemeId: 'semver',
  sourcePriority: index === 0 ? 60 : 30,
}));

const resolution = version.resolveVersionCandidates(candidates, schemes);
console.log(resolution.selected?.parsed.normalizedValue); // 2.4.6
```

`@okikio/csv` owns source structure and preserves cell strings.
`@okikio/version` owns version semantics and evidence reconciliation.

Convenience and the manual equivalent
-------------------------------------

| Convenience | Manual equivalent | Utility-owned invariant |
| --- | --- | --- |
| a `VersionScheme` | parser + normalizer + equivalence/refinement/order rules per convention | explicit version semantics |
| `createVersionSchemeCatalog()` | immutable ID lookup and duplicate validation | one declared scheme universe |
| `resolveVersionCandidates()` | parse, rank specificity, reconcile compatible evidence, retain conflicts | deterministic evidence resolution |

The package does not decide support windows, upgrade policy, package publication,
or product compatibility. Those decisions belong to callers.

Source guide
------------

1. `types.ts` defines schemes, parsed values, candidates, and resolutions.
2. `semver.ts` and `numeric.ts` implement the built-in schemes.
3. `resolve.ts` owns evidence ranking and conflict classification.
4. `mod.test.ts` covers coarse refinement, exact evidence, build metadata,
   conflicts, and source-priority behavior.
