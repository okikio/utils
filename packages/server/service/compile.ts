import { routes as serviceRoutes } from './route.ts';
import * as catalog from '@okikio/collection/catalog';
import type { CatalogEntryIdentity } from '@okikio/collection/catalog';
import * as endpoint from '@okikio/server/endpoint';
import * as env from '@okikio/env';
import * as effect from '@okikio/capability/effect';
import type { EffectDefinition } from '@okikio/capability/effect';
import type {
	AnyEndpointHandlerBinding,
	EmptyEndpointHost,
	EndpointContributions,
	EndpointDefinition,
	EndpointMethod,
	EndpointOperation,
} from '@okikio/server/endpoint';
import * as middleware from '@okikio/server/middleware';
import type { MiddlewareDefinition, MiddlewareHandler, MiddlewareInput } from '@okikio/server/middleware';
import * as resilience from '@okikio/capability/resilience';
import type { ResilienceInput, ResiliencePolicy } from '@okikio/capability/resilience';
import type { ProblemDefinition } from '@okikio/http/problem';
import type { ResponseDefinition } from '@okikio/http/response';
import * as requirement from '@okikio/capability/requirement';
import type { RequirementDefinition } from '@okikio/capability/requirement';
import * as resource from '@okikio/capability/resource';
import type { ResourceDefinition, ResourceImplementationAny } from '@okikio/capability/resource';
import { ServerProblems } from '../problems.ts';
import { prepareRoutes } from '../http/mod.ts';

import { leafEndpoints } from './definition.ts';
import type {
	CompiledService,
	CompiledServiceDefinition,
	EffectiveServiceOperation,
	ServiceContributions,
	ServiceDefinition,
	ServiceExecutionPlan,
	ServiceImplementation,
	ServiceManifest,
	ServiceOperationContract,
	ServicePolicy,
	ServiceRoute,
	ServiceRouteManifestEntry,
	ServiceValidationIssue,
	ServiceValidationResult,
	ServiceValidationSubject,
} from './types.ts';

/** Error raised when service compilation finds one or more contract defects. */
export class ServiceCompilationError extends Error {
	/** Structured validation issues retained for inspection without matching error messages. */
	readonly issues: readonly ServiceValidationIssue[];

	/** Retain service validation issues when compilation cannot produce a valid route set. */
	constructor(issues: readonly ServiceValidationIssue[]) {
		super(
			`Service compilation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}:\n${
				issues.map((issue) => `- ${issue.message}`).join('\n')
			}`,
		);
		this.name = 'ServiceCompilationError';
		this.issues = Object.freeze([...issues]);
	}
}

/** Validate an import-safe service definition without requiring runtime implementations. */
export function validate(definition: ServiceDefinition): ServiceValidationResult {
	const issues: ServiceValidationIssue[] = [];
	const endpointValidation = endpoint.validate(definition.endpoints);
	if (!endpointValidation.valid) {
		for (const item of endpointValidation.issues) issues.push(issue('invalid-endpoint', item.message, item.definition));
	}
	const routes = collectRoutes(definition);
	validatePolicies(definition, issues);
	validateRouteIdentity(routes, issues);
	return issues.length === 0
		? Object.freeze({ valid: true, routes: Object.freeze(routes) })
		: Object.freeze({ valid: false, issues: Object.freeze(issues) });
}

/** Return exact endpoints whose effective service contract requires authentication. */
export function authenticated(definition: ServiceDefinition): readonly EndpointDefinition[] {
	const validation = validate(definition);
	if (!validation.valid) throw new ServiceCompilationError(validation.issues);
	const policyTargets = new Map(
		definition.policies.map((policy) => [policy, new Set(leafEndpoints(policy.endpoints))] as const),
	);
	const result = new Set<EndpointDefinition>();
	for (const route of validation.routes) {
		const sources = contributionSources(definition, route, policyTargets);
		if (sources.some((source) => definitionValues(source.authentication).length > 0)) {
			result.add(route.endpoint);
		}
	}
	return Object.freeze([...result]);
}

/** Compile a definition and its exact runtime implementation into one authoritative service artifact. */
export function compile<
	Definition extends ServiceDefinition,
	Host extends object = EmptyEndpointHost,
