/**
 * Provider-neutral requirement declarations and active runtime interpretation.
 *
 * Definitions contribute requirements without starting providers. Static graph
 * inspection can retain every reachable requirement, but runtime code applies
 * only requirements that become active on the selected execution path.
 *
 * @module
 */
import * as catalog from '@okikio/catalog';
import type { CatalogEntryIdentity } from '@okikio/catalog';
import * as context from '@okikio/context';
import type {
	RequirementContext,
	RequirementDefinition,
	RequirementDocument,
	RequirementInput,
	RequirementOptions,
	RequirementRuntime,
	RequirementScopeOptions,
} from './types.ts';

/** Exact requirement definitions memoized by domain definition, family, and action. */
const definitions = new WeakMap<CatalogEntryIdentity, Map<string, RequirementDefinition>>();

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

/** Define one immutable requirement without implementing its domain semantics. */
export function define<
	const Family extends string,
	const Action extends string,
	Entry extends CatalogEntryIdentity,
>(input: RequirementOptions<Family, Action, Entry>): RequirementDefinition<Family, Action, Entry> {
	assertPart(input.family, 'requirement family');
	assertPart(input.action, 'requirement action');
	if (!input.definition || typeof input.definition.id !== 'string' || typeof input.definition.kind !== 'string') {
		throw new TypeError('Requirement definition must be a catalog definition.');
	}

	const key = `${input.family}:${input.action}`;
	const owned = definitions.get(input.definition) ?? new Map<string, RequirementDefinition>();
	const existing = owned.get(key);
	if (existing !== undefined) {
		if (existing.description !== input.description) {
			throw new TypeError(`Requirement ${JSON.stringify(existing.id)} was defined with different descriptions.`);
		}
		return existing as RequirementDefinition<Family, Action, Entry>;
	}

	const value: RequirementDefinition<Family, Action, Entry> = Object.freeze({
		kind: 'requirement',
		id: `${input.family}:${input.action}:${input.definition.id}`,
		family: input.family,
		action: input.action,
		definition: input.definition,
		...(input.description === undefined ? {} : { description: input.description }),
	});
	owned.set(key, value);
	definitions.set(input.definition, owned);
	return value;
}

/** Compose direct requirements, catalogs, selections, and nested arrays. */
export function compose<Entry extends RequirementDefinition>(...input: readonly RequirementInput<Entry>[]): readonly Entry[] {
	return catalog.compose(...input);
}

/** Return requirements owned by one semantic family. */
export function family<const Family extends string, Entry extends RequirementDefinition>(
	input: RequirementInput<Entry>,
	familyName: Family,
): readonly Extract<Entry, RequirementDefinition<Family, string, CatalogEntryIdentity>>[] {
	return Object.freeze(catalog.values(input).filter((entry) => entry.family === familyName)) as readonly Extract<
		Entry,
		RequirementDefinition<Family, string, CatalogEntryIdentity>
	>[];
}

/** Return whether a value has the generic requirement protocol. */
export function is(value: unknown): value is RequirementDefinition {
	return typeof value === 'object' && value !== null &&
		(value as { kind?: unknown }).kind === 'requirement' &&
		typeof (value as { id?: unknown }).id === 'string' &&
		typeof (value as { family?: unknown }).family === 'string' &&
		typeof (value as { action?: unknown }).action === 'string';
}

/** Create deterministic JSON-safe documentation for requirement definitions. */
export function document(input: RequirementInput): readonly RequirementDocument[] {
	return Object.freeze(catalog.values(input).map((entry) => Object.freeze({
		id: entry.id,
		family: entry.family,
		action: entry.action,
		definition: entry.definition.id,
		definitionKind: entry.definition.kind,
		...(entry.description === undefined ? {} : { description: entry.description }),
	})));
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
	if (typeof candidate !== 'object' || candidate === null) throw new TypeError('Context requirements runtime is invalid.');
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

/** Reject an invalid family/action part before it enters the requirement cache. */
function assertPart(value: string, name: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) throw new TypeError(`Invalid ${name} ${JSON.stringify(value)}.`);
}

export type {
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
