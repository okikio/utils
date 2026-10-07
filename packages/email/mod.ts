/**
 * Runtime-neutral email-domain normalization, classification, and extraction.
 *
 * Classification returns independent evidence rather than forcing public,
 * privacy, and disposable domains into one mutually exclusive enum.
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