>(implementation: ServiceImplementation<Definition, Host>): CompiledService<Definition, Host> {
	try {
		return compileImplementation(implementation);
	} catch (error) {
		if (error instanceof ServiceCompilationError) throw error;
		throw new ServiceCompilationError(Object.freeze([
			issue(
				'invalid-definition',
				error instanceof Error
					? `Service ${JSON.stringify(implementation.definition.id)} could not be compiled: ${error.message}`
					: `Service ${JSON.stringify(implementation.definition.id)} could not be compiled.`,
			),
		]));
	}
}

/**
 * Resolve inherited operation contracts from definitions alone.
 *
 * Validates routes, policies, middleware ordering, resource dependencies,
 * environment declarations, and resiliency without requiring runtime bindings.
 * No environment values are read and no resources are acquired.
 */
export function compileDefinition<Definition extends ServiceDefinition>(
	definition: Definition,
): CompiledServiceDefinition<Definition> {
	try {
		return resolveDefinition(definition);
	} catch (error) {
		if (error instanceof ServiceCompilationError) throw error;
		throw new ServiceCompilationError(Object.freeze([
			issue(
				'invalid-definition',
				`Service ${JSON.stringify(definition.id)} could not be compiled: ${
					error instanceof Error ? error.message : String(error)
				}`,
			),
		]));
	}
}

/** Resolve static contributions once for documentation and runtime binding. @internal */
function resolveDefinition<Definition extends ServiceDefinition>(
	definition: Definition,
): CompiledServiceDefinition<Definition> {
	// Phase 1: validate and flatten the static route graph before considering
	// runtime implementations. This preserves authoring provenance for later
	// diagnostics and generated artifacts.
	const validation = validate(definition);
	const issues: ServiceValidationIssue[] = validation.valid ? [] : [...validation.issues];
	const routes = validation.valid ? validation.routes : collectRoutes(definition);

	const policyTargets = new Map(
		definition.policies.map((policy) => [policy, new Set(leafEndpoints(policy.endpoints))] as const),
	);
	const effective: ServiceOperationContract[] = [];
	const usedResources = new Set<ResourceDefinition>();

	// Phase 3: resolve the effective contract for each concrete method/path.
	// Contributions are additive from service -> targeted policies -> groups ->
	// endpoint -> operation; inner layers cannot silently erase outer contributions.
	for (const route of routes) {
		const sources = contributionSources(definition, route, policyTargets);
		const middlewareInput: readonly MiddlewareInput[] = sources.flatMap(
			(source) => source.middleware === undefined ? [] : [source.middleware],
		);
		const middlewareValidation = middleware.validate(middlewareInput);
		if (!middlewareValidation.valid) {
			for (const item of middlewareValidation.issues) {
				issues.push(issue('invalid-definition', item.message, item.definition));
			}
			continue;
		}

		const resourceRoots = concreteResourceDefinitions([
			...definitions<CatalogEntryIdentity>(sources, 'resources'),
			...middlewareDefinitions(middlewareValidation.plan).flatMap((candidate) =>
				candidate.resources === undefined ? [] : catalog.values(candidate.resources)
			),
		], issues);
		const resources = collectResourceClosure(resourceRoots);
		for (const resourceDefinition of resources) usedResources.add(resourceDefinition);

		const resiliencyInput = [
			...sources.flatMap((source) => source.resiliency === undefined ? [] : [source.resiliency]),
			...middlewareDefinitions(middlewareValidation.plan).flatMap((candidate) =>
				candidate.resiliency === undefined ? [] : [candidate.resiliency]
			),
		] as readonly ResilienceInput[];
		const resiliencyValidation = resilience.validate(
			resiliencyInput,
			{ safety: operationSafety(route.method) },
		);
		if (!resiliencyValidation.valid) {
			for (const item of resiliencyValidation.issues) {
				issues.push(issue('invalid-resiliency', `${route.id}: ${item.message}`, item.policy));
			}
			continue;
		}

		const effects = effect.compose(
			definitions<EffectDefinition>(sources, 'effects'),
			middlewareDefinitions(middlewareValidation.plan).flatMap((candidate) =>
				candidate.effects === undefined ? [] : effect.compose(candidate.effects)
			),
		);

		const problems = uniqueByIdentity([
			...definitions<ProblemDefinition>(sources, 'problems'),
			...middlewareDefinitions(middlewareValidation.plan).flatMap((candidate) =>
				candidate.problems === undefined ? [] : catalog.values(candidate.problems)
			),
			...generatedServerProblems(route, resiliencyValidation.policies, resources.length > 0),
		]);
		const responses = route.operation.responses === undefined
			? Object.freeze([])
			: catalog.values(route.operation.responses);
		const execution = executionPlan(route, resiliencyValidation.policies);

		effective.push(Object.freeze({
			...route,
			middleware: middlewareValidation.plan,
			authentication: Object.freeze(sources.flatMap((source) => definitionValues(source.authentication))),
			requirements: requirement.compose(
				definitions<RequirementDefinition>(sources, 'requirements'),
				middlewareDefinitions(middlewareValidation.plan).flatMap((candidate) =>
					candidate.requirements === undefined ? [] : requirement.compose(candidate.requirements)
				),
			),
			reachableRequirements: requirement.compose(
				definitions<RequirementDefinition>(sources, 'requirements'),
				middlewareDefinitions(middlewareValidation.plan).flatMap((candidate) =>
					candidate.requirements === undefined ? [] : requirement.compose(candidate.requirements)
				),
				resource.reachable(resources),
			),
			effects,
			resources: Object.freeze(resources),
			problems: Object.freeze(problems),
			responses: Object.freeze(responses),
			resiliency: resiliencyValidation.policies,
			execution,
		}));
	}

	validateEnvironment(definition, [...usedResources], issues);
	// Phase 4: fail atomically. A partially linked service is never returned.
	if (issues.length > 0) throw new ServiceCompilationError(Object.freeze(issues));
	const operations = Object.freeze(effective);
	return Object.freeze({
		kind: 'compiled-service-definition',
		definition,
		operations,
		manifest: manifest(definition, operations),
	});
}

