/**
 * Provider-neutral permission definitions, expressions, and runtime checks.
 *
 * A permission definition is import-safe metadata. Runtime checks execute only
 * through an explicitly supplied evaluator attached with `scope()`. Complex
 * business policy stays inside that evaluator; `all()` and `any()` only compose
 * genuinely independent permission decisions.
 *
 * @module
 */
import * as catalogCore from '@okikio/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import * as contextCore from '@okikio/context';
import * as requirement from '@okikio/requirement';
import * as schema from '@okikio/schema';
import type {
	PermissionAll,
	PermissionAny,
	PermissionCheck,
	PermissionChecker,
	PermissionContext,
	PermissionDecision,
	PermissionDefinition,
	PermissionOptions,
	PermissionExpression,
	PermissionExpressionInput,
	PermissionCatalog,
	PermissionSelection,
	PermissionRequest,
	PermissionRequirement,
	PermissionRuntime,
	PermissionScopeOptions,
	PermissionTargetArguments,
} from './types.ts';

/** Error raised when runtime code checks a permission that was not declared by the execution scope. */
export class UndeclaredPermissionError extends Error {
	readonly definition: PermissionDefinition;

	constructor(definition: PermissionDefinition) {
		super(`Permission ${JSON.stringify(definition.id)} is not declared by this execution scope.`);
		this.name = 'UndeclaredPermissionError';
		this.definition = definition;
	}
}

/** Error raised when runtime code attempts a permission check without an evaluator. */
export class MissingPermissionCheckerError extends Error {
	constructor() {
		super('Permission checks require an explicit permission evaluator for this execution scope.');
		this.name = 'MissingPermissionCheckerError';
	}
}

/** Error raised when a logical permission batch exceeds the evaluator's explicit limit. */
export class PermissionCheckLimitError extends RangeError {
	readonly count: number;
	readonly maximum: number;

	constructor(count: number, maximum: number) {
		super(`Permission check batch contains ${count} atomic checks; the configured maximum is ${maximum}.`);
		this.name = 'PermissionCheckLimitError';
		this.count = count;
		this.maximum = maximum;
	}
}

/** Error raised when a permission evaluator violates the ordered batch result contract. */
export class PermissionDecisionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PermissionDecisionError';
	}
}

/** Error raised when one atomic permission decision could not be evaluated. */
export class PermissionEvaluationError extends Error {
	readonly definition: PermissionDefinition;

	constructor(definition: PermissionDefinition, cause: unknown) {
		super(`Permission ${JSON.stringify(definition.id)} could not be evaluated.`, { cause });
		this.name = 'PermissionEvaluationError';
		this.definition = definition;
	}
}

/** Error raised by `assert()` only when the evaluator explicitly denies the permission expression. */
export class PermissionDeniedError extends Error {
	readonly denied: readonly PermissionDefinition[];

	constructor(denied: readonly PermissionDefinition[]) {
		const ids = [...new Set(denied.map((definition) => definition.id))];
		super(ids.length === 0
			? 'Permission was denied.'
			: `Permission was denied for ${ids.map((id) => JSON.stringify(id)).join(', ')}.`);
		this.name = 'PermissionDeniedError';
		this.denied = Object.freeze([...new Set(denied)]);
	}
}

/** Define one immutable permission contract without starting a policy provider. */
export function define<
	const Id extends string,
	TargetSchema extends import('./types.ts').PermissionSchema | undefined = undefined,
>(input: PermissionOptions<Id, TargetSchema>): PermissionDefinition<Id, TargetSchema> {
	assertIdentifier(input.id);
	if (input.target !== undefined) schema.assert(input.target, 'permission target schema');
	return Object.freeze({
		kind: 'permission',
		id: input.id,
		...(input.description === undefined ? {} : { description: input.description }),
		...(input.target === undefined ? {} : { target: input.target }),
	}) as PermissionDefinition<Id, TargetSchema>;
}

/** Create a named immutable permission catalog. */
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, PermissionDefinition>>,
>(
	namespace: Namespace,
	entries: Entries,
): PermissionCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving permission catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, PermissionDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: PermissionCatalog<Entries>,
	keys: Keys,
): PermissionSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose permission definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends PermissionDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Contribute the `require` requirement for one permission definition. */
export function require(definition: PermissionDefinition): PermissionRequirement {
	return requirement.define({ family: 'permission', action: 'require', definition });
}


/**
 * Adapt one permission checker to the generic active-requirement runtime.
 *
 * Targetless permission requirements are admission checks. Target-bearing
 * permissions only declare that later runtime checks are possible because no
 * concrete target exists at definition admission time.
 */
