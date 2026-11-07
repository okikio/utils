/**
 * Ask whether an actor may perform an action on a particular object. The application
 * supplies the policy evaluator; this module validates the question and its answer.
 * Exact declaration identity keeps independently authored same-name actions distinct.
 *
 * Start with one target, then combine independent questions with all()/any().
 * Declare reachable permissions at the application boundary and check the current
 * target before protected work. A declaration alone grants no access.
 *
 * The example permits only a public asset. It supplies no authentication or
 * complete gallery policy; unknown or undeclared definitions fail closed.
 *
 * @example
 * ```ts
 * import * as context from '@okikio/context';
 * import * as permission from '@okikio/authz/permission';
 * import * as schema from '@okikio/schema';
 * const TargetSchema = schema.object({ id: schema.string() });
 * const Read = permission.define({ id: 'asset.read', target: TargetSchema });
 * await using owner = context.create({ id: 'reader' });
 * const ctx = permission.scope(owner, {
 *   permissions: [Read],
 *   checker: { maximumChecks: 10, async check(_ctx, requests) {
 *     return requests.map((entry) => ({ allowed: permission.matches(entry, Read) && entry.target.id === 'public' }));
 *   } },
 * });
 * console.log(await permission.check(ctx, Read, { id: 'public' }));
 * console.log(await permission.check(ctx, Read, { id: 'private' }));
 * ```
 *
 * @module
 */
import { decisions } from '../decisions.ts';
import { is as isDeclaredDefinition } from './definition.ts';
import * as catalogCore from '@okikio/collection/catalog';
import * as contextCore from '@okikio/context';
export { catalog, compose, define, is, require, select } from './definition.ts';
import * as schema from '@okikio/schema';
import type {
	PermissionAll,
	PermissionAny,
	PermissionCheck,
	PermissionChecker,
	PermissionContext,
	PermissionDecision,
	PermissionDefinition,
	PermissionExpression,
	PermissionExpressionInput,
	PermissionRequest,
	PermissionRequirement,
	PermissionRuntime,
	PermissionScopeOptions,
	PermissionTargetArguments,
} from './types.ts';

/** Error raised when runtime code checks a permission that was not declared by the execution scope. */
export class UndeclaredPermissionError extends Error {
	/** Exact declared contract object; an independently authored same-name object is not the same declaration. */
	readonly definition: PermissionDefinition;

	/** Retain the exact undeclared action so diagnostics do not reconstruct authority from its ID. */
	constructor(definition: PermissionDefinition) {
		super(`Permission ${JSON.stringify(definition.id)} is not declared by this execution scope.`);
		this.name = 'UndeclaredPermissionError';
		this.definition = definition;
	}
}

/** Error raised when runtime code attempts a permission check without an evaluator. */
export class MissingPermissionCheckerError extends Error {
	/** Refuse evaluation when no application policy owns the answer. */
	constructor() {
		super('Permission checks require an explicit permission evaluator for this execution scope.');
		this.name = 'MissingPermissionCheckerError';
	}
}

/** Error raised when a logical permission batch exceeds the evaluator's explicit limit. */
export class PermissionCheckLimitError extends RangeError {
	/** Number of atomic action/target questions in the rejected logical batch. */
	readonly count: number;
	/** Largest atomic-check batch accepted by this evaluator, independent of its transport chunk size. */
	readonly maximum: number;

	/** Record the attempted atomic-check count and the evaluator limit that refused it. */
	constructor(count: number, maximum: number) {
		super(`Permission check batch contains ${count} atomic checks; the configured maximum is ${maximum}.`);
		this.name = 'PermissionCheckLimitError';
		this.count = count;
		this.maximum = maximum;
	}
}

/** Error raised when a permission evaluator violates the ordered batch result contract. */
export class PermissionDecisionError extends Error {
	/** Report malformed provider output separately from an ordinary access denial. */
	constructor(message: string) {
		super(message);
		this.name = 'PermissionDecisionError';
	}
}