/** Bind exact runtime implementations to an admitted static contract. @internal */
function compileImplementation<
	Definition extends ServiceDefinition,
	Host extends object = EmptyEndpointHost,
>(implementation: ServiceImplementation<Definition, Host>): CompiledService<Definition, Host> {
	const definition = implementation.definition;
	const contract = compileDefinition(definition);
	const routes = contract.operations;
	const issues: ServiceValidationIssue[] = [];
	const handlerByEndpoint = indexEndpointHandlers(implementation.endpoints, routes, issues);
	const middlewareByDefinition = indexMiddlewareHandlers(implementation.middleware, issues);
	const resourceByDefinition = indexResourceImplementations(implementation.resources.implementations, issues);
	const effective: EffectiveServiceOperation[] = [];
	const usedMiddleware = new Set<MiddlewareDefinition>();
	const usedResources = new Set<ResourceDefinition>();
	for (const operation of routes) {
		const handler = handlerByEndpoint.get(operation.endpoint)?.get(operation.operation);
		if (handler === undefined) {
			issues.push(
				issue(
					'missing-endpoint-handler',
					`Operation ${JSON.stringify(operation.operation.id)} has no endpoint handler.`,
					operation.operation,
				),
			);
		} else {
			effective.push(Object.freeze({ ...operation, handler }));
		}
		for (const candidate of middlewareDefinitions(operation.middleware)) {
			usedMiddleware.add(candidate);
			if (!middlewareByDefinition.has(candidate)) {
				issues.push(
					issue(
						'missing-middleware-handler',
						`Middleware ${JSON.stringify(candidate.id)} has no runtime handler.`,
						candidate,
					),
				);
			}
		}
		for (const candidate of operation.resources) {
			usedResources.add(candidate);
			if (!resourceByDefinition.has(candidate)) {
				issues.push(
					issue(
						'missing-resource-implementation',
						`Resource ${JSON.stringify(candidate.id)} has no runtime implementation.`,
						candidate,
					),
				);
			}
		}
	}
	for (const binding of implementation.endpoints) {
		if (!routes.some((route) => route.endpoint === binding.endpoint && route.operation === binding.operation)) {
			issues.push(
				issue(
					'extraneous-endpoint-handler',
					`Endpoint handler for ${JSON.stringify(binding.operation.id)} is outside service ${
						JSON.stringify(definition.id)
					}.`,
					binding,
				),
			);
		}
	}
	for (const handler of implementation.middleware) {
		if (!usedMiddleware.has(handler.definition)) {
			issues.push(
				issue(
					'extraneous-middleware-handler',
					`Middleware handler ${JSON.stringify(handler.definition.id)} is not referenced by service ${
						JSON.stringify(definition.id)
					}.`,
					handler,
				),
			);
		}
	}
	for (const resourceImplementation of implementation.resources.implementations) {
		if (!usedResources.has(resourceImplementation.definition)) {
			issues.push(
				issue(
					'resource-conflict',
					`Resource implementation ${
						JSON.stringify(resourceImplementation.definition.id)
					} is not reachable from service ${JSON.stringify(definition.id)}.`,
					resourceImplementation,
				),
			);
		}
	}

	if (issues.length > 0) throw new ServiceCompilationError(Object.freeze(issues));
	const operations = Object.freeze(effective);
	return Object.freeze({
		kind: 'compiled-service',
		routePlan: prepareRoutes(
			operations.map((operation) =>
				Object.freeze({ kind: 'route' as const, method: operation.method, path: operation.path })
			),
		),
		definition,
		implementation,
		operations,
		manifest: manifest(definition, operations, implementation.resources),
	});
}

