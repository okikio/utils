# @okikio/email contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                    | Source                           | Reference               |
| ------------------------- | -------------------------------- | ----------------------- |
| `@okikio/email`           | [./mod.ts](./mod.ts)             | [root](#root)           |
| `@okikio/email/classify`  | [./classify.ts](./classify.ts)   | [classify](#classify)   |
| `@okikio/email/extract`   | [./extract.ts](./extract.ts)     | [extract](#extract)     |
| `@okikio/email/normalize` | [./normalize.ts](./normalize.ts) | [normalize](#normalize) |
| `@okikio/email/types`     | [./types.ts](./types.ts)         | [types](#types)         |

## root

Import `@okikio/email`. [Source](./mod.ts).

Normalize and classify email-domain evidence without inventing application policy. Comparing raw addresses or
maintaining ad hoc domain lists makes casing and subdomain behavior inconsistent.

Normalize a domain first, then use the supplied classifier or provide your own classification rules. Use the evidence to
route signup review or data enrichment; do not treat domain classification as identity verification or mailbox
deliverability. Network checks, domain ownership, consent and product decisions belong to your application.

### root: DISPOSABLE_DOMAINS

[Declaration source](data/disposable.ts#L15)

```text
const DISPOSABLE_DOMAINS
  Vendored disposable-email-domain snapshot.

  Source repository: disposable-email-domains/disposable-email-domains
  Source file: disposable_email_blocklist.conf
  Source commit: 1f2b579538e84cee3a99d714656ff6d6a2c229c0
  Source blob: 9884a5dae2cecb6c9909f6ea6ff6efa0f13caf36
  Retrieved: 2026-07-16
  License: CC0-1.0

  The upstream list is intentionally represented as TypeScript data so every
  runtime receives the same immutable snapshot without filesystem or network
  access. Refreshes should replace this generated array and update all metadata
  above in one reviewed change.
```

### root: PRIVACY_DOMAIN_RULES

[Declaration source](data/providers.ts#L52)

```text
const PRIVACY_DOMAIN_RULES
  Provider-owned privacy alias domains that can be recognized from a hostname.

  Custom domains and self-hosted installations remain intentionally
  undetectable from a static list. Unknown therefore never means corporate.
```

### root: PUBLIC_DOMAIN_RULES

[Declaration source](data/providers.ts#L3)

```text
const PUBLIC_DOMAIN_RULES
  High-confidence consumer mailbox domains maintained as reviewed utility data.
```

### root: DEFAULT_DOMAIN_CLASSIFIER

[Declaration source](mod.ts#L13)

```text
reference DEFAULT_DOMAIN_CLASSIFIER: ./packages/email/classify.ts:169:14
```

### root: DomainColumnType

[Declaration source](mod.ts#L19)

```text
reference DomainColumnType: ./packages/email/types.ts:52:1
```

### root: DomainSource

[Declaration source](mod.ts#L20)

```text
reference DomainSource: ./packages/email/types.ts:59:1
```

### root: DomainSourceKind

[Declaration source](mod.ts#L21)

```text
reference DomainSourceKind: ./packages/email/types.ts:49:1
```

### root: EmailDomainClassification

[Declaration source](mod.ts#L22)

```text
reference EmailDomainClassification: ./packages/email/types.ts:35:1
```

### root: EmailDomainClassifier

[Declaration source](mod.ts#L23)

```text
reference EmailDomainClassifier: ./packages/email/types.ts:43:1
```

### root: EmailDomainEvidence

[Declaration source](mod.ts#L24)

```text
reference EmailDomainEvidence: ./packages/email/types.ts:21:1
```

### root: EmailDomainRule

[Declaration source](mod.ts#L25)

```text
reference EmailDomainRule: ./packages/email/types.ts:9:1
```

### root: EmailDomainRuleMatch

[Declaration source](mod.ts#L26)

```text
reference EmailDomainRuleMatch: ./packages/email/types.ts:6:1
```

### root: EmailDomainTrait

[Declaration source](mod.ts#L27)

```text
reference EmailDomainTrait: ./packages/email/types.ts:3:1
```

### root: EmailRowDomain

[Declaration source](mod.ts#L28)

```text
reference EmailRowDomain: ./packages/email/types.ts:85:1
```

### root: RowDomainCandidate

[Declaration source](mod.ts#L29)

```text
reference RowDomainCandidate: ./packages/email/types.ts:75:1
```

### root: createDomainClassifier

[Declaration source](mod.ts#L13)

```text
reference createDomainClassifier: ./packages/email/classify.ts:115:1
```

### root: extractDomains

[Declaration source](mod.ts#L16)

```text
reference extractDomains: ./packages/email/extract.ts:68:1
```

### root: normalizeDomain

[Declaration source](mod.ts#L17)

```text
reference normalizeDomain: ./packages/email/normalize.ts:16:1
```

### root: normalizeHostname

[Declaration source](mod.ts#L17)

```text
reference normalizeHostname: ./packages/email/normalize.ts:28:1
```

## classify

Import `@okikio/email/classify`. [Source](./classify.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source     |
| --------------------------- | ---------------------------- |
| `DISPOSABLE_DOMAINS`        | [Source](data/disposable.ts) |
| `PRIVACY_DOMAIN_RULES`      | [Source](data/providers.ts)  |
| `PUBLIC_DOMAIN_RULES`       | [Source](data/providers.ts)  |
| `normalizeDomain`           | [Source](normalize.ts)       |
| `EmailDomainClassification` | [Source](types.ts)           |
| `EmailDomainClassifier`     | [Source](types.ts)           |
| `EmailDomainEvidence`       | [Source](types.ts)           |
| `EmailDomainRule`           | [Source](types.ts)           |
| `EmailDomainRuleMatch`      | [Source](types.ts)           |
| `EmailDomainTrait`          | [Source](types.ts)           |

### classify: createDomainClassifier

[Declaration source](classify.ts#L115)

```text
function createDomainClassifier(options: { readonly rules?: readonly EmailDomainRule[]; readonly disposableDomains?: readonly string[]; }): EmailDomainClassifier
  Creates a runtime-neutral classifier from plain immutable domain data.
```

### classify: DEFAULT_DOMAIN_CLASSIFIER

[Declaration source](classify.ts#L169)

```text
const DEFAULT_DOMAIN_CLASSIFIER
  Shared default classifier for callers that do not need policy injection.
```

## extract

Import `@okikio/email/extract`. [Source](./extract.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                     | Contract owner or source       |
| ------------------------------------ | ------------------------------ |
| `CsvRow`                             | [csv contracts](../csv/API.md) |
| `DEFAULT_DOMAIN_CLASSIFIER`          | [Source](classify.ts)          |
| `normalizeDomain`                    | [Source](normalize.ts)         |
| `normalizeHostname`                  | [Source](normalize.ts)         |
| `DomainColumnType`                   | [Source](types.ts)             |
| `DomainSource`                       | [Source](types.ts)             |
| `DomainSourceKind`                   | [Source](types.ts)             |
| `EmailDomainClassifier`              | [Source](types.ts)             |
| `EmailRowDomain`                     | [Source](types.ts)             |
| `RowDomainCandidate`                 | [Source](types.ts)             |
| [Declaration source](extract.ts#L68) |                                |

```text
async function* extractDomains(rows: AsyncIterable<CsvRow>, columns: readonly DomainColumnType[], classifier: EmailDomainClassifier): AsyncGenerator<EmailRowDomain>
  Streams row-level company-domain candidates from already parsed CSV rows.

  CSV parsing and email-domain policy remain independent utilities. This
  function is the explicit composition point where column roles, hostname
  normalization, and mailbox classification are used together.
```

## normalize

Import `@okikio/email/normalize`. [Source](./normalize.ts).

### normalize: normalizeDomain

[Declaration source](normalize.ts#L16)

```text
function normalizeDomain(value: string): string | undefined
  Normalizes an email-domain value without applying website-specific policy.

  Unlike website normalization, this function never strips `www.` because an
  email domain must be interpreted exactly as supplied after IDNA conversion.
```

### normalize: normalizeHostname

[Declaration source](normalize.ts#L28)

```text
function normalizeHostname(value: string): string | undefined
  Normalizes a website or bare-hostname value to an ASCII hostname.
```

## types

Import `@okikio/email/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source       |
| ---------------- | ------------------------------ |
| `CsvColumn`      | [csv contracts](../csv/API.md) |

### types: DomainSource

[Declaration source](types.ts#L59)

```text
interface DomainSource
  Exact provenance for one normalized hostname candidate.

  readonly row: number
    Logical source row associated with this observation.
  readonly column: number
    Source column associated with this observation.
  readonly header: string
    Source or protocol header associated with this observation.
  readonly value: string
    Value carried by this contract; its schema and owner define the accepted shape.
  readonly candidate: string
    One candidate interpretation with its source evidence.
  readonly kind: DomainSourceKind
    Stable discriminant that selects the documented variant.
```

### types: EmailDomainClassification

[Declaration source](types.ts#L35)

```text
interface EmailDomainClassification
  Multi-trait classification that preserves conflicts instead of hiding them.

  readonly domain: string
    Normalized domain evidence; classification does not prove deliverability or ownership.
  readonly evidence: readonly EmailDomainEvidence[]
    Source observations supporting the classifier result.
```

### types: EmailDomainClassifier

[Declaration source](types.ts#L43)

```text
interface EmailDomainClassifier
  Immutable classifier used by extraction and product-specific policy.

  readonly classify: (domain: string) => EmailDomainClassification
    Return independent domain evidence without performing network verification or product admission.
```

### types: EmailDomainEvidence

[Declaration source](types.ts#L21)

```text
interface EmailDomainEvidence
  Auditable evidence returned by the classifier.

  readonly trait: EmailDomainTrait
    Independent domain trait reported by the classifier.
  readonly provider?: string
    Optional provider identity reported by the matched domain-classification rule.
  readonly matchedDomain: string
    Domain evidence that matched this classification rule.
  readonly match: "exact" | "suffix" | "parent"
    Rule-match evidence retained by the classifier.
  readonly source: string
    Source representation or provenance retained alongside the interpreted value.
```

### types: EmailDomainRule

[Declaration source](types.ts#L9)

```text
interface EmailDomainRule
  One static rule contributed by a known email provider.

  readonly trait: EmailDomainTrait
    Fact supported when the rule matches.
  readonly provider: string
    Human-readable provider name.
  readonly domain: string
    Lowercase ASCII hostname without a leading `@`.
  readonly match: EmailDomainRuleMatch
    Exact hostname or whole-label suffix matching.
```

### types: EmailRowDomain

[Declaration source](types.ts#L85)

```text
interface EmailRowDomain
  Domain extraction result for one streamed source row.

  readonly row: number
    Logical source row associated with this observation.
  readonly company?: string
    Optional provider or company evidence associated with the domain rule.
  readonly primary: RowDomainCandidate
    Primary selected interpretation or source occurrence.
  readonly candidates: readonly RowDomainCandidate[]
    Candidate interpretations retained before selecting one interpretation.
```

### types: RowDomainCandidate

[Declaration source](types.ts#L75)

```text
interface RowDomainCandidate
  One normalized candidate found in a source row.

  readonly domain: string
    Normalized domain evidence; classification does not prove deliverability or ownership.
  readonly confidence: number
    Evidence confidence under this classifier; it is not a guarantee of external truth.
  readonly sources: readonly DomainSource[]
    Original source evidence retained by this result.
```

### types: DomainColumnType

[Declaration source](types.ts#L52)

```text
type DomainColumnType = CsvColumn & Readonly<{ role: DomainSourceKind | "company" | "unknown"; }>
  CSV column after a caller assigns the semantic role used by domain extraction.
```

### types: DomainSourceKind

[Declaration source](types.ts#L49)

```text
type DomainSourceKind = "domain" | "email" | "website"
  How a hostname was extracted from a source value.
```

### types: EmailDomainRuleMatch

[Declaration source](types.ts#L6)

```text
type EmailDomainRuleMatch = "exact" | "suffix"
  Matching strategy used by a provider-owned domain rule.
```

### types: EmailDomainTrait

[Declaration source](types.ts#L3)

```text
type EmailDomainTrait = "public-mailbox" | "privacy-relay" | "disposable"
  Independent facts supported by evidence about an email domain.
```
