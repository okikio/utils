# @okikio/version contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                    | Source                       | Reference           |
| ------------------------- | ---------------------------- | ------------------- |
| `@okikio/version`         | [./mod.ts](./mod.ts)         | [root](#root)       |
| `@okikio/version/numeric` | [./numeric.ts](./numeric.ts) | [numeric](#numeric) |
| `@okikio/version/resolve` | [./resolve.ts](./resolve.ts) | [resolve](#resolve) |
| `@okikio/version/semver`  | [./semver.ts](./semver.ts)   | [semver](#semver)   |
| `@okikio/version/types`   | [./types.ts](./types.ts)     | [types](#types)     |

## root

Import `@okikio/version`. [Source](./mod.ts).

Resolve release evidence by scheme and precision instead of trusting lexical order or whichever detector has the highest
priority. A coarse version observation should not erase a compatible exact release.

Start with SemVer evidence, add numeric dotted schemes for vendor formats, and retain conflicting exact candidates for
review. Compatible refinement takes precedence over source priority. A scheme describes version ordering and
compatibility; it does not discover the software or establish that an observed version is trustworthy.

### root: createVersionSchemeCatalog

[Declaration source](catalog.ts#L3)

```text
function createVersionSchemeCatalog(schemes: readonly VersionScheme[]): VersionSchemeCatalog
  Create an immutable catalog and reject duplicate scheme identities.
```

### root: ParsedVersion

[Declaration source](mod.ts#L23)

```text
reference ParsedVersion: ./packages/version/types.ts:19:1
```

### root: ParsedVersionCandidate

[Declaration source](mod.ts#L24)

```text
reference ParsedVersionCandidate: ./packages/version/types.ts:83:1
```

### root: VersionCandidate

[Declaration source](mod.ts#L25)

```text
reference VersionCandidate: ./packages/version/types.ts:67:1
```

### root: VersionConflict

[Declaration source](mod.ts#L26)

```text
reference VersionConflict: ./packages/version/types.ts:89:1
```

### root: VersionOrder

[Declaration source](mod.ts#L27)

```text
reference VersionOrder: ./packages/version/types.ts:10:1
```

### root: VersionPrecision

[Declaration source](mod.ts#L28)

```text
reference VersionPrecision: ./packages/version/types.ts:1:1
```

### root: VersionResolution

[Declaration source](mod.ts#L29)

```text
reference VersionResolution: ./packages/version/types.ts:99:1
```

### root: VersionScheme

[Declaration source](mod.ts#L30)

```text
reference VersionScheme: ./packages/version/types.ts:41:1
```

### root: VersionSchemeCatalog

[Declaration source](mod.ts#L31)

```text
reference VersionSchemeCatalog: ./packages/version/types.ts:57:1
```

### root: numericDottedVersionScheme

[Declaration source](mod.ts#L19)

```text
reference numericDottedVersionScheme: ./packages/version/numeric.ts:5:14
```

### root: resolveVersionCandidates

[Declaration source](mod.ts#L20)

```text
reference resolveVersionCandidates: ./packages/version/resolve.ts:20:1
```

### root: semanticVersionScheme

[Declaration source](mod.ts#L21)

```text
reference semanticVersionScheme: ./packages/version/semver.ts:7:14
```

### root: versionCandidateScore

[Declaration source](mod.ts#L20)

```text
reference versionCandidateScore: ./packages/version/resolve.ts:64:1
```

## numeric

Import `@okikio/version/numeric`. [Source](./numeric.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source |
| ---------------- | ------------------------ |
| `ParsedVersion`  | [Source](types.ts)       |
| `VersionOrder`   | [Source](types.ts)       |
| `VersionScheme`  | [Source](types.ts)       |

### numeric: compareNumericParts

[Declaration source](numeric.ts#L50)

```text
function compareNumericParts(left: readonly number[], right: readonly number[]): VersionOrder
  Compare dotted numeric components, treating missing trailing components as zero.
```

### numeric: numericDottedVersionScheme

[Declaration source](numeric.ts#L5)

```text
const numericDottedVersionScheme
  Generic dotted-numeric scheme for products that do not claim SemVer.
```

## resolve

Import `@okikio/version/resolve`. [Source](./resolve.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source |
| ------------------------ | ------------------------ |
| `ParsedVersion`          | [Source](types.ts)       |
| `ParsedVersionCandidate` | [Source](types.ts)       |
| `VersionCandidate`       | [Source](types.ts)       |
| `VersionConflict`        | [Source](types.ts)       |
| `VersionPrecision`       | [Source](types.ts)       |
| `VersionResolution`      | [Source](types.ts)       |
| `VersionSchemeCatalog`   | [Source](types.ts)       |

### resolve: resolveVersionCandidates

[Declaration source](resolve.ts#L20)

```text
function resolveVersionCandidates(candidates: readonly VersionCandidate[], catalog: VersionSchemeCatalog): VersionResolution
  Parse, rank, and reconcile version evidence without hiding incompatible exact candidates.
```

### resolve: versionCandidateScore

[Declaration source](resolve.ts#L64)

```text
function versionCandidateScore(candidate: ParsedVersionCandidate): number
  Score candidate specificity and evidence strength without comparing release age.
```

## semver

Import `@okikio/version/semver`. [Source](./semver.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source                                   |
| ---------------- | ---------------------------------------------------------- |
| `compare`        | [External source](https://jsr.io/@std/semver/1.0.8/mod.ts) |
| `format`         | [External source](https://jsr.io/@std/semver/1.0.8/mod.ts) |
| `SemVer`         | [External source](https://jsr.io/@std/semver/1.0.8/mod.ts) |
| `tryParse`       | [External source](https://jsr.io/@std/semver/1.0.8/mod.ts) |
| `ParsedVersion`  | [Source](types.ts)                                         |
| `VersionOrder`   | [Source](types.ts)                                         |
| `VersionScheme`  | [Source](types.ts)                                         |

### semver: semanticVersionScheme

[Declaration source](semver.ts#L7)

```text
const semanticVersionScheme
  Strict Semantic Versioning with explicit support for coarse major/minor observations.
```

## types

Import `@okikio/version/types`. [Source](./types.ts).

### types: ParsedVersion

[Declaration source](types.ts#L19)

```text
interface ParsedVersion
  Version value normalized by one declared scheme.

  `release` contains only ordered numeric release components. Scheme-specific
  qualifiers remain explicit so Adobe `-pN` patches are not misread as SemVer
  prereleases.

  readonly schemeId: string
    Stable identity of the selected interpretation scheme.
  readonly rawValue: string
    Original source value retained before normalization or interpretation.
  readonly normalizedValue: string
    Canonical interpreted value while retaining the separate original source value.
  readonly precision: VersionPrecision
    Granularity represented by the interpreted value.
  readonly release: readonly number[]
    Numeric release components retained in source order, such as [2, 4, 1].
  readonly prerelease?: readonly (string | number)[]
    Prerelease components retained by the version scheme.
  readonly build?: readonly string[]
    Build metadata preserved by the version scheme.
  readonly vendorPatch?: number
    Vendor-specific patch metadata retained by the interpretation scheme.
  readonly qualifier?: string
    Additional qualifier preserved by the selected interpretation.
```

### types: ParsedVersionCandidate

[Declaration source](types.ts#L83)

```text
interface ParsedVersionCandidate extends VersionCandidate
  Candidate after scheme-specific parsing and normalization.

  readonly parsed: ParsedVersion
    Interpreted structure retained after successful parsing.
```

### types: VersionCandidate

[Declaration source](types.ts#L67)

```text
interface VersionCandidate
  Unresolved version evidence supplied by a detector or extractor.

  readonly value: string
    Value carried by this contract; its schema and owner define the accepted shape.
  readonly schemeId: string
    Stable identity of the selected interpretation scheme.
  readonly source: string
    Source representation or provenance retained alongside the interpreted value.
  readonly sourcePriority: number
    Priority assigned to the source when interpretations compete.
  readonly confidence?: number
    Evidence confidence under this classifier; it is not a guarantee of external truth.
  readonly evidenceId?: string
    Stable identity of the source observation supporting the classification.
```

### types: VersionConflict

[Declaration source](types.ts#L89)

```text
interface VersionConflict
  One incompatible candidate retained rather than silently discarded.

  readonly selected: ParsedVersionCandidate
    Selected interpretation, if the evidence permits one.
  readonly competing: ParsedVersionCandidate
    Competing interpretations retained when the evidence is ambiguous.
  readonly reason: "different_release" | "different_vendor_patch" | "different_qualifier" | "different_scheme"
    Scheme-specific reason that two parsed candidates cannot be treated as the same release.
```

### types: VersionResolution

[Declaration source](types.ts#L99)

```text
interface VersionResolution
  Final evidence-aware resolution for one technology component.

  readonly status: "resolved" | "refined" | "conflicted" | "insufficient_evidence"
    Resolution branch that distinguishes agreement, refinement, conflict and missing evidence.
  readonly selected?: ParsedVersionCandidate
    Selected interpretation, if the evidence permits one.
  readonly candidates: readonly ParsedVersionCandidate[]
    Candidate interpretations retained before selecting one interpretation.
  readonly rejectedValues: readonly string[]
    Values rejected by interpretation rather than silently discarded.
  readonly conflicts: readonly VersionConflict[]
    Incompatible observations retained for explicit resolution.
```

### types: VersionScheme

[Declaration source](types.ts#L41)

```text
interface VersionScheme
  One parser and comparator for a concrete version convention.

  readonly id: string
    Stable identity used to correlate this contract or occurrence.
  readonly description: string
    Caller-authored purpose used in documentation and diagnostics.
  parse(value: string): ParsedVersion | undefined
    Interpret source data while retaining structured evidence or rejection details.
  isEquivalent(left: ParsedVersion, right: ParsedVersion): boolean
    Compare interpreted values under this scheme rather than raw source spelling.
  isRefinement(candidate: ParsedVersion, coarse: ParsedVersion): boolean
    Whether one interpreted value adds precision while remaining compatible with the other.
  compareReleaseOrder(left: ParsedVersion, right: ParsedVersion): VersionOrder | undefined
    Compare releases under this version scheme, independently of source spelling.
```

### types: VersionSchemeCatalog

[Declaration source](types.ts#L57)

```text
interface VersionSchemeCatalog
  Read-only lookup used by analysis without a mutable global registry.

  readonly schemes: readonly VersionScheme[]
    Available interpretation schemes selected by the caller.
  readonly schemesById: ReadonlyMap<string, VersionScheme>
    Interpretation schemes indexed by their stable IDs.
  get(id: string): VersionScheme
    Find the exact registered scheme by ID; an unknown ID throws.
```

### types: VersionOrder

[Declaration source](types.ts#L10)

```text
type VersionOrder = -1 | 0 | 1
  Relative release order returned only when two versions are comparable.
```

### types: VersionPrecision

[Declaration source](types.ts#L1)

```text
type VersionPrecision = "exact" | "vendor_patch" | "release_line" | "major" | "family" | "unknown"
  Precision represented by one parsed version observation.
```
