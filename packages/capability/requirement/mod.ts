/**
 * Record what an operation needs before asking application policy whether it may proceed.
 * A requirement is a declaration, such as the export feature needed by a report. Its family
 * selects an interpreter: an application callback that understands that kind of rule.
 *
 * Definitions can be inspected without starting a billing or permission SDK. During execution,
 * apply() invokes the interpreters for the active requirements and waits for their decisions.
 * Missing interpreters reject by default. A scoped view borrows its Context lifetime.
 *
 * The example records which requirements reached its callback. It demonstrates the handoff,
 * not an access decision. An application must supply trusted account policy before using the
 * callback to protect work.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as context from '@okikio/context';
 * import * as requirement from '@okikio/capability/requirement';
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
import { compose, is } from './definition.ts';
export { catalog, compose, define, document, family, is } from './definition.ts';
import * as context from '@okikio/context';
import type {
	RequirementContext,
	RequirementDefinition,
	RequirementInput,
	RequirementInterpreter,
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
 * production requirement family. Omitting options preserves an existing
 * requirement view. Supplying options replaces its interpreter set explicitly.
 */
export function scope<Base extends import('@okikio/context').Context>(
	ctx: Base,
	options?: RequirementScopeOptions,
): RequirementContext<Base> {
	const selected = options ?? runtime(ctx);
	const configured: RequirementRuntime = Object.freeze({
		interpreters: Object.freeze({ ...(selected.interpreters ?? {}) }),
		unknown: selected.unknown ?? 'reject',
	});
	return context.view(ctx, { requirements: configured });
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
		const interpreter = configured(state, familyName);
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
		await activate(ctx, familyName, familyEntries, state);
	}
	context.check(ctx);
}

/** One family outcome contains only public declaration identity and redacted status. */
export interface ExplanationType {
	/** Stable family owning these requirement semantics. */
	readonly family: string;
	/** Authored requirement identities, deduplicated by ordinary compose(). */
	readonly requirements: readonly string[];
	/** Configured is metadata only; allowed means this explicit apply completed, never a reusable grant. */
	readonly outcome: 'configured' | 'allowed' | 'denied' | 'fault' | 'unsupported' | 'ignored' | 'unreached';
}
/** Explain a finite already-composed declaration set; inspection never invokes an interpreter. */
export interface ExplainOptions {
	/** Maximum input entries checked before composition or interpreter calls. */
	readonly maximumRequirements: number;
	/** apply activates real requirements and can have side effects. inspect reads configuration only. */
	readonly mode: 'inspect' | 'apply';
	/** Recognize the owning family's expected denial. Omission classifies every evaluator exception as fault. */
	readonly denied?: (error: unknown, family: string) => boolean;
}

/**
 * Inspect configured enforcement or explicitly apply requirements with redacted outcome evidence.
 * Apply mode uses the same grouped activation as apply(), stops after the first rejection and marks
 * later families unreached. Denials require the caller's exact family classifier; error text is never
 * guessed or retained. Cancellation and classifier defects propagate. Reports are snapshots, not
 * authorization, retry instructions or proof of future operation success. Pass a flat declaration
 * array so its bound is meaningful before normalization; compose catalogs at their trusted owner.
 */
export async function explain(
	ctx: context.Context,
	input: readonly RequirementDefinition[],
	options: ExplainOptions,
): Promise<readonly ExplanationType[]> {
	const { maximumRequirements, mode, denied } = options;
	if (
		!Number.isSafeInteger(maximumRequirements) || maximumRequirements < 0 || input.length > maximumRequirements ||
		!['inspect', 'apply'].includes(mode) || (denied !== undefined && typeof denied !== 'function')
	) throw new RangeError('Invalid requirement explanation bound or mode.');
	for (const entry of input) if (!is(entry)) throw new TypeError('Explanation requires flat requirement definitions.');
	context.check(ctx);
	const state = runtime(ctx);
	const output: ExplanationType[] = [];
	let stopped = false;
	for (const [family, entries] of group(compose(input))) {
		context.check(ctx);
		let outcome: ExplanationType['outcome'];
		if (stopped) outcome = 'unreached';
		else if (configured(state, family) === undefined) {
			outcome = state.unknown === 'ignore' ? 'ignored' : 'unsupported';
			if (mode === 'apply' && outcome === 'unsupported') stopped = true;
		} else if (mode === 'inspect') outcome = 'configured';
		else {
			try {
				await activate(ctx, family, entries, state);
				outcome = 'allowed';
			} catch (error) {
				context.check(ctx);
				const rejected = denied?.(error, family) ?? false;
				if (typeof rejected !== 'boolean') throw new TypeError('Requirement denial classifier must return boolean.');
				outcome = rejected ? 'denied' : 'fault';
				stopped = true;
			}
		}
		output.push(Object.freeze({ family, requirements: Object.freeze(entries.map((entry) => entry.id)), outcome }));
	}
	context.check(ctx);
	return Object.freeze(output);
}

/** Only own interpreter entries configure a family; Object.prototype names must stay fail-closed. */
function configured(state: RequirementRuntime, family: string): RequirementInterpreter | undefined {
	return Object.hasOwn(state.interpreters, family) ? state.interpreters[family] : undefined;
}

/** Shared activation authority. Both ordinary application and explanation call each active family once. */
async function activate(
	ctx: context.Context,
	family: string,
	entries: readonly RequirementDefinition[],
	state: RequirementRuntime,
): Promise<void> {
	context.check(ctx);
	const interpreter = configured(state, family);
	if (interpreter === undefined) {
		if (state.unknown === 'ignore') return;
		throw new UnsupportedRequirementError(family, Object.freeze([...entries]));
	}
	await interpreter.apply(ctx, Object.freeze([...entries]));
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
