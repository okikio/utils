/**
 * Normalize and classify email-domain evidence without inventing application policy. Comparing raw addresses or maintaining ad hoc domain lists makes casing and subdomain behavior inconsistent.
 *
 * Normalize a domain first, then use the supplied classifier or provide your own classification rules. Use the evidence to route signup review or data enrichment; do not treat domain classification as identity verification or mailbox deliverability. Network checks, domain ownership, consent and product decisions belong to your application.
 *
 * @example
 * ```ts
 * import * as email from '@okikio/email';
 * console.log(email.normalizeDomain('Example.COM'));
 * ```
 *
 * @module
 */
export { createDomainClassifier, DEFAULT_DOMAIN_CLASSIFIER } from './classify.ts';
export { DISPOSABLE_DOMAINS } from './data/disposable.ts';
export { PRIVACY_DOMAIN_RULES, PUBLIC_DOMAIN_RULES } from './data/providers.ts';
export { extractDomains } from './extract.ts';
export { normalizeDomain, normalizeHostname } from './normalize.ts';
export type {
	DomainColumnType,
	DomainSource,
	DomainSourceKind,
	EmailDomainClassification,
	EmailDomainClassifier,
	EmailDomainEvidence,
	EmailDomainRule,
	EmailDomainRuleMatch,
	EmailDomainTrait,
	EmailRowDomain,
	RowDomainCandidate,
} from './types.ts';
