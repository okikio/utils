# `@okikio/email`

Normalize and classify email-domain evidence without inventing application policy. Comparing raw addresses or
maintaining ad hoc domain lists makes casing and subdomain behavior inconsistent.

## Run a complete example

```ts runnable
import * as email from '@okikio/email';
console.log(email.normalizeDomain('Example.COM'));
```

Expected output:

```text output
example.com
```

## Build on the example

Normalize a domain first, then use the supplied classifier or provide your own classification rules. Use the evidence to
route signup review or data enrichment; do not treat domain classification as identity verification or mailbox
deliverability. Network checks, domain ownership, consent and product decisions belong to your application.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/email` normalizes email domains and returns independent evidence about public mailbox providers, privacy
relays, and disposable domains. It performs no network, DNS, filesystem, database, or framework I/O.

## Start here

```ts
import * as email from '@okikio/email';

const domain = email.normalizeDomain('Example.COM');
const evidence = domain === undefined ? undefined : email.DEFAULT_DOMAIN_CLASSIFIER.classify(domain);
```

The classifier returns evidence. It does not decide whether a product should accept, reject, or de-prioritize the
address.

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

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.