/** Return the deterministic manifest retained by a compiled service. */
export function document(compiled: CompiledService | CompiledServiceDefinition): ServiceManifest {
	return compiled.manifest;
}

/**
 * Copy the shared flattened service route graph so validation can retain its own ordered list.
 *
 * @internal
 */
function collectRoutes(definition: ServiceDefinition): ServiceRoute[] {
	return [...serviceRoutes(definition)];
}

/**
 * Reject policy targets outside the service by endpoint object identity; equal IDs do not import authority.
 *
 * @internal
 */
function validatePolicies(definition: ServiceDefinition, issues: ServiceValidationIssue[]): void {
	const available = new Set(leafEndpoints(definition.endpoints));
	for (const policy of definition.policies) {
		for (const target of leafEndpoints(policy.endpoints)) {
			if (!available.has(target)) {
				issues.push(
					issue(
						'policy-target-outside-service',
						`Policy ${JSON.stringify(policy.id)} targets endpoint ${JSON.stringify(target.id)} outside service ${
							JSON.stringify(definition.id)
						}.`,
						policy,
					),
				);
			}
		}
	}
}

/**
 * Reject conflicting method/path shapes and operation IDs before any router is constructed.
 * Parameter names do not distinguish otherwise identical route shapes.
 *
 * @internal
 */
function validateRouteIdentity(routes: readonly ServiceRoute[], issues: ServiceValidationIssue[]): void {
	const routeOwners = new Map<string, ServiceRoute>();
	const operationOwners = new Map<string, EndpointOperation>();
	for (const route of routes) {
		const key = `${route.method} ${normalizeRouteShape(route.path)}`;
		const existing = routeOwners.get(key);
		if (existing && existing.operation !== route.operation) {
			issues.push(
				issue('route-conflict', `${route.method.toUpperCase()} ${route.path} conflicts with ${existing.path}.`, route),
			);
		}
		routeOwners.set(key, route);
		const operationOwner = operationOwners.get(route.operation.operationId);
		if (operationOwner && operationOwner !== route.operation) {
			issues.push(
				issue(
					'operation-id-conflict',
					`Operation ID ${JSON.stringify(route.operation.operationId)} is duplicated.`,
					route.operation,
				),
			);
		}
		operationOwners.set(route.operation.operationId, route.operation);
	}
}

/**
 * Order additive contributions from service, targeted policies, groups, endpoint, then operation.
 * Returning all scopes prevents an inner declaration from silently removing outer requirements.
 *
 * @internal
 */
function contributionSources(
	service: ServiceDefinition,
	route: ServiceRoute,
	policyTargets: ReadonlyMap<ServicePolicy, ReadonlySet<EndpointDefinition>>,
): readonly (ServiceContributions | EndpointContributions)[] {
	return Object.freeze([
		service,
		...service.policies.filter((policy) => policyTargets.get(policy)?.has(route.endpoint)),
		...route.groups,
		route.endpoint,
		route.operation,
	]);
}

/**
 * Expand one contribution field through the shared catalog, preserving exact definition objects and source order.
 *
 * @internal
 */
function definitions<Entry extends CatalogEntryIdentity>(
	sources: readonly (ServiceContributions | EndpointContributions)[],
	field: 'requirements' | 'effects' | 'resources' | 'problems',
): Entry[] {
	const result: Entry[] = [];
	for (const source of sources) {
		const input = source[field] as import('@okikio/collection/catalog').DefinitionInput<Entry> | undefined;
		if (input !== undefined) result.push(...catalog.values(input));
	}
	return result;
}

