/** One parsed robots.txt directive with source line identity. */
export interface RobotsRecord {
	readonly field: string;
	readonly value: string;
	readonly line: number;
}

/** One user-agent policy group. */
export interface RobotsGroup {
	readonly userAgents: readonly string[];
	readonly rules: readonly RobotsRule[];
}

/** One Allow or Disallow rule. */
export interface RobotsRule {
	readonly kind: 'allow' | 'disallow';
	readonly pattern: string;
	readonly line: number;
}

/** Parse-once robots.txt representation. */
export interface RobotsDocument {
	readonly groups: readonly RobotsGroup[];
	readonly sitemaps: readonly string[];
	readonly extensions: readonly RobotsRecord[];
	readonly records: readonly RobotsRecord[];
}

/** Parse one bounded robots.txt string without HTTP policy. */
export function parse(text: string): RobotsDocument {
	const records: RobotsRecord[] = [];
	const sitemaps: string[] = [];
	const extensions: RobotsRecord[] = [];
	const groups: Array<{ userAgents: string[]; rules: RobotsRule[] }> = [];
	let group: { userAgents: string[]; rules: RobotsRule[] } | undefined;
	let seenRule = false;

	for (const [index, sourceLine] of text.split(/\r?\n/u).entries()) {
		const line = sourceLine.replace(/#.*/u, '').trim();
		if (!line) continue;
		const separator = line.indexOf(':');
		if (separator < 0) continue;
		const field = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();
		const record = { field, value, line: index + 1 } satisfies RobotsRecord;
		records.push(record);

		if (field === 'user-agent') {
			if (!group || seenRule) {
				group = { userAgents: [], rules: [] };
				groups.push(group);
				seenRule = false;
			}
			if (value) group.userAgents.push(value.toLowerCase());
			continue;
		}
		if (field === 'allow' || field === 'disallow') {
			if (!group) {
				group = { userAgents: ['*'], rules: [] };
				groups.push(group);
			}
			seenRule = true;
			if (value || field === 'allow') group.rules.push({ kind: field, pattern: value, line: index + 1 });
			continue;
		}
		if (field === 'sitemap') {
			if (isHttpUrl(value) && !sitemaps.includes(value)) sitemaps.push(value);
			continue;
		}
		extensions.push(record);
	}

	return { groups, sitemaps, extensions, records };
}

/** Get absolute Sitemap declarations from a parsed robots.txt document. */
export function getSitemapUrls(document: RobotsDocument): readonly string[] {
	return document.sitemaps;
}

/**
 * Evaluate basic robots Allow/Disallow matching for one URL.
 *
 * This implements longest-pattern selection with Allow winning equal-length
 * ties, plus `*` and terminal `$`. It is intentionally covered by local corpus
 * tests but is not yet claimed Google-parity until the upstream corpus gate runs.
 */
export function match(document: RobotsDocument, input: { readonly userAgent: string; readonly url: string }): boolean {
	const url = new URL(input.url);
	const agent = input.userAgent.toLowerCase();
	const matches = document.groups.flatMap((candidate) => {
		const specificity = candidate.userAgents.reduce((best, value) => {
			if (value === '*') return Math.max(best, 0);
			return agent.includes(value) ? Math.max(best, value.length) : best;
		}, -1);
		return specificity < 0 ? [] : [{ candidate, specificity }];
	});
	if (matches.length === 0) return true;
	const bestSpecificity = Math.max(...matches.map((match) => match.specificity));
	const matchingGroups = matches.filter((match) => match.specificity === bestSpecificity).map((match) => match.candidate);
	const path = `${url.pathname}${url.search}`;
	let winner: RobotsRule | undefined;
	let winnerLength = -1;
	for (const group of matchingGroups) {
		for (const rule of group.rules) {
			if (!rule.pattern || !patternMatches(rule.pattern, path)) continue;
			const length = rule.pattern.replace(/[*$]/gu, '').length;
			if (length > winnerLength || (length === winnerLength && rule.kind === 'allow')) {
				winner = rule;
				winnerLength = length;
			}
		}
	}
	return winner?.kind !== 'disallow';
}

function patternMatches(pattern: string, path: string): boolean {
	const terminal = pattern.endsWith('$');
	const source = terminal ? pattern.slice(0, -1) : pattern;
	const expression = source.split('*').map(escapeRegExp).join('.*');
	return new RegExp(`^${expression}${terminal ? '$' : ''}`, 'u').test(path);
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function isHttpUrl(value: string): boolean {
	try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; }
}
