# `@okikio/version`

One detector says a site uses release family `2`; another finds exact release `2.4.6`. You want the more informative
answer without losing contradictory evidence. `version` interprets observations using a declared numbering scheme, then
distinguishes a compatible refinement from a conflict. Here a **scheme** means rules such as Semantic Versioning.

| Evidence supplied in the demo      | How precise?    | Role in the answer                                       |
| ---------------------------------- | --------------- | -------------------------------------------------------- |
| Header reports `2`, priority 100   | Major family    | Compatible with the exact observation.                   |
| Asset reports `2.4.6`, priority 20 | Exact release   | Selected as the refinement.                              |
| Combined output                    | `refined 2.4.6` | Precision wins over the coarse source's higher priority. |

The table shows compatible evidence, not proof that the detector is correct. A conflicting exact version is retained for
inspection rather than erased by this refinement example.

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](API.md).

## Run a complete example

```ts runnable
import { createVersionSchemeCatalog, resolveVersionCandidates, semanticVersionScheme } from '@okikio/version';
const schemes = createVersionSchemeCatalog([semanticVersionScheme]);
const value = resolveVersionCandidates([
	{ value: '2', schemeId: 'semver', source: 'header', sourcePriority: 100 },
	{ value: '2.4.6', schemeId: 'semver', source: 'asset', sourcePriority: 20 },
], schemes);
console.log(value.status, value.selected?.value);
```

Expected output:

```text output
refined 2.4.6
```

The demo chooses a Semantic Versioning scheme and supplies two observations. The output says the exact asset evidence
refines the coarse header evidence. Change the coarse observation to `3` to introduce incompatible evidence instead.
Your application must still decide which detectors and observations it trusts.

## Build on the example

- Read version observations from [CSV](../csv/README.md), preserve their source labels, and resolve them as in the
  runnable evidence example below. Parsing the file and interpreting release numbers are separate jobs.
- Use [HTML](../html/README.md) or [CSS](../css/README.md) to collect source facts, then let application-specific
  detectors turn those facts into version candidates. The version package reconciles candidates; it does not detect
  products.

Start with SemVer evidence, add numeric dotted schemes for vendor formats, and retain conflicting exact candidates for
review. Compatible refinement takes precedence over source priority. A scheme describes version ordering and
compatibility; it does not discover the software or establish that an observed version is trustworthy.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/version` parses and reconciles software-version evidence without pretending that every product follows Semantic
Versioning.

It separates a _version scheme_ from an observed _version candidate_. A scheme owns parsing, equivalence, refinement,
and release ordering. Resolution then combines compatible evidence while retaining real conflicts.

## The ordinary problem

String comparison is not version comparison:

```ts
['2.10.0', '2.9.0'].sort();
// ['2.10.0', '2.9.0'] -- lexical order, not release order
```

Even a SemVer-only parser is insufficient when one source reports `2`, another reports `2.4`, and a vendor uses
four-part numeric releases such as `2.11.16.1`. An evidence system also needs to distinguish refinement from
contradiction.

## Use the utility

Create a catalog of the schemes that are valid for the technology being observed, then resolve candidates through it:

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

console.log(resolution.status); // refined
console.log(resolution.selected?.parsed.normalizedValue); // 2.4.6
```

A precise compatible candidate outranks a coarse family even when the coarse source has higher source priority.
Incompatible exact candidates remain in `conflicts` instead of being silently discarded.

`semanticVersionScheme` uses `@std/semver` for exact Semantic Versioning while also representing coarse major and
release-line observations. The numeric scheme keeps dotted product versions separate from SemVer semantics.

## Use with other utilities

CSV evidence can stay structurally neutral until version resolution interprets one column as software-version
observations:

```ts runnable=csv-evidence.ts
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
console.log(resolution.selected?.parsed.normalizedValue);
```

Expected output:

```text output
2.4.6
```

`resolveVersionCandidates()` returns `VersionResolution` immediately. Its selected candidate contains the parsed
normalized value; incompatible candidates remain available as conflicts. This is pure data work with no cancellation or
cleanup owner.

`@okikio/csv` owns source structure and preserves cell strings. `@okikio/version` owns version semantics and evidence
reconciliation.

## Convenience and the manual equivalent

| Convenience                    | Manual equivalent                                                        | Utility-owned invariant           |
| ------------------------------ | ------------------------------------------------------------------------ | --------------------------------- |
| a `VersionScheme`              | parser + normalizer + equivalence/refinement/order rules per convention  | explicit version semantics        |
| `createVersionSchemeCatalog()` | immutable ID lookup and duplicate validation                             | one declared scheme universe      |
| `resolveVersionCandidates()`   | parse, rank specificity, reconcile compatible evidence, retain conflicts | deterministic evidence resolution |

The package does not decide support windows, upgrade policy, package publication, or product compatibility. Those
decisions belong to callers.

## Source guide

1. `types.ts` defines schemes, parsed values, candidates, and resolutions.
2. `semver.ts` and `numeric.ts` implement the built-in schemes.
3. `resolve.ts` owns evidence ranking and conflict classification.
4. `mod.test.ts` covers coarse refinement, exact evidence, build metadata, conflicts, and source-priority behavior.