/**
 * Flatten middleware stage lists for dependency/implementation coverage checks; runtime stages remain separate.
 *
 * @internal
 */
function middlewareDefinitions(plan: import('@okikio/server/middleware').MiddlewarePlan): MiddlewareDefinition[] {
	return [
		...plan.wholeRequest,
		...plan.beforeValidation,
		...plan.afterValidation,
		...plan.aroundOperation,
	];
}

/**
 * Index handlers by exact endpoint and operation objects, recording duplicate runtime bindings.
 * Outside-service bindings are omitted here and reported by the later coverage pass.
 *
 * @internal
 */
function indexEndpointHandlers(
	bindings: readonly AnyEndpointHandlerBinding[],
	routes: readonly ServiceRoute[],
	issues: ServiceValidationIssue[],
): ReadonlyMap<EndpointDefinition, ReadonlyMap<EndpointOperation, AnyEndpointHandlerBinding>> {
	const result = new Map<EndpointDefinition, Map<EndpointOperation, AnyEndpointHandlerBinding>>();
	const servicePairs = new Map<EndpointDefinition, ReadonlySet<EndpointOperation>>();
	for (const route of routes) {
		const current = servicePairs.get(route.endpoint);
		if (current?.has(route.operation)) continue;
		servicePairs.set(route.endpoint, new Set([...(current ?? []), route.operation]));
	}

	for (const binding of bindings) {
		const serviceOperations = servicePairs.get(binding.endpoint);
		if (!serviceOperations?.has(binding.operation)) continue;
		let endpointBindings = result.get(binding.endpoint);
		if (!endpointBindings) {
			endpointBindings = new Map();
			result.set(binding.endpoint, endpointBindings);
		}
		const existing = endpointBindings.get(binding.operation);
		if (existing && existing !== binding) {
			issues.push(issue(
				'invalid-definition',
				`Operation ${JSON.stringify(binding.operation.id)} has duplicate handlers for endpoint ${
					JSON.stringify(binding.endpoint.id)
				}.`,
				binding,
			));
		}
		endpointBindings.set(binding.operation, binding);
	}
	return result;
}

/**
 * Index one handler per exact middleware definition and accumulate duplicate-binding issues.
 *
 * @internal
 */
function indexMiddlewareHandlers(
	handlers: readonly MiddlewareHandler[],
	issues: ServiceValidationIssue[],
): ReadonlyMap<MiddlewareDefinition, MiddlewareHandler> {
	const result = new Map<MiddlewareDefinition, MiddlewareHandler>();
	for (const handler of handlers) {
		const existing = result.get(handler.definition);
		if (existing && existing !== handler) {
			issues.push(
				issue(
					'invalid-definition',
					`Middleware ${JSON.stringify(handler.definition.id)} has duplicate handlers.`,
					handler,
				),
			);
		}
		result.set(handler.definition, handler);
	}
	return result;
}

/**
 * Require one definition object per resource ID and one runtime implementation per exact definition.
 *
 * @internal
 */
function indexResourceImplementations(
	implementations: readonly ResourceImplementationAny[],
	issues: ServiceValidationIssue[],
): ReadonlyMap<ResourceDefinition, ResourceImplementationAny> {
	const result = new Map<ResourceDefinition, ResourceImplementationAny>();
	const ids = new Map<string, ResourceDefinition>();
	for (const implementation of implementations) {
		const owner = ids.get(implementation.definition.id);
		if (owner && owner !== implementation.definition) {
			issues.push(
				issue(
					'resource-conflict',
					`Resource ID ${JSON.stringify(implementation.definition.id)} belongs to different definitions.`,
					implementation,
				),
			);
		}
		ids.set(implementation.definition.id, implementation.definition);
		const existing = result.get(implementation.definition);
		if (existing && existing !== implementation) {
			issues.push(
				issue(
					'resource-conflict',
					`Resource ${JSON.stringify(implementation.definition.id)} has duplicate implementations.`,
					implementation,
				),
			);
		}
		result.set(implementation.definition, implementation);
	}
	return result;
}

/**
 * Reject generic catalog references that do not carry a concrete Resource dependency declaration.
 *
 * @internal
 */