/** Error raised when one atomic permission decision could not be evaluated. */
export class PermissionEvaluationError extends Error {
	/** Exact declared contract object; an independently authored same-name object is not the same declaration. */
	readonly definition: PermissionDefinition;

	/** Attach the original provider fault to the exact action whose decision failed. */
	constructor(definition: PermissionDefinition, cause: unknown) {
		super(`Permission ${JSON.stringify(definition.id)} could not be evaluated.`, { cause });
		this.name = 'PermissionEvaluationError';
		this.definition = definition;
	}
}

/** Error raised by `assert()` only when the evaluator explicitly denies the permission expression. */
export class PermissionDeniedError extends Error {
	/** Exact permission definitions explicitly denied by the evaluator. */
	readonly denied: readonly PermissionDefinition[];

	/** Retain denied declarations without retaining protected target values. */
	constructor(denied: readonly PermissionDefinition[]) {
		const ids = [...new Set(denied.map((definition) => definition.id))];
		super(
			ids.length === 0
				? 'Permission was denied.'
				: `Permission was denied for ${ids.map((id) => JSON.stringify(id)).join(', ')}.`,
		);
		this.name = 'PermissionDeniedError';
		this.denied = Object.freeze([...new Set(denied)]);
	}
}

/**
 * Adapt one permission checker to the generic active-requirement runtime.
 *
 * Targetless permission requirements are admission checks. Target-bearing
 * permissions only declare that later runtime checks are possible because no
 * concrete target exists at definition admission time.
 */
export function interpreter(
	checker?: PermissionChecker,
): import('@okikio/capability/requirement').RequirementInterpreter<PermissionRequirement> {
	if (checker !== undefined) assertChecker(checker);
	return Object.freeze({
		/** Keep the same checker when binding a declared subset; never inherit a prior allow/deny decision. */
		scope(ctx: import('@okikio/context').Context, requirements: readonly PermissionRequirement[]) {
			const definitions = definitionsOf(requirements);
			// Resource borrowing may bind an active subset of an already-declared
			// graph. Reuse only the exact evaluator and declaration identities;
			// adding authority or replacing its evaluator still follows scope()'s
			// existing replacement guard. No provider decision is reused here.
			const existing: unknown = Object.getOwnPropertyDescriptor(ctx, 'permissions')?.value;
			if (typeof existing === 'object' && existing !== null) {
				const runtime = existing as Partial<PermissionRuntime>;
				if (
					runtime.checker === checker && Array.isArray(runtime.permissions) &&
					definitions.every((definition) => runtime.permissions!.includes(definition))
				) return ctx;
			}
			return scope(ctx, {
				permissions: definitions,
				...(checker === undefined ? {} : { checker }),
			});
		},
		/** Enforce targetless declarations at admission; target-aware checks need the operation's actual target. */
		async apply(ctx: import('@okikio/context').Context, requirements: readonly PermissionRequirement[]) {
			const definitions = definitionsOf(requirements).filter(
				(definition): definition is PermissionDefinition<string, undefined> => definition.target === undefined,
			);
			if (definitions.length === 0) return;

			// `requirement.bind()` installs the family view from the reachable graph
			// before admission. Reusing that view keeps one permission authority on
			// the context and prevents an active subset from replacing declarations
			// that later dynamic checks can still need.
			await assert(ctx, all(...definitions));
		},
	});
}

/** Validate and extract permission definitions from generic requirement entries. */
function definitionsOf(requirements: readonly PermissionRequirement[]): readonly PermissionDefinition[] {
	return Object.freeze(requirements.map((entry) => {
		if (entry.family !== 'permission' || entry.action !== 'require' || entry.definition.kind !== 'permission') {
			throw new TypeError(`Invalid permission requirement ${JSON.stringify(entry.id)}.`);
		}
		return entry.definition;
	}));
}

/**
 * Create an immutable runtime check for one permission and optional target.
 *
 * This function performs no I/O. Target validation occurs when `check()`,
 * `assert()`, or `batch()` evaluates the expression because Standard Schema
 * validation can be asynchronous.
 */
