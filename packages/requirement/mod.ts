/**
 * Keep declarations of required capabilities separate from the host that interprets them. Hard-coding a billing or permission SDK into each resource makes definitions impossible to inspect without starting that SDK.
 *
 * Attach requirements to definitions, inspect the reachable graph for deployment planning, and apply only the requirements active on the current execution path. Each semantic family owns its interpreter and failures. The example interpreter records admission in memory; replace it with real policy before using it for access control. Missing interpreters reject by default. Scope views borrow their owner context.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as context from '@okikio/context';
 * import * as requirement from '@okikio/requirement';
 * const Feature = Object.freeze({ kind: 'entitlement', id: 'export.csv' });
 * const NeedsExport = requirement.define({ family: 'entitlement', action: 'require', definition: Feature });
 * await using owner = context.create({ id: 'export' });
 * const applied: string[] = [];
 * const ctx = requirement.scope(owner, { interpreters: {
 *   entitlement: { async apply(_ctx, entries) { applied.push(...entries.map((entry) => entry.definition.id)); } },
 * } });
 * await requirement.apply(ctx, [NeedsExport]);
 * console.log(applied.join(','));
 * ```
 *
 * @module
 */
import { compose } from './definition.ts';
export { catalog, compose, define, document, family, is } from './definition.ts';
import * as context from '@okikio/context';
import type {
	RequirementContext,
	RequirementDefinition,
	RequirementInput,
	RequirementRuntime,
	RequirementScopeOptions,
} from './types.ts';

/** Error raised when active work reaches a requirement family without an interpreter. */
export class UnsupportedRequirementError extends Error {
	/** Stable requirement family that the current host cannot interpret. */
	readonly family: string;
	/** Active requirements that require an explicit interpreter or ignore policy. */
	readonly requirements: readonly RequirementDefinition[];

	/** Create one fail-closed error for an active family with no configured policy. */
	constructor(family: string, requirements: readonly RequirementDefinition[]) {
		super(`Active requirement family ${JSON.stringify(family)} has no configured interpreter.`);
		this.name = 'UnsupportedRequirementError';
		this.family = family;
		this.requirements = requirements;
	}
}

/**
 * Create a borrowed requirement-aware view of an existing execution context.
 *
 * Unknown active families reject by default. A test or intentionally permissive
 * host must opt in to `unknown: 'ignore'`; omission never silently disables a
 * production requirement family.
 */
export function scope<Base extends import('@okikio/context').Context>(
	ctx: Base,
	options: RequirementScopeOptions = {},
): RequirementContext<Base> {
	const runtime: RequirementRuntime = Object.freeze({
		interpreters: Object.freeze({ ...(options.interpreters ?? {}) }),
		unknown: options.unknown ?? 'reject',
	});
	return context.view(ctx, { requirements: runtime });
}

/**
 * Attach runtime views supplied by configured requirement-family interpreters.
 *
 * Reachable requirements are declaration evidence only. `bind()` never applies
 * them. It lets families such as permissions expose runtime operations for
 * later dynamic checks while `apply()` remains the only activation operation.
 */
export function bind<Base extends import('@okikio/context').Context>(ctx: Base, input: RequirementInput): Base {
	let current: import('@okikio/context').Context = ctx;
	const state = runtime(ctx);
	const groups = group(compose(input));
	for (const [familyName, entries] of groups) {
		const interpreter = state.interpreters[familyName];
		if (interpreter?.scope === undefined) continue;
		current = interpreter.scope(current, entries);
	}
	return current as Base;
}

/**
 * Apply requirements that are active at the current execution point.
 *
 * Families are grouped once, then each configured interpreter receives its
 * authored order. An unknown family follows the scope's explicit policy.
 */
export async function apply(ctx: import('@okikio/context').Context, input: RequirementInput): Promise<void> {
	context.check(ctx);
	const entries = compose(input);
	if (entries.length === 0) return;
	const state = runtime(ctx);

	for (const [familyName, familyEntries] of group(entries)) {
		context.check(ctx);
		const interpreter = state.interpreters[familyName];
		if (interpreter === undefined) {
			if (state.unknown === 'ignore') continue;
			throw new UnsupportedRequirementError(familyName, Object.freeze([...familyEntries]));
		}
		await interpreter.apply(ctx, Object.freeze([...familyEntries]));
	}
	context.check(ctx);
}

/**
 * Return the requirement runtime attached to a context, or the fail-closed
 * default used by plain contexts.
 *
 * A plain context is valid for work with no active requirements. The first
 * active requirement on such a context rejects rather than silently disabling
 * policy.
 */
function runtime(ctx: import('@okikio/context').Context): RequirementRuntime {
	const candidate = (ctx as import('@okikio/context').Context & { readonly requirements?: unknown }).requirements;
	if (candidate === undefined) return Object.freeze({ interpreters: Object.freeze({}), unknown: 'reject' });
	if (typeof candidate !== 'object' || candidate === null) {
		throw new TypeError('Context requirements runtime is invalid.');
	}
	const value = candidate as Partial<RequirementRuntime>;
	if (typeof value.interpreters !== 'object' || value.interpreters === null) {
		throw new TypeError('Context requirement interpreters must be an object.');
	}
	if (value.unknown !== 'reject' && value.unknown !== 'ignore') {
		throw new TypeError('Context requirement unknown policy must be reject or ignore.');
	}
	return value as RequirementRuntime;
}

/** Group authored requirements by family while preserving first-family and entry order. */
function group(input: readonly RequirementDefinition[]): ReadonlyMap<string, readonly RequirementDefinition[]> {
	const grouped = new Map<string, RequirementDefinition[]>();
	for (const entry of input) {
		const values = grouped.get(entry.family);
		if (values === undefined) grouped.set(entry.family, [entry]);
		else values.push(entry);
	}
	return new Map([...grouped].map(([familyName, values]) => [familyName, Object.freeze(values)] as const));
}

export type {
	RequirementCatalog,
	RequirementCatalogOptions,
	RequirementContext,
	RequirementDefinition,
	RequirementDocument,
	RequirementInput,
	RequirementInterpreter,
	RequirementOptions,
	RequirementPathType,
	RequirementRuntime,
	RequirementScopeOptions,
	UnknownRequirementPolicyType,
} from './types.ts';