function concreteResourceDefinitions(
	candidates: readonly CatalogEntryIdentity[],
	issues: ServiceValidationIssue[],
): ResourceDefinition[] {
	const result: ResourceDefinition[] = [];
	for (const definition of candidates) {
		if (!isConcreteResource(definition)) {
			issues.push(issue(
				'invalid-definition',
				`Resource reference ${JSON.stringify(definition.id)} is not a concrete @okikio/resource definition.`,
				definition,
			));
			continue;
		}
		result.push(definition);
	}
	return result;
}

/**
 * Admit the concrete resource shape needed for dependency traversal; string identity alone is insufficient.
 *
 * @internal
 */
function isConcreteResource(value: CatalogEntryIdentity): value is ResourceDefinition {
	return value.kind === 'resource' &&
		typeof value === 'object' && value !== null &&
		'dependencies' in value &&
		typeof (value as { readonly dependencies?: unknown }).dependencies === 'object' &&
		(value as { readonly dependencies?: unknown }).dependencies !== null;
}

/**
 * Traverse dependencies before dependants while rejecting active-path cycles and conflicting resource IDs.
 * Shared dependencies are retained once, in deterministic acquisition order.
 *
 * @internal
 */
function collectResourceClosure(roots: readonly ResourceDefinition[]): ResourceDefinition[] {
	const result: ResourceDefinition[] = [];
	const visited = new Set<ResourceDefinition>();
	const visiting: ResourceDefinition[] = [];
	const ids = new Map<string, ResourceDefinition>();
	const visit = (definition: ResourceDefinition): void => {
		const owner = ids.get(definition.id);
		if (owner && owner !== definition) {
			throw new TypeError(`Resource ID ${JSON.stringify(definition.id)} belongs to different definitions.`);
		}
		ids.set(definition.id, definition);
		const cycle = visiting.indexOf(definition);
		if (cycle >= 0) {
			throw new TypeError(
				`Resource dependency cycle: ${[...visiting.slice(cycle), definition].map((item) => item.id).join(' -> ')}`,
			);
		}
		if (visited.has(definition)) return;
		visiting.push(definition);
		for (const dependency of Object.values(definition.dependencies)) visit(dependency);
		visiting.pop();
		visited.add(definition);
		result.push(definition);
	};
	for (const root of roots) visit(root);
	return result;
}

/**
 * Deduplicate repeated definition objects while rejecting distinct objects that claim the same ID.
 *
 * @internal
 */
function uniqueByIdentity<Entry extends CatalogEntryIdentity>(input: readonly Entry[]): Entry[] {
	const result: Entry[] = [];
	const seen = new Set<Entry>();
	const ids = new Map<string, Entry>();
	for (const entry of input) {
		const owner = ids.get(entry.id);
		if (owner && owner !== entry) {
			throw new TypeError(`Definition ID ${JSON.stringify(entry.id)} belongs to different objects.`);
		}
		ids.set(entry.id, entry);
		if (!seen.has(entry)) {
			seen.add(entry);
			result.push(entry);
		}
	}
	return result;
}

/**
 * Read optional authored catalog input as exact definitions; absence contributes an empty immutable list.
 *
 * @internal
 */
function definitionValues<Entry extends import('@okikio/collection/catalog').CatalogEntryIdentity>(
	input: import('@okikio/collection/catalog').DefinitionInput<Entry> | undefined,
): readonly Entry[] {
	return input === undefined ? Object.freeze([]) : catalog.values(input);
}

/**
 * Check that each resource imports the exact environment field declared by the service.
 * This validates declaration coverage without reading environment values or acquiring a provider.
 *
 * @internal
 */
function validateEnvironment(
	definition: ServiceDefinition,
	resources: readonly ResourceDefinition[],
	issues: ServiceValidationIssue[],
): void {
	for (const selected of resources) {
		const requirement = selected.environment;
		if (requirement === undefined) continue;
		if (definition.environment === undefined) {
			issues.push(
				issue(
					'missing-environment',
					`Resource ${JSON.stringify(selected.id)} requires environment values, but service ${
						JSON.stringify(definition.id)
					} has no environment definition.`,
					selected,
				),
			);
			continue;
		}
		for (const field of requirement.fields) {
			const supplied = definition.environment.fields[field.key];
			if (supplied !== field.field) {
				issues.push(
					issue(
						'environment-conflict',
						`Resource ${JSON.stringify(selected.id)} requires canonical environment field ${
							JSON.stringify(field.key)
						} that is not imported by service ${JSON.stringify(definition.id)}.`,
						selected,
					),
				);
			}
		}
	}
}