export function on<Permission extends PermissionDefinition>(
	definition: Permission,
	...target: PermissionTargetArguments<Permission>
): PermissionCheck<Permission> {
	return direct(definition, target);
}

/** Create one runtime permission leaf after validating target arity. */
function direct<Permission extends PermissionDefinition>(
	definition: Permission,
	target: readonly unknown[],
): PermissionCheck<Permission> {
	assertDefinition(definition);
	const value = target.length === 0 ? undefined : target[0];
	if (definition.target !== undefined && target.length === 0) {
		throw new TypeError(`Permission ${JSON.stringify(definition.id)} requires a target.`);
	}
	if (definition.target === undefined && target.length !== 0) {
		throw new TypeError(`Permission ${JSON.stringify(definition.id)} does not accept a target.`);
	}
	if (target.length > 1) throw new TypeError('Permission checks accept at most one target.');
	return Object.freeze({ kind: 'permission-check', definition, target: value }) as PermissionCheck<Permission>;
}

/** Require every nested runtime permission expression to be allowed. */
export function all(...checks: readonly PermissionExpressionInput[]): PermissionAll {
	const expressions = normalizeExpressions(checks, 'permission.all');
	return Object.freeze({ kind: 'permission-all', checks: expressions });
}

/** Require at least one nested runtime permission expression to be allowed. */
export function any(...checks: readonly PermissionExpressionInput[]): PermissionAny {
	const expressions = normalizeExpressions(checks, 'permission.any');
	return Object.freeze({ kind: 'permission-any', checks: expressions });
}

/**
 * Create an unowned permission-aware view of an existing execution context.
 *
 * The returned scope borrows the parent context, evaluator, and declarations.
 * It does not create cancellation state or own cleanup. Use the existing request
 * Context when one is available; create and dispose an owner only at an operation
 * that does not already have one. `permissions` declares which questions may be
 * asked; the checker still decides each concrete target. A different scope can
 * therefore use the same base context with a different actor-specific evaluator
 * without caching another actor's authority in shared resources.
 */
export function scope<Base extends import('@okikio/context').Context>(
	ctx: Base,
	options: PermissionScopeOptions,
): PermissionContext<Base> {
	if ('permissions' in ctx) throw new TypeError('Permission scope cannot replace an existing permission runtime.');
	const permissions = catalogCore.compose(options.permissions);
	if (options.checker !== undefined) assertChecker(options.checker);
	const runtime = Object.freeze(
		{
			...(options.checker === undefined ? {} : { checker: options.checker }),
			permissions,
		} satisfies PermissionRuntime,
	);
	return contextCore.view(ctx, { permissions: runtime });
}

/** Check one permission expression and return `false` only for an explicit policy denial. */
export function check(ctx: import('@okikio/context').Context, expression: PermissionExpression): Promise<boolean>;
/** Check one permission definition with its schema-inferred optional target. */
export function check<Permission extends PermissionDefinition>(
	ctx: import('@okikio/context').Context,
	definition: Permission,
	...target: PermissionTargetArguments<Permission>
): Promise<boolean>;
/** Execute the normalized overload after preserving provider faults and cancellation as errors. */
export async function check(
	ctx: import('@okikio/context').Context,
	input: PermissionDefinition | PermissionExpression,
	...target: readonly unknown[]
): Promise<boolean> {
	const expression = isDefinition(input) ? direct(input, target) : input;
	const [allowed] = await batch(ctx, [expression]);
	return allowed!;
}

