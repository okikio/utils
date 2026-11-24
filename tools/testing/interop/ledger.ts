/**
 * The ledger: every cell key that passed, with where it passed. A cell whose key is in the ledger does not run again.
 *
 * CI keeps the ledger as a workflow artifact, which lasts 90 days from its last upload, instead of in the Actions
 * cache, which drops an entry after 7 days without use. Each run that consults it uploads it again, so a key stays
 * known while CI runs at all.
 *
 * @module
 */

/** Where and when one cell key passed. */
export interface PassType {
	readonly target: string;
	readonly client: string;
	/** The commit that passed. */
	readonly sha: string;
	/** The workflow run that passed, for its logs. */
	readonly run: string;
	/** When it passed, as ISO 8601 text. */
	readonly at: string;
}

/** The ledger file. */
export interface LedgerType {
	readonly version: 1;
	readonly cells: Readonly<Record<string, PassType>>;
}

/** An empty ledger. */
export const empty: LedgerType = Object.freeze({ version: 1, cells: Object.freeze({}) });

/** Read a ledger from JSON, refusing anything that is not one, so a corrupt file means "run" and never "skip". */
export function parse(text: string): LedgerType {
	const value = JSON.parse(text) as Partial<LedgerType>;
	if (value.version !== 1 || typeof value.cells !== 'object' || value.cells === null || Array.isArray(value.cells)) {
		throw new TypeError('Not an interop ledger.');
	}
	for (const [key, pass] of Object.entries(value.cells)) {
		const ok = /^interop-v1-[0-9a-f]{64}$/u.test(key) && typeof pass?.target === 'string' &&
			typeof pass.client === 'string' && /^[0-9a-f]{40}$/u.test(pass.sha) && /^\d+$/u.test(pass.run) &&
			!Number.isNaN(Date.parse(pass.at));
		if (!ok) throw new TypeError(`Ledger entry ${key} is malformed.`);
	}
	return value as LedgerType;
}

/** Combine ledgers. For a key in several, the latest pass wins. */
export function merge(...ledgers: readonly LedgerType[]): LedgerType {
	const cells: Record<string, PassType> = {};
	for (const ledger of ledgers) {
		for (const [key, pass] of Object.entries(ledger.cells)) {
			const known = cells[key];
			if (!known || Date.parse(pass.at) > Date.parse(known.at)) cells[key] = pass;
		}
	}
	return { version: 1, cells };
}

/**
 * Drop keys no current cell has that are older than `days`, so the ledger keeps every current key and some history,
 * for a change that is reverted, without growing forever.
 */
export function prune(ledger: LedgerType, current: ReadonlySet<string>, now: Date, days = 120): LedgerType {
	const cutoff = now.getTime() - days * 86_400_000;
	return {
		version: 1,
		cells: Object.fromEntries(
			Object.entries(ledger.cells).filter(([key, pass]) => current.has(key) || Date.parse(pass.at) >= cutoff),
		),
	};
}