/**
 * Include framework problem envelopes reachable through declared input, response, resource, and resilience behavior.
 * Documentation then describes failures the runtime can emit even when the endpoint did not author them.
 *
 * @internal
 */
function generatedServerProblems(
	route: ServiceRoute,
	policies: readonly import('@okikio/capability/resilience').ResiliencePolicy[],
	hasResources: boolean,
): readonly ProblemDefinition[] {
	const definitions: ProblemDefinition[] = [
		ServerProblems.UndeclaredResult,
		ServerProblems.Internal,
	];
	if (hasResources) definitions.unshift(ServerProblems.RuntimeUnavailable);
	const hasInput = Object.keys(route.endpoint.inputs).length > 0 ||
		Object.keys(route.operation.inputs).length > 0;
	if (hasInput) definitions.unshift(ServerProblems.InvalidRequest);
	const hasBodyInput = route.endpoint.inputs.json !== undefined || route.endpoint.inputs.form !== undefined ||
		route.operation.inputs.json !== undefined || route.operation.inputs.form !== undefined;
	if (hasBodyInput) definitions.unshift(ServerProblems.UnsupportedMediaType);
	if (
		catalog.values<ResponseDefinition>(route.operation.responses ?? []).some((definition) =>
			definition.mode !== 'empty' && definition.mode !== 'redirect'
		)
	) {
		definitions.unshift(ServerProblems.NotAcceptable);
	}
	if (policies.some((policy) => policy.type === 'idempotency')) definitions.unshift(ServerProblems.IdempotencyConflict);
	if (policies.some((policy) => policy.type === 'rate-limit')) definitions.unshift(ServerProblems.RateLimited);
	if (policies.some((policy) => policy.type === 'bulkhead' || policy.type === 'circuit-breaker')) {
		definitions.unshift(ServerProblems.CapacityUnavailable);
	}
	if (policies.some((policy) => policy.type === 'body-limit')) definitions.unshift(ServerProblems.BodyTooLarge);
	if (policies.some((policy) => policy.type === 'timeout')) definitions.unshift(ServerProblems.DeadlineExceeded);
	return definitions;
}

/**
 * Classify HTTP method replay expectations for resilience validation; this does not prove handler idempotency.
 *
 * @internal
 */
function operationSafety(method: EndpointMethod): import('@okikio/capability/resilience').ResilienceOperationSafety {
	if (method === 'get' || method === 'head' || method === 'options') return 'safe';
	if (method === 'put' || method === 'delete') return 'idempotent';
	return 'unsafe';
}

/**
 * Precompute request parsing and resilience work for one effective operation.
 *
 * The plan removes repeated policy scans from the request path. It does not
 * remove declared validation, authentication, requirements, or middleware.
 *
 * @internal
 */
function executionPlan(
	route: ServiceRoute,
	policies: readonly ResiliencePolicy[],
): ServiceExecutionPlan {
	const inputs = [] as ServiceExecutionPlan['inputs'][number][];
	for (const source of ['param', 'query', 'header', 'cookie', 'json', 'form', 'raw'] as const) {
		const slot = route.operation.inputs[source] ?? route.endpoint.inputs[source];
		if (slot !== undefined) inputs.push(Object.freeze({ source, slot }));
	}

	let bodyLimit: number | undefined;
	let timeout: Temporal.Duration | undefined;
	const admission: ResiliencePolicy[] = [];
	const operation: ResiliencePolicy[] = [];
	for (const policy of policies) {
		if (policy.type === 'body-limit') {
			bodyLimit = policy.bytes;
			continue;
		}
		if (policy.type === 'timeout') {
			timeout = policy.duration;
			continue;
		}
		if (resilience.stage(policy) === 'admission') admission.push(policy);
		else operation.push(policy);
	}

	return Object.freeze(
		{
			inputs: Object.freeze(inputs),
			...(bodyLimit === undefined ? {} : { bodyLimit }),
			...(timeout === undefined ? {} : { timeout }),
			admission: Object.freeze(admission),
			operation: Object.freeze(operation),
		} satisfies ServiceExecutionPlan,
	);
}

/**
 * Erase parameter spelling when detecting route conflicts so /people/:id and /people/:name collide.
 *
 * @internal
 */
function normalizeRouteShape(path: string): string {
	return path.replace(/:[^/]+/g, ':parameter').replace(/\/+/g, '/');
}