/** Assert one permission expression, throwing `PermissionDeniedError` only for explicit denial. */
export function assert(ctx: import('@okikio/context').Context, expression: PermissionExpression): Promise<void>;
/** Assert one permission definition with its schema-inferred optional target. */
export function assert<Permission extends PermissionDefinition>(
	ctx: import('@okikio/context').Context,
	definition: Permission,
	...target: PermissionTargetArguments<Permission>
): Promise<void>;
/** Execute the assertion overload and convert only a conclusive denial into `PermissionDeniedError`. */
export async function assert(
	ctx: import('@okikio/context').Context,
	input: PermissionDefinition | PermissionExpression,
	...target: readonly unknown[]
): Promise<void> {
	const expression = isDefinition(input) ? direct(input, target) : input;
	const evaluation = await evaluate(ctx, [expression]);
	if (evaluation.allowed[0]) return;
	throw new PermissionDeniedError(deniedDefinitions(evaluation.plans[0]!, evaluation.decisions, evaluation.leaves));
}

/**
 * Evaluate several expressions as one bounded logical permission batch.
 *
 * All atomic leaves are validated first and sent to the evaluator in one call.
 * The evaluator may translate that logical batch into provider-specific chunks,
 * parallel requests, database queries, or local graph evaluation while keeping
 * one consistent authorization view.
 */
export async function batch(
	ctx: import('@okikio/context').Context,
	input: readonly PermissionExpressionInput[],
): Promise<readonly boolean[]> {
	if (input.length === 0) return Object.freeze([]);
	return (await evaluate(ctx, input.map(toExpression))).allowed;
}

/** Evaluation plan that points to one validated atomic provider decision. */
interface LeafPlan {
	readonly type: 'leaf';
	readonly index: number;
}

/** Evaluation plan whose children must all allow. */
interface AllPlan {
	readonly type: 'all';
	readonly children: readonly Plan[];
}

/** Evaluation plan where one allowed child is sufficient. */
interface AnyPlan {
	readonly type: 'any';
	readonly children: readonly Plan[];
}

/** Internal normalized expression plan used to recombine one provider batch. */
type Plan = LeafPlan | AllPlan | AnyPlan;

/** Complete intermediate result retained so denial diagnostics use the same decisions as the boolean answer. */
interface Evaluation {
	readonly leaves: readonly PermissionCheck[];
	readonly plans: readonly Plan[];
	readonly requests: readonly PermissionRequest[];
	readonly decisions: readonly PermissionDecision[];
	readonly allowed: readonly boolean[];
}

/**
 * Normalizes, bounds, evaluates, and recombines one logical permission batch.
 *
 * @internal
 */
async function evaluate(
	ctx: import('@okikio/context').Context,
	expressions: readonly PermissionExpression[],
	tolerateFaults = false,
): Promise<Evaluation> {
	contextCore.check(ctx);
	const permissionRuntime = getRuntime(ctx);
	const checker = permissionRuntime.checker;
	if (checker === undefined) throw new MissingPermissionCheckerError();
	assertChecker(checker);

	const leaves: PermissionCheck[] = [];
	const plans = Object.freeze(expressions.map((expression) => plan(expression, leaves)));
	if (leaves.length > checker.maximumChecks) {
		throw new PermissionCheckLimitError(leaves.length, checker.maximumChecks);
	}

	// Finish declaration and schema checks for the entire batch before invoking policy.
	// A malformed late target must not leave a partially evaluated authorization view.
	const declared = new Set(permissionRuntime.permissions);
	const requests: PermissionRequest[] = [];
	for (const leaf of leaves) {
		if (!declared.has(leaf.definition)) throw new UndeclaredPermissionError(leaf.definition);
		requests.push(await normalize(leaf));
	}

	contextCore.check(ctx);
	const returned = await checker.check(ctx, Object.freeze(requests));
	contextCore.check(ctx);
	const decisions = normalizeDecisions(returned, requests.length);
	const allowed = Object.freeze(
		plans.map((entry) =>
			tolerateFaults ? outcome(entry, decisions, leaves).type === 'allowed' : decide(entry, decisions, leaves)
		),
	);
	return Object.freeze({ leaves: Object.freeze(leaves), plans, requests: Object.freeze(requests), decisions, allowed });
}

