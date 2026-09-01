import { DISPOSABLE_DOMAINS } from './data/disposable.ts'
import { PRIVACY_DOMAIN_RULES, PUBLIC_DOMAIN_RULES } from './data/providers.ts'
import { normalizeDomain } from './normalize.ts'
import type {
	EmailDomainClassification,
	EmailDomainClassifier,
	EmailDomainEvidence,
	EmailDomainRule,
	EmailDomainRuleMatch,
	EmailDomainTrait,
} from './types.ts'

const EMAIL_DOMAIN_TRAITS = Object.freeze({
	'public-mailbox': true,
	'privacy-relay': true,
	disposable: true,
} satisfies Record<EmailDomainTrait, true>)
const EMAIL_DOMAIN_RULE_MATCHES = Object.freeze({ exact: true, suffix: true } satisfies Record<EmailDomainRuleMatch, true>)

/** Default immutable provider rules evaluated by the classifier. */
const DEFAULT_RULES = Object.freeze([
	...PUBLIC_DOMAIN_RULES,
	...PRIVACY_DOMAIN_RULES,
])
/** Exact lookup table for the vendored disposable snapshot. */
const DEFAULT_DISPOSABLE_DOMAINS = Object.freeze(
	Object.fromEntries(DISPOSABLE_DOMAINS.map((domain) => [domain, true] as const)) as Readonly<Record<string, true>>,
)

/** Returns whether a hostname matches an exact or whole-label suffix rule. */
function matchesRule(domain: string, rule: EmailDomainRule): boolean {
	return rule.match === 'exact'
		? domain === rule.domain
		: domain === rule.domain || domain.endsWith(`.${rule.domain}`)
}

/** Finds the closest blocklisted parent without ever checking a top-level suffix alone. */
function matchDisposableParent(
	domain: string,
	domains: ReadonlySet<string> | Readonly<Record<string, true>>,
): string | undefined {
	let candidate = domain
	while (candidate.includes('.')) {
		if (domains instanceof Set ? domains.has(candidate) : Object.hasOwn(domains, candidate)) return candidate
		const separator = candidate.indexOf('.')
		candidate = candidate.slice(separator + 1)
	}
	return undefined
}

/**
 * Normalizes rule into the canonical internal form used by later phases.
 *
 * It turns email and hostname rules into reusable evidence without making a product-level company-domain decision.
 *
 * @internal
 */
function normalizeRule(rule: EmailDomainRule, index: number): EmailDomainRule {
	if (!Object.hasOwn(EMAIL_DOMAIN_TRAITS, rule.trait)) {
		throw new TypeError(`Email-domain rule ${index + 1} has an unsupported trait.`)
	}
	if (!Object.hasOwn(EMAIL_DOMAIN_RULE_MATCHES, rule.match)) {
		throw new TypeError(`Email-domain rule ${index + 1} has an unsupported match strategy.`)
	}
	const provider = rule.provider.trim()
	if (!provider) {
		throw new TypeError(`Email-domain rule ${index + 1} requires a provider name.`)
	}
	const domain = normalizeDomain(rule.domain)
	if (!domain) {
		throw new TypeError(`Email-domain rule ${index + 1} has an invalid domain.`)
	}
	return Object.freeze({
		trait: rule.trait,
		provider,
		domain,
		match: rule.match,
	})
}

/**
 * Normalizes rules into the canonical internal form used by later phases.
 *
 * @internal
 */
function normalizeRules(rules: readonly EmailDomainRule[]): readonly EmailDomainRule[] {
	const normalized = new Map<string, EmailDomainRule>()
	for (const [index, rule] of rules.entries()) {
		const value = normalizeRule(rule, index)
		const key = `${value.trait}:${value.provider}:${value.domain}:${value.match}`
		normalized.set(key, value)
	}
	return Object.freeze([...normalized.values()])
}

/**
 * Normalizes disposable domains into the canonical internal form used by later phases.
 *
 * @internal
 */
function normalizeDisposableDomains(domains: readonly string[]): ReadonlySet<string> {
	const normalized = new Set<string>()
	for (const [index, value] of domains.entries()) {
		const domain = normalizeDomain(value)
		if (!domain) {
			throw new TypeError(`Disposable email domain ${index + 1} is invalid.`)
		}
		normalized.add(domain)
	}
	return normalized
}

/** Creates a runtime-neutral classifier from plain immutable domain data. */
export function createDomainClassifier(options: {
	readonly rules?: readonly EmailDomainRule[]
	readonly disposableDomains?: readonly string[]
} = {}): EmailDomainClassifier {
	const rules = options.rules === undefined ? DEFAULT_RULES : normalizeRules(options.rules)
	const disposable = options.disposableDomains === undefined
		? DEFAULT_DISPOSABLE_DOMAINS
		: normalizeDisposableDomains(options.disposableDomains)

	return Object.freeze({
		/**
		 * Classifies input into the classify used by email and hostname classification.
		 *
		 * Email internals produce reusable classification evidence without making product-level company or account decisions.
		 *
		 * @internal
		 */
		classify(value: string): EmailDomainClassification {
			const domain = normalizeDomain(value)
			if (!domain) {
				return Object.freeze({
					domain: value.trim().toLowerCase(),
					evidence: Object.freeze([]),
				})
			}

			const evidence: EmailDomainEvidence[] = []
			for (const rule of rules) {
				if (!matchesRule(domain, rule)) continue
				evidence.push(Object.freeze({
					trait: rule.trait,
					provider: rule.provider,
					matchedDomain: rule.domain,
					match: rule.match,
					source: 'builtin-provider-rules',
				}))
			}

			const matchedDomain = matchDisposableParent(domain, disposable)
			if (matchedDomain) {
				evidence.push(Object.freeze({
					trait: 'disposable',
					matchedDomain,
					match: matchedDomain === domain ? 'exact' : 'parent',
					source: 'disposable-email-domains',
				}))
			}

			return Object.freeze({ domain, evidence: Object.freeze(evidence) })
		},
	})
}

/** Shared default classifier for callers that do not need policy injection. */
export const DEFAULT_DOMAIN_CLASSIFIER = createDomainClassifier()
