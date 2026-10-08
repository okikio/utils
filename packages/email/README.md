# `@okikio/email`

A contact import contains the domain `Example.COM`, but another row says `example.com`. You want both spellings to mean
the same domain before comparing records. `email` normalizes domains and can report known mailbox-provider,
privacy-relay or disposable-domain evidence. It helps explain a domain; it does not verify the person's identity.

| Input to `normalizeDomain()` | Result        | Meaning                                               |
| ---------------------------- | ------------- | ----------------------------------------------------- |
| `Example.COM`                | `example.com` | One spelling for domain comparisons.                  |
| `@Example.COM`               | `example.com` | A leading `@` is removed.                             |
| `person@example.com`         | `undefined`   | This operation expects a domain, not a whole address. |

This table describes normalization only. It does not prove that the domain has working mail service, belongs to a
company, or appears in a classification list.

The [full API reference](API.md) describes classification rules and row-extraction evidence.

## Run a complete example

```ts runnable
import * as email from '@okikio/email';
console.log(email.normalizeDomain('Example.COM'));
console.log(email.normalizeDomain('@Example.COM'));
console.log(email.normalizeDomain('person@example.com'));
```

Expected output:

```text output
example.com
example.com
undefined
```

The demo normalizes two spellings of the same domain and rejects a whole address. That input check earns more than a
plain lowercase operation: the caller can distinguish a usable domain from text that needs address extraction. For
email-like text containing addresses, use `extractDomains()` instead.

## Compare two imports without changing their evidence

This is ordinary array processing with a normalization step. Invalid domain cells are excluded here by explicit
application choice; you could instead retain them for a correction screen.

```ts runnable=unique-domains.ts
import { normalizeDomain } from '@okikio/email';

const cells = ['Example.COM', '@example.com', 'support.example.com', 'not a domain'];
const normalized = cells.map(normalizeDomain).filter((domain) => domain !== undefined);
console.log(JSON.stringify([...new Set(normalized)]));
```

```text output
["example.com","support.example.com"]
```

| Call or value                      | Contract                                                                 | Meaning                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `normalizeDomain(text)`            | String → normalized ASCII hostname or `undefined`                        | Expects a domain; never strips `www.`.                                                         |
| `normalizeHostname(text)`          | Website or hostname → normalized hostname or `undefined`                 | Can read a URL and removes a leading `www.`. This is a different input policy.                 |
| `createDomainClassifier(options?)` | Rules and disposable domain list → frozen object with `classify(domain)` | Supplying each option replaces that default dataset.                                           |
| Classification                     | `{ domain, evidence: readonly EmailDomainEvidence[] }`                   | Each item names a trait, matched domain, matching rule and source. Several traits may coexist. |

Under the hood, normalization trims framing, uses `URL` for international hostname conversion, then checks DNS label
shape. Classification checks exact or whole-label suffix rules and walks parent labels against the disposable list. It
collects every supported trait instead of collapsing them into “good” or “bad.” This design lets signup review, contact
enrichment and analytics use the same evidence with different policies. No operation checks a mailbox or DNS.

## Build on the example

- Read a contact export with [CSV](../csv/README.md), then normalize domain fields before de-duplicating or enriching
  records. Keep each original address where the import needs source evidence.
- Use [Result](../result/README.md) to carry an explicit “invalid domain” branch. A classification such as privacy relay
  remains evidence for your product decision; it is not an automatic rejection rule.

## Try a contact import with explicit classification rules

This supplied CSV has a domain column. CSV reads the rows; Email normalizes each domain and compares it with the rules
we chose for this demo. The custom list keeps the exercise independent of changes to built-in provider data.

```ts runnable=contact-domains.ts
import * as csv from '@okikio/csv';
import * as email from '@okikio/email';

const contacts = csv.parse('Name,Domain\nAda,Example.COM\nLin,temporary.example.invalid\n', { headerRow: 1 });
const classifier = email.createDomainClassifier({ rules: [], disposableDomains: ['temporary.example.invalid'] });
for (const row of contacts.rows) {
	const domain = email.normalizeDomain(row.values[1] ?? '');
	if (domain === undefined) {
		console.log(`${row.values[0]}: invalid domain`);
		continue;
	}
	const traits = classifier.classify(domain).evidence.map((entry) => entry.trait);
	console.log(`${row.values[0]}: ${domain}; ${traits.length === 0 ? 'no listed trait' : traits.join(',')}`);
}
```