/** Build a deterministic evaluation tree while preserving every authored atomic check. */
function plan(expression: PermissionExpression, leaves: PermissionCheck[]): Plan {
	assertExpression(expression);
	if (expression.kind === 'permission-check') {
		const index = leaves.length;
		leaves.push(expression);
		return Object.freeze({ type: 'leaf', index });
	}
	const children = Object.freeze(expression.checks.map((child) => plan(child, leaves)));
	return Object.freeze({ type: expression.kind === 'permission-all' ? 'all' : 'any', children });
}

/** Validate one authored target and produce the exact provider request. */
async function normalize<Permission extends PermissionDefinition>(
	check: PermissionCheck<Permission>,
): Promise<PermissionRequest<Permission>> {
	const target = check.definition.target === undefined
		? undefined
		: await schema.parse(check.definition.target, check.target);
	return Object.freeze({ definition: check.definition, target }) as PermissionRequest<Permission>;
}

/** Validate provider output so malformed results can never become authorization answers. */
function normalizeDecisions(input: readonly PermissionDecision[], expected: number): readonly PermissionDecision[] {
	return decisions(input, expected, (message) => new PermissionDecisionError(message));
}

/** Internal result used while resolving one permission expression. */
type PlanOutcome =
	| Readonly<{ readonly type: 'allowed' }>
	| Readonly<{ readonly type: 'denied' }>
	| Readonly<{ readonly type: 'error'; readonly error: PermissionEvaluationError }>;

/** Evaluate one internal expression plan with fail-closed three-state semantics. */
function outcome(
	plan: Plan,
	decisions: readonly PermissionDecision[],
	leaves: readonly PermissionCheck[],
): PlanOutcome {
	if (plan.type === 'leaf') {
		const decision = decisions[plan.index]!;
		if ('error' in decision) {
			return Object.freeze({
				type: 'error',
				error: new PermissionEvaluationError(leaves[plan.index]!.definition, decision.error),
			});
		}
		return Object.freeze({ type: decision.allowed ? 'allowed' : 'denied' });
	}

	// A decisive deny in all(), or allow in any(), outranks a sibling fault.
	// Preserve the first fault only when no explicit decision settles the expression.
	let firstError: PermissionEvaluationError | undefined;
	if (plan.type === 'all') {
		for (const child of plan.children) {
			const childOutcome = outcome(child, decisions, leaves);
			if (childOutcome.type === 'denied') return Object.freeze({ type: 'denied' });
			if (childOutcome.type === 'error') firstError ??= childOutcome.error;
		}
		return firstError === undefined
			? Object.freeze({ type: 'allowed' })
			: Object.freeze({ type: 'error', error: firstError });
	}

	for (const child of plan.children) {
		const childOutcome = outcome(child, decisions, leaves);
		if (childOutcome.type === 'allowed') return Object.freeze({ type: 'allowed' });
		if (childOutcome.type === 'error') firstError ??= childOutcome.error;
	}
	return firstError === undefined
		? Object.freeze({ type: 'denied' })
		: Object.freeze({ type: 'error', error: firstError });
}

/** Resolve one expression outcome to the public boolean contract. */
function decide(plan: Plan, decisions: readonly PermissionDecision[], leaves: readonly PermissionCheck[]): boolean {
	const result = outcome(plan, decisions, leaves);
	if (result.type === 'error') throw result.error;
	return result.type === 'allowed';
}

/** Return the definitions whose atomic decisions explain a denied expression. */
function deniedDefinitions(
	plan: Plan,
	decisions: readonly PermissionDecision[],
	leaves: readonly PermissionCheck[],
): readonly PermissionDefinition[] {
	const denied: PermissionDefinition[] = [];
	collectDenied(plan, decisions, leaves, denied);
	return Object.freeze(denied);
}

/** Collect denied atomic definitions without exposing potentially sensitive target values. */
function collectDenied(
	plan: Plan,
	decisions: readonly PermissionDecision[],
	leaves: readonly PermissionCheck[],
	denied: PermissionDefinition[],
): void {
	const result = outcome(plan, decisions, leaves);
	if (result.type !== 'denied') return;
	if (plan.type === 'leaf') {
		denied.push(leaves[plan.index]!.definition);
		return;
	}
	for (const child of plan.children) collectDenied(child, decisions, leaves, denied);
}

