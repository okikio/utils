/** Stable challenger identities are data so report validation does not import candidate implementations. @module */

/** Exact fixture selectors; an unknown display name cannot select another implementation. */
export const challengerCandidates = ['utils', 'hono', 'elysia', 'vixeny'] as const;
/** One candidate qualified on the selected native workload runtime. */
export type ChallengerCandidateType = typeof challengerCandidates[number];
/** Display aliases remain stable for report coverage and statistical pairing. */
export const challengerNames = { utils: 'Utils', hono: 'Hono', elysia: 'Elysia', vixeny: 'Vixeny' } as const;