/**
 * Project the resolved graph into stable diagnostic data, including reachable resources and requirements.
 * IDs describe the graph; runtime lookup still uses exact definition objects.
 *
 * @internal
 */
function manifest(
	definition: ServiceDefinition,
	operations: readonly ServiceOperationContract[],
	implementations?: import('@okikio/capability/resource').ResourceImplementationSet,
): ServiceManifest {
	const resources = uniqueByIdentity(operations.flatMap((operation) => operation.resources));
	const effects = uniqueByIdentity(operations.flatMap((operation) => operation.effects));
	return Object.freeze({
		id: definition.id,
		path: definition.path,
		...(definition.description !== undefined ? { description: definition.description } : {}),
		routes: Object.freeze(operations.map(routeManifest)),
		...(definition.environment !== undefined ? { environment: env.manifest(definition.environment) } : {}),
		resources: Object.freeze(resources.map((entry) => entry.id)),
		resourceGraph: resource.document(resources, implementations),
		requirements: requirement.document(requirement.compose(operations.map((operation) => operation.requirements))),
		reachableRequirements: requirement.document(
			requirement.compose(operations.map((operation) => operation.reachableRequirements)),
		),
		effects: Object.freeze(effects.map((entry) => entry.id)),
		problems: Object.freeze(
			uniqueByIdentity(operations.flatMap((operation) => operation.problems)).map((entry) => entry.id),
		),
		responses: Object.freeze(
			uniqueByIdentity(operations.flatMap((operation) => operation.responses)).map((entry) => entry.id),
		),
		middleware: Object.freeze(
			uniqueByIdentity(operations.flatMap((operation) => middlewareDefinitions(operation.middleware))).map((entry) =>
				entry.id
			),
		),
		resiliency: Object.freeze([
			...new Set(operations.flatMap((operation) => operation.resiliency.map((policy) => policy.type))),
		]),
		workflows: Object.freeze(definition.workflows.map((workflow) => workflow.id)),
		observers: Object.freeze(definition.observers.map((observer) => observer.id)),
	});
}

/**
 * Describe one effective method/path with its inherited contracts and precomputed input/policy stages.
 *
 * @internal
 */
function routeManifest(operation: ServiceOperationContract): ServiceRouteManifestEntry {
	return Object.freeze({
		id: operation.id,
		method: operation.method.toUpperCase() as Uppercase<EndpointMethod>,
		path: operation.path,
		operationId: operation.operation.operationId,
		endpointId: operation.endpoint.id,
		authentication: Object.freeze(operation.authentication.map(definitionId)),
		requirements: requirement.document(operation.requirements),
		reachableRequirements: requirement.document(operation.reachableRequirements),
		effects: Object.freeze(operation.effects.map((entry) => entry.id)),
		resources: Object.freeze(operation.resources.map((entry) => entry.id)),
		problems: Object.freeze(operation.problems.map((entry) => entry.id)),
		responses: Object.freeze(operation.responses.map((entry) => entry.id)),
		middleware: Object.freeze({
			wholeRequest: Object.freeze(operation.middleware.wholeRequest.map((entry) => entry.id)),
			beforeValidation: Object.freeze(operation.middleware.beforeValidation.map((entry) => entry.id)),
			afterValidation: Object.freeze(operation.middleware.afterValidation.map((entry) => entry.id)),
			aroundOperation: Object.freeze(operation.middleware.aroundOperation.map((entry) => entry.id)),
		}),
		resiliency: resilience.document(operation.resiliency),
		execution: Object.freeze({
			inputs: Object.freeze(operation.execution.inputs.map((input) => input.source)),
			...(operation.execution.bodyLimit === undefined ? {} : { bodyLimit: operation.execution.bodyLimit }),
			...(operation.execution.timeout === undefined ? {} : { timeout: operation.execution.timeout.toString() }),
		}),
	});
}

/**
 * Use an authored diagnostic ID when available; anonymous positions are display labels, not authority.
 *
 * @internal
 */
function definitionId(value: unknown, index: number): string {
	return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
		? (value as { id: string }).id
		: `anonymous:${index}`;
}

/**
 * Create one immutable service-validation issue discovered during compilation.
 *
 * @internal
 */
function issue(
	code: ServiceValidationIssue['code'],
	message: string,
	definition?: ServiceValidationSubject,
): ServiceValidationIssue {
	return definition === undefined ? Object.freeze({ code, message }) : Object.freeze({ code, message, definition });
}