/** Return whether a value is one exact permission definition. */
function isDefinition(value: unknown): value is PermissionDefinition {
	return isDeclaredDefinition(value);
}

/** Validate one permission definition before it enters a runtime expression. */
function assertDefinition(value: PermissionDefinition): void {
	if (!isDefinition(value)) throw new TypeError('Permission expression must reference a permission definition.');
}

/** Validate one runtime expression recursively. */
function assertExpression(value: PermissionExpression): void {
	if (typeof value !== 'object' || value === null) throw new TypeError('Permission expression must be an object.');
	if (value.kind === 'permission-check') {
		assertDefinition(value.definition);
		return;
	}
	if (value.kind !== 'permission-all' && value.kind !== 'permission-any') {
		throw new TypeError('Unknown permission expression kind.');
	}
	if (!Array.isArray(value.checks) || value.checks.length === 0) {
		throw new TypeError(`${value.kind} requires at least one nested permission expression.`);
	}
	for (const child of value.checks) assertExpression(child);
}

/** Normalize expression-builder input while preserving authored order. */
function normalizeExpressions(
	values: readonly PermissionExpressionInput[],
	operation: string,
): readonly PermissionExpression[] {
	if (values.length === 0) throw new TypeError(`${operation} requires at least one permission expression.`);
	return Object.freeze(values.map((value) => {
		const expression = toExpression(value);
		assertExpression(expression);
		return expression;
	}));
}

/** Convert one targetless definition or existing expression to a runtime expression. */
function toExpression(value: PermissionExpressionInput): PermissionExpression {
	return isDefinition(value) ? direct(value, []) : value;
}

/** Resolve permission runtime state from a composed execution-context view. */
function getRuntime(ctx: import('@okikio/context').Context): PermissionRuntime {
	const runtime = (ctx as import('@okikio/context').Context & { readonly permissions?: unknown }).permissions;
	if (
		typeof runtime !== 'object' || runtime === null ||
		!Array.isArray((runtime as Partial<PermissionRuntime>).permissions)
	) {
		throw new MissingPermissionCheckerError();
	}
	return runtime as PermissionRuntime;
}

/** Validate an evaluator's explicit logical batch bound. */
function assertChecker(checker: PermissionChecker): void {
	if (!Number.isSafeInteger(checker.maximumChecks) || checker.maximumChecks < 1) {
		throw new TypeError('Permission evaluator maximumChecks must be a positive safe integer.');
	}
	if (typeof checker.check !== 'function') throw new TypeError('Permission evaluator must provide check().');
}

export type {
	PermissionAll,
	PermissionAny,
	PermissionCatalog,
	PermissionCheck,
	PermissionChecker,
	PermissionContext,
	PermissionDecision,
	PermissionDefinition,
	PermissionDefinitions,
	PermissionExpression,
	PermissionExpressionInput,
	PermissionOptions,
	PermissionRequest,
	PermissionRequirement,
	PermissionRuntime,
	PermissionScopeOptions,
	PermissionSelection,
	PermissionTarget,
	PermissionTargetArguments,
	PermissionTargetInput,
} from './types.ts';

/** Narrow an already validated provider request by exact definition identity, without parsing its target again. */
export function matches<Permission extends PermissionDefinition>(
	request: PermissionRequest,
	definition: Permission,
): request is PermissionRequest<Permission> {
	return request.definition === definition;
}