Expected output:

```text output
Ada: example.com; no listed trait
Lin: temporary.example.invalid; disposable
```

The first row has no matching trait in the supplied list; that does not prove a company mailbox or deliverability. The
second row matches our explicit disposable list. Change that list to change the classification policy's input, then let
your application decide whether to accept, flag or reject a contact. This demo makes no network request.

## Inject a caller-owned classification set

```ts
import * as email from '@okikio/email';

const classifier = email.createDomainClassifier({
	disposableDomains: ['temporary.example.invalid'],
	rules: [{
		domain: 'relay.example.invalid',
		trait: 'privacy-relay',
		provider: 'Example Relay',
		match: 'suffix',
	}],
});

const classification = classifier.classify('team.relay.example.invalid');
console.log(classification.evidence.map((item) => item.trait)); // ['privacy-relay']
```

The injected data is normalized once when the classifier is created. Product policy still stays outside this package.

## How it fits

Import or lead logic can use this evidence when it decides whether an email address can identify a company domain. The
package does not make that product decision itself.

Runtime-neutral email-domain utilities. The package performs no network, DNS, filesystem, database, or framework I/O.

```text
email or hostname
      |
      v
normalization ----------> invalid / unknown
      |
      v
provider rules + disposable parent matching
      |
      v
independent evidence: public-mailbox, privacy-relay, disposable
```

## Why evidence is multi-trait

| Trait            | Meaning                               | Typical extraction policy                              |
| ---------------- | ------------------------------------- | ------------------------------------------------------ |
| `public-mailbox` | Provider-operated consumer mailbox    | Exclude as a company domain                            |
| `privacy-relay`  | Stable or masked forwarding identity  | Exclude as a company domain, do not call disposable    |
| `disposable`     | Known temporary or abuse-prone domain | Exclude and let product policy decide whether to block |

Custom domains used with SimpleLogin, Proton Pass, addy.io, or self-hosted relay software cannot be proven from the
domain alone. An unmatched domain is therefore `unknown`, never automatically `corporate`.

## Disposable snapshot refresh

`data/disposable.ts` records repository, commit, blob, retrieval date, and license. Refresh it as one reviewed change
from `disposable_email_blocklist.conf`, preserving lowercase sorting and duplicates removal. The generated utility must
remain plain TypeScript data so browser, Deno, Node, edge, worker, and test runtimes receive identical behavior.

## Progressive usage

Read [complete compositions](../../docs/composition.md) for a bounded CSV import, allowed-page discovery and a
resource-backed operation. Each example names its result and owner. Use [the outcome guide](../../docs/outcomes.md) to
choose additional mechanisms when the application needs them.

## Convenience and the manual equivalent

| Convenience                      | Manual equivalent                                                                                        | Concrete value                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `email.normalizeDomain()`        | trim, lower-case, remove surrounding syntax, validate hostname labels, and normalize the result yourself | one canonical domain form before classification          |
| `email.createDomainClassifier()` | combine reviewed provider/disposable/privacy rule sets and apply precedence manually                     | repeatable provider classification with caller overrides |
| `email.extractDomains()`         | parse candidate email-like text, normalize each domain, and de-duplicate the results                     | focused extraction without owning a broader NLP pipeline |

`@okikio/email` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics by trimming and
normalizing strings, parsing addresses and classifying known forms.

The utility centralizes those deterministic rules so callers do not invent incompatible email normalization.

## Classification building blocks

The convenience classifier is built from exports that remain useful independently:

- `PUBLIC_DOMAIN_RULES` contains reviewed consumer mailbox rules.
- `PRIVACY_DOMAIN_RULES` contains reviewed privacy/relay mailbox rules.
- `DISPOSABLE_DOMAINS` is the vendored disposable-domain snapshot used by classification.
- `email.extractDomains()` extracts normalized domains from email-like input.
- `normalizeHostname()` normalizes a website hostname before organization/domain comparison.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The [generated API reference](API.md) lists every public function and type. These examples teach the common paths and
the design decisions behind those contracts.
