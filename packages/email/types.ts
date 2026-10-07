import type { CsvColumn } from '@okikio/csv/types';

/** Independent facts supported by evidence about an email domain. */
export type EmailDomainTrait = 'public-mailbox' | 'privacy-relay' | 'disposable';

/** Matching strategy used by a provider-owned domain rule. */
export type EmailDomainRuleMatch = 'exact' | 'suffix';

/** One static rule contributed by a known email provider. */
export interface EmailDomainRule {
	/** Fact supported when the rule matches. */
	readonly trait: EmailDomainTrait;
	/** Human-readable provider name. */
	readonly provider: string;
	/** Lowercase ASCII hostname without a leading `@`. */
	readonly domain: string;
	/** Exact hostname or whole-label suffix matching. */
	readonly match: EmailDomainRuleMatch;
}

/** Auditable evidence returned by the classifier. */
export interface EmailDomainEvidence {
	/** Independent domain trait reported by the classifier. */
	readonly trait: EmailDomainTrait;
	/** Optional provider identity reported by the matched domain-classification rule. */
	readonly provider?: string;
	/** Domain evidence that matched this classification rule. */
	readonly matchedDomain: string;
	/** Rule-match evidence retained by the classifier. */
	readonly match: 'exact' | 'suffix' | 'parent';
	/** Source representation or provenance retained alongside the interpreted value. */
	readonly source: string;
}

/** Multi-trait classification that preserves conflicts instead of hiding them. */
export interface EmailDomainClassification {
	/** Normalized domain evidence; classification does not prove deliverability or ownership. */
	readonly domain: string;
	/** Source observations supporting the classifier result. */
	readonly evidence: readonly EmailDomainEvidence[];
}

/** Immutable classifier used by extraction and product-specific policy. */
export interface EmailDomainClassifier {
	/** Return independent domain evidence without performing network verification or product admission. */
	readonly classify: (domain: string) => EmailDomainClassification;
}

/** How a hostname was extracted from a source value. */
export type DomainSourceKind = 'domain' | 'email' | 'website';

/** CSV column after a caller assigns the semantic role used by domain extraction. */
export type DomainColumnType =
	& CsvColumn
	& Readonly<{
		role: DomainSourceKind | 'company' | 'unknown';
	}>;

/** Exact provenance for one normalized hostname candidate. */
export interface DomainSource {
	/** Logical source row associated with this observation. */
	readonly row: number;
	/** Source column associated with this observation. */
	readonly column: number;
	/** Source or protocol header associated with this observation. */
	readonly header: string;
	/** Value carried by this contract; its schema and owner define the accepted shape. */
	readonly value: string;
	/** One candidate interpretation with its source evidence. */
	readonly candidate: string;
	/** Stable discriminant that selects the documented variant. */
	readonly kind: DomainSourceKind;
}

/** One normalized candidate found in a source row. */
export interface RowDomainCandidate {
	/** Normalized domain evidence; classification does not prove deliverability or ownership. */
	readonly domain: string;
	/** Evidence confidence under this classifier; it is not a guarantee of external truth. */
	readonly confidence: number;
	/** Original source evidence retained by this result. */
	readonly sources: readonly DomainSource[];
}

/** Domain extraction result for one streamed source row. */
export interface EmailRowDomain {
	/** Logical source row associated with this observation. */
	readonly row: number;
	/** Optional provider or company evidence associated with the domain rule. */
	readonly company?: string;
	/** Primary selected interpretation or source occurrence. */
	readonly primary: RowDomainCandidate;
	/** Candidate interpretations retained before selecting one interpretation. */
	readonly candidates: readonly RowDomainCandidate[];
}