/** Safe per-node explanation. Targets, raw provider exceptions and schema inputs are never retained. */
export interface ExplanationType {
	/** Existing all/any precedence is shared with check; a fault is distinct from a policy denial. */
	readonly outcome: 'allowed' | 'denied' | 'fault';
	/** Atomic identity, or conjunction/disjunction. */
	readonly kind: 'permission' | 'all' | 'any';
	/** Authored permission ID for an atomic node. */
	readonly permission?: string;
	/** Exact declaration identity is opt-in because metadata can disclose policy details. */
	readonly definition?: PermissionDefinition;
	/** Provider-authored reason, opt-in and truncated. It may contain protected data. */
	readonly reason?: string;
	/** True when the included reason was truncated by maximumDetailCodeUnits. */
	readonly truncated?: true;
	/** Authored order; this evaluator batches all leaves, so there are no skipped provider checks. */
	readonly children?: readonly ExplanationType[];
}

/**
 * Explain one evaluation without repeating provider calls or including concrete targets.
 * All/any use exactly check's denial/fault precedence. A returned leaf fault appears as fault;
 * checker throws, invalid responses, undeclared checks and cancellation remain terminal exceptions.
 * Node/depth budgets reject before provider evaluation rather than producing a misleading partial verdict.
 */
export async function explain(
	ctx: import('@okikio/context').Context,
	expression: PermissionExpressionInput,
	options: Readonly<{
		/** Maximum expression occurrences, including composite nodes and repeated leaves. */
		readonly maximumNodes: number;
		/** Explicit recursion budget, 1 through 128 inclusive. */
		readonly maximumDepth: number;
		/** Opt into exact definition metadata and provider reasons. */
		readonly details: boolean;
		/** Maximum UTF-16 code units of each included reason, including zero. */
		readonly maximumDetailCodeUnits: number;
	}>,
): Promise<ExplanationType> {
	contextCore.check(ctx);
	if (
		!Number.isSafeInteger(options.maximumNodes) || options.maximumNodes < 1 ||
		!Number.isSafeInteger(options.maximumDepth) || options.maximumDepth < 1 || options.maximumDepth > 128 ||
		!Number.isSafeInteger(options.maximumDetailCodeUnits) || options.maximumDetailCodeUnits < 0 ||
		typeof options.details !== 'boolean'
	) throw new RangeError('Invalid permission explanation budgets or detail policy.');
	const root: PermissionExpression = isDefinition(expression) ? direct(expression, []) : expression;
	// Bound iterative preflight before the existing recursive planner touches untrusted expression depth.
	const pending = [{ expression: root, depth: 1 }];
	let count = 0;
	while (pending.length > 0) {
		const entry = pending.pop()!;
		if (++count > options.maximumNodes || entry.depth > options.maximumDepth) {
			throw new RangeError('Permission explanation exceeds its expression budget.');
		}
		if (entry.expression.kind === 'permission-check') continue;
		if (!Array.isArray(entry.expression.checks)) throw new TypeError('Permission expression requires child checks.');
		if (count + pending.length + entry.expression.checks.length > options.maximumNodes) {
			throw new RangeError('Permission explanation exceeds maximumNodes.');
		}
		for (const child of entry.expression.checks) pending.push({ expression: child, depth: entry.depth + 1 });
	}
	const result = await evaluate(ctx, [root], true);
	/** Serialize only normalized decision categories; no raw fault or validated target enters this tree. */
	const project = (entry: Plan): ExplanationType => {
		const selected = outcome(entry, result.decisions, result.leaves);
		const state = selected.type === 'error' ? 'fault' : selected.type;
		if (entry.type !== 'leaf') {
			return Object.freeze({ kind: entry.type, outcome: state, children: Object.freeze(entry.children.map(project)) });
		}
		const definition = result.leaves[entry.index]!.definition;
		const decision = result.decisions[entry.index]!;
		const reason = options.details && 'reason' in decision ? decision.reason : undefined;
		return Object.freeze({
			kind: 'permission',
			outcome: state,
			permission: definition.id,
			...(options.details ? { definition } : {}),
			...(reason === undefined ? {} : {
				reason: reason.slice(0, options.maximumDetailCodeUnits),
				...(reason.length > options.maximumDetailCodeUnits ? { truncated: true as const } : {}),
			}),
		});
	};
	return project(result.plans[0]!);
}