export function interpreter(checker?: PermissionChecker): import('@okikio/requirement').RequirementInterpreter<PermissionRequirement> {
	if (checker !== undefined) assertChecker(checker);
	return Object.freeze({
		scope(ctx: import('@okikio/context').Context, requirements: readonly PermissionRequirement[]) {
			const definitions = definitionsOf(requirements);
			return scope(ctx, {
				permissions: definitions,
				...(checker === undefined ? {} : { checker }),
			});
		},
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
 * It does not create cancellation state or own cleanup. A different scope can
 * therefore use the same base context with a different actor-specific evaluator
 * without caching another actor's authority in shared resources.
 */
export function scope<Base extends import('@okikio/context').Context>(
	ctx: Base,
	options: PermissionScopeOptions,
): PermissionContext<Base> {
	const permissions = catalogCore.compose(options.permissions);
	if (options.checker !== undefined) assertChecker(options.checker);
	const runtime: PermissionRuntime = Object.freeze({
		...(options.checker === undefined ? {} : { checker: options.checker }),
		permissions,
	});
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
	const expression = isDefinition(input)
		? direct(input, target)
		: input;
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
	const expression = isDefinition(input)
		? direct(input, target)
		: input;
	const evaluation = await evaluate(ctx, [expression]);
	if (evaluation.allowed[0]) return;
	throw new PermissionDeniedError(deniedDefinitions(evaluation.plans[0]!, evaluation.decisions, evaluation.leaves));
}

/**
 * Evaluate several expressions as one bounded logical permission batch.
 *
 * PermissionAll atomic leaves are validated first and sent to the evaluator in one call.
 * The evaluator may translate that logical batch into provider-specific chunks,
 * parallel requests, database queries, or local graph evaluation while keeping
 * one consistent authorization view.
 */
export async function batch(ctx: import('@okikio/context').Context, input: readonly PermissionExpressionInput[]): Promise<readonly boolean[]> {
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
async function evaluate(ctx: import('@okikio/context').Context, expressions: readonly PermissionExpression[]): Promise<Evaluation> {
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
	const allowed = Object.freeze(plans.map((entry) => decide(entry, decisions, leaves)));
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
async function normalize<Permission extends PermissionDefinition>(check: PermissionCheck<Permission>): Promise<PermissionRequest<Permission>> {
	const target = check.definition.target === undefined
		? undefined
		: await schema.parse(check.definition.target, check.target);
	return Object.freeze({ definition: check.definition, target }) as PermissionRequest<Permission>;
}

/** Validate provider output so malformed results can never become authorization answers. */
function normalizeDecisions(input: readonly PermissionDecision[], expected: number): readonly PermissionDecision[] {
	if (!Array.isArray(input)) {
		throw new PermissionDecisionError('Permission evaluator must return an array of decisions.');
	}
	if (input.length !== expected) {
		throw new PermissionDecisionError(
			`Permission evaluator returned ${input.length} decisions for ${expected} requests.`,
		);
	}
	return Object.freeze(input.map((decision, index) => {
		if (typeof decision !== 'object' || decision === null) {
			throw new PermissionDecisionError(`Permission evaluator decision ${index} must be an object.`);
		}
		if ('error' in decision) {
			if ('allowed' in decision) {
				throw new PermissionDecisionError(`Permission evaluator decision ${index} cannot contain both allowed and error.`);
			}
			return Object.freeze({ error: decision.error });
		}
		if (typeof decision.allowed !== 'boolean') {
			throw new PermissionDecisionError(`Permission evaluator decision ${index} must contain allowed or error.`);
		}
		if (decision.reason !== undefined && typeof decision.reason !== 'string') {
			throw new PermissionDecisionError(`Permission evaluator decision ${index} reason must be a string when present.`);
		}
		return Object.freeze({
			allowed: decision.allowed,
			...(decision.reason === undefined ? {} : { reason: decision.reason }),
		}) as PermissionDecision;
	}));
}

/** Internal result used while resolving one permission expression. */
type PlanOutcome =
	| Readonly<{ readonly type: 'allowed' }>
	| Readonly<{ readonly type: 'denied' }>
	| Readonly<{ readonly type: 'error'; readonly error: PermissionEvaluationError }>;

/** Evaluate one internal expression plan with fail-closed three-state semantics. */
function outcome(plan: Plan, decisions: readonly PermissionDecision[], leaves: readonly PermissionCheck[]): PlanOutcome {
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
	return typeof value === 'object' && value !== null &&
		(value as { readonly kind?: unknown }).kind === 'permission' &&
		typeof (value as { readonly id?: unknown }).id === 'string';
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
function normalizeExpressions(values: readonly PermissionExpressionInput[], operation: string): readonly PermissionExpression[] {
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
	if (typeof runtime !== 'object' || runtime === null || !Array.isArray((runtime as Partial<PermissionRuntime>).permissions)) {
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

/** Reject an invalid stable permission identifier before it enters authoritative state. */
function assertIdentifier(id: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Invalid permission id ${JSON.stringify(id)}.`);
}

export type {
	PermissionAll,
	PermissionAny,
	PermissionCheck,
	PermissionChecker,
	PermissionContext,
	PermissionDecision,
	PermissionDefinition,
	PermissionOptions,
	PermissionExpression,
	PermissionExpressionInput,
	PermissionDefinitions,
	PermissionCatalog,
	PermissionSelection,
	PermissionRequest,
	PermissionRequirement,
	PermissionRuntime,
	PermissionScopeOptions,
	PermissionTarget,
	PermissionTargetArguments,
	PermissionTargetInput,
} from './types.ts';
