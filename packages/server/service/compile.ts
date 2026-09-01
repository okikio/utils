import * as catalog from '@okikio/catalog';
import type { CatalogEntryIdentity } from '@okikio/catalog';
import { joinPath } from '@okikio/server/endpoint/path';
import * as endpoint from '@okikio/server/endpoint';
import * as env from '@okikio/env';
import type {
	EndpointContributions,
	EndpointDefinition,
	EndpointEntry,
	EndpointGroup,
	AnyEndpointHandlerBinding,
	EndpointMethod,
	EndpointOperation,
	EmptyEndpointHost,
} from '@okikio/server/endpoint';
import * as middleware from '@okikio/server/middleware';
import type { MiddlewareDefinition, MiddlewareHandler, MiddlewareInput } from '@okikio/server/middleware';
import * as resilience from '@okikio/resilience';
import type { ResilienceInput } from '@okikio/resilience';
import type { ProblemDefinition } from '@okikio/http/problem';
import type { ResponseDefinition } from '@okikio/http/response';
import * as requirement from '@okikio/requirement';
import type { RequirementDefinition } from '@okikio/requirement';
import * as resource from '@okikio/resource';
import type { ResourceImplementationAny, ResourceDefinition } from '@okikio/resource';
import { ServerProblems } from '../problems.ts';

import { leafEndpoints } from './definition.ts';
import type {
	CompiledService,
	EffectiveServiceOperation,
	ServiceContributions,
	ServiceDefinition,
	ServiceImplementation,
	ServiceManifest,
	ServicePolicy,
	ServiceRoute,
	ServiceRouteManifestEntry,
	ServiceValidationIssue,
	ServiceValidationResult,
	ServiceValidationSubject,
} from './types.ts';

/** Error raised when service compilation finds one or more contract defects. */
export class ServiceCompilationError extends Error {
	readonly issues: readonly ServiceValidationIssue[];

	constructor(issues: readonly ServiceValidationIssue[]) {
		super(`Service compilation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}:\n${issues.map((issue) => `- ${issue.message}`).join('\n')}`);
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
 * Compiles implementation into the immutable runtime form used by execution.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
function compileImplementation<
	Definition extends ServiceDefinition,
	Host extends object = EmptyEndpointHost,
>(implementation: ServiceImplementation<Definition, Host>): CompiledService<Definition, Host> {
	const definition = implementation.definition;

	// Phase 1: validate and flatten the static route graph before considering
	// runtime implementations. This preserves authoring provenance for later
	// diagnostics and generated artifacts.
	const validation = validate(definition);
	const issues: ServiceValidationIssue[] = validation.valid ? [] : [...validation.issues];
	const routes = validation.valid ? validation.routes : collectRoutes(definition);

	// Phase 2: index every supplied runtime binding by exact imported identity.
	// String IDs remain diagnostic projections and never select behavior.
	const handlerByEndpoint = indexEndpointHandlers(implementation.endpoints, routes, issues);
	const middlewareByDefinition = indexMiddlewareHandlers(implementation.middleware, issues);
	const resourceByDefinition = indexResourceImplementations(implementation.resources.implementations, issues);
	const policyTargets = new Map(definition.policies.map((policy) => [policy, new Set(leafEndpoints(policy.endpoints))] as const));
	const effective: EffectiveServiceOperation[] = [];
	const usedMiddleware = new Set<MiddlewareDefinition>();
	const usedResources = new Set<ResourceDefinition>();

	// Phase 3: resolve the effective contract for each concrete method/path.
	// Contributions are additive from service -> targeted policies -> groups ->
	// endpoint -> operation; inner layers cannot silently erase outer concerns.
	for (const route of routes) {
		const handler = handlerByEndpoint.get(route.endpoint)?.get(route.operation);
		if (!handler) {
			issues.push(issue('missing-endpoint-handler', `Operation ${JSON.stringify(route.operation.id)} has no endpoint handler.`, route.operation));
			continue;
		}
		const sources = contributionSources(definition, route, policyTargets);
		const middlewareInput: readonly MiddlewareInput[] = sources.flatMap(
			(source) => source.middleware === undefined ? [] : [source.middleware],
		);
		const middlewareValidation = middleware.validate(middlewareInput);
		if (!middlewareValidation.valid) {
			for (const item of middlewareValidation.issues) issues.push(issue('invalid-definition', item.message, item.definition));
			continue;
		}
		for (const candidate of middlewareDefinitions(middlewareValidation.plan)) {
			usedMiddleware.add(candidate);
			if (!middlewareByDefinition.has(candidate)) {
				issues.push(issue('missing-middleware-handler', `Middleware ${JSON.stringify(candidate.id)} has no runtime handler.`, candidate));
			}
		}

		const resourceRoots = concreteResourceDefinitions([
			...definitions<CatalogEntryIdentity>(sources, 'resources'),
			...middlewareDefinitions(middlewareValidation.plan).flatMap((candidate) =>
				candidate.resources === undefined ? [] : catalog.values(candidate.resources)
			),
		], issues);
		const resources = collectResourceClosure(resourceRoots);
		for (const resourceDefinition of resources) {
			usedResources.add(resourceDefinition);
			if (!resourceByDefinition.has(resourceDefinition)) {
				issues.push(issue('missing-resource-implementation', `Resource ${JSON.stringify(resourceDefinition.id)} has no runtime implementation.`, resourceDefinition));
			}
		}

		const resiliencyInput = [
			...sources.flatMap((source) => source.resiliency === undefined ? [] : [source.resiliency]),
			...middlewareDefinitions(middlewareValidation.plan).flatMap((candidate) => candidate.resiliency === undefined ? [] : [candidate.resiliency]),
		] as readonly ResilienceInput[];
		const resiliencyValidation = resilience.validate(
			resiliencyInput,
			{ safety: operationSafety(route.method) },
		);
		if (!resiliencyValidation.valid) {
			for (const item of resiliencyValidation.issues) issues.push(issue('invalid-resiliency', `${route.id}: ${item.message}`, item.policy));
			continue;
		}

		const problems = uniqueByIdentity([
			...definitions<ProblemDefinition>(sources, 'problems'),
			...middlewareDefinitions(middlewareValidation.plan).flatMap((candidate) =>
				candidate.problems === undefined ? [] : catalog.values(candidate.problems)
			),
			...generatedServerProblems(route, resiliencyValidation.policies),
		]);
		const responses = route.operation.responses === undefined
			? Object.freeze([])
			: catalog.values(route.operation.responses);

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
			resources: Object.freeze(resources),
			problems: Object.freeze(problems),
			responses: Object.freeze(responses),
			resiliency: resiliencyValidation.policies,
			handler,
		}));
	}

	for (const binding of implementation.endpoints) {
		if (!routes.some((route) => route.operation === binding.operation)) {
			issues.push(issue('extraneous-endpoint-handler', `Endpoint handler for ${JSON.stringify(binding.operation.id)} is outside service ${JSON.stringify(definition.id)}.`, binding));
		}
	}
	for (const handler of implementation.middleware) {
		if (!usedMiddleware.has(handler.definition)) {
			issues.push(issue('extraneous-middleware-handler', `Middleware handler ${JSON.stringify(handler.definition.id)} is not referenced by service ${JSON.stringify(definition.id)}.`, handler));
		}
	}
	for (const resourceImplementation of implementation.resources.implementations) {
		if (!usedResources.has(resourceImplementation.definition)) {
			issues.push(issue('resource-conflict', `Resource implementation ${JSON.stringify(resourceImplementation.definition.id)} is not reachable from service ${JSON.stringify(definition.id)}.`, resourceImplementation));
		}
	}

	validateEnvironment(definition, [...usedResources], issues);
	// Phase 4: fail atomically. A partially linked service is never returned.
	if (issues.length > 0) throw new ServiceCompilationError(Object.freeze(issues));
	const operations = Object.freeze(effective);
	// Phase 5: emit the immutable execution plan and its drift-checkable manifest.
	return Object.freeze({
		kind: 'compiled-service',
		definition,
		implementation,
		operations,
		manifest: manifest(definition, operations, implementation.resources),
	});
}

/** Return the deterministic manifest retained by a compiled service. */
export function document(compiled: CompiledService): ServiceManifest {
	return compiled.manifest;
}

/**
 * Collects routes while preserving deterministic identity and order.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
function collectRoutes(definition: ServiceDefinition): ServiceRoute[] {
	const routes: ServiceRoute[] = [];
	const walk = (
		entries: readonly EndpointEntry[],
		prefix: string,
		groups: readonly EndpointGroup[],
	): void => {
		for (const entry of entries) {
			if (entry.kind === 'endpoint') {
				const path = joinPath(prefix, entry.path);
				for (const operation of entry.operations) {
					routes.push(Object.freeze({
						id: `${definition.id}:${operation.id}:${operation.method}`,
						service: definition,
						endpoint: entry,
						operation,
						groups: Object.freeze([...groups]),
						method: operation.method,
						path,
					}));
				}
				continue;
			}
			if (entry.kind === 'endpoint-group-selection') {
				walk(entry.endpoints, prefix, groups);
				continue;
			}
			walk(entry.endpoints, joinPath(prefix, entry.path), [...groups, entry]);
		}
	};
	walk(definition.endpoints, definition.path, []);
	return routes;
}

/**
 * Checks policies and preserves the deterministic issues needed by callers.
 *
 * @internal
 */
function validatePolicies(definition: ServiceDefinition, issues: ServiceValidationIssue[]): void {
	const available = new Set(leafEndpoints(definition.endpoints));
	for (const policy of definition.policies) {
		for (const target of leafEndpoints(policy.endpoints)) {
			if (!available.has(target)) {
				issues.push(issue('policy-target-outside-service', `Policy ${JSON.stringify(policy.id)} targets endpoint ${JSON.stringify(target.id)} outside service ${JSON.stringify(definition.id)}.`, policy));
			}
		}
	}
}

/**
 * Checks route identity and preserves the deterministic issues needed by callers.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
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
			issues.push(issue('route-conflict', `${route.method.toUpperCase()} ${route.path} conflicts with ${existing.path}.`, route));
		}
		routeOwners.set(key, route);
		const operationOwner = operationOwners.get(route.operation.operationId);
		if (operationOwner && operationOwner !== route.operation) {
			issues.push(issue('operation-id-conflict', `Operation ID ${JSON.stringify(route.operation.operationId)} is duplicated.`, route.operation));
		}
		operationOwners.set(route.operation.operationId, route.operation);
	}
}

/**
 * Collects the definition sources that contribute requirements, resilience, problems, and resources to an operation.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
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
 * Returns the exact definitions selected by a heterogeneous service composition input.
 *
 * @internal
 */
function definitions<Entry extends CatalogEntryIdentity>(
	sources: readonly (ServiceContributions | EndpointContributions)[],
	field: 'requirements' | 'resources' | 'problems',
): Entry[] {
	const result: Entry[] = [];
	for (const source of sources) {
		const input = source[field] as import('@okikio/catalog').DefinitionInput<Entry> | undefined;
		if (input !== undefined) result.push(...catalog.values(input));
	}
	return result;
}

/**
 * Collects middleware definitions from service, group, endpoint, and operation scopes in execution order.
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
 * Indexes endpoint handlers for exact validation and lookup in later phases.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
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
				`Operation ${JSON.stringify(binding.operation.id)} has duplicate handlers for endpoint ${JSON.stringify(binding.endpoint.id)}.`,
				binding,
			));
		}
		endpointBindings.set(binding.operation, binding);
	}
	return result;
}

/**
 * Indexes middleware handlers for exact validation and lookup in later phases.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
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
		if (existing && existing !== handler) issues.push(issue('invalid-definition', `Middleware ${JSON.stringify(handler.definition.id)} has duplicate handlers.`, handler));
		result.set(handler.definition, handler);
	}
	return result;
}

/**
 * Indexes resource implementations for exact validation and lookup in later phases.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
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
		if (owner && owner !== implementation.definition) issues.push(issue('resource-conflict', `Resource ID ${JSON.stringify(implementation.definition.id)} belongs to different definitions.`, implementation));
		ids.set(implementation.definition.id, implementation.definition);
		const existing = result.get(implementation.definition);
		if (existing && existing !== implementation) issues.push(issue('resource-conflict', `Resource ${JSON.stringify(implementation.definition.id)} has duplicate implementations.`, implementation));
		result.set(implementation.definition, implementation);
	}
	return result;
}

/**
 * Filters contributed resource selections to concrete resource definitions before implementation coverage is checked.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
function concreteResourceDefinitions(
	candidates: readonly CatalogEntryIdentity[],
	issues: ServiceValidationIssue[],
): ResourceDefinition[] {
	const result: ResourceDefinition[] = [];
	for (const definition of candidates) {
		if (!isConcreteResourceDefinition(definition)) {
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
 * Checks whether concrete resource definition satisfies the condition required by the compiled service runtime.
 *
 * @internal
 */
function isConcreteResourceDefinition(value: CatalogEntryIdentity): value is ResourceDefinition {
	return value.kind === 'resource' &&
		typeof value === 'object' && value !== null &&
		'dependencies' in value &&
		typeof (value as { readonly dependencies?: unknown }).dependencies === 'object' &&
		(value as { readonly dependencies?: unknown }).dependencies !== null;
}

/**
 * Collects resource closure while preserving deterministic identity and order.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
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
		if (owner && owner !== definition) throw new TypeError(`Resource ID ${JSON.stringify(definition.id)} belongs to different definitions.`);
		ids.set(definition.id, definition);
		const cycle = visiting.indexOf(definition);
		if (cycle >= 0) throw new TypeError(`Resource dependency cycle: ${[...visiting.slice(cycle), definition].map((item) => item.id).join(' -> ')}`);
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
 * Generates the unique by identity without colliding with identities already owned by the compiled service runtime.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
function uniqueByIdentity<Entry extends CatalogEntryIdentity>(input: readonly Entry[]): Entry[] {
	const result: Entry[] = [];
	const seen = new Set<Entry>();
	const ids = new Map<string, Entry>();
	for (const entry of input) {
		const owner = ids.get(entry.id);
		if (owner && owner !== entry) throw new TypeError(`Definition ID ${JSON.stringify(entry.id)} belongs to different objects.`);
		ids.set(entry.id, entry);
		if (!seen.has(entry)) {
			seen.add(entry);
			result.push(entry);
		}
	}
	return result;
}



/**
 * Returns the definition values consumed by the compiled service runtime.
 *
 * @internal
 */
function definitionValues<Entry extends import('@okikio/catalog').CatalogEntryIdentity>(
	input: import('@okikio/catalog').DefinitionInput<Entry> | undefined,
): readonly Entry[] {
	return input === undefined ? Object.freeze([]) : catalog.values(input);
}

/**
 * Checks environment and preserves the deterministic issues needed by callers.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
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
			issues.push(issue('missing-environment', `Resource ${JSON.stringify(selected.id)} requires environment values, but service ${JSON.stringify(definition.id)} has no environment definition.`, selected));
			continue;
		}
		for (const field of requirement.fields) {
			const supplied = definition.environment.fields[field.key];
			if (supplied !== field.field) {
				issues.push(issue('environment-conflict', `Resource ${JSON.stringify(selected.id)} requires canonical environment field ${JSON.stringify(field.key)} that is not imported by service ${JSON.stringify(definition.id)}.`, selected));
			}
		}
	}
}

/**
 * Derives the server-generated HTTP problems that request parsing, validation, and runtime execution can emit.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
function generatedServerProblems(
	route: ServiceRoute,
	policies: readonly import('@okikio/resilience').ResiliencePolicy[],
): readonly ProblemDefinition[] {
	const definitions: ProblemDefinition[] = [
		ServerProblems.UndeclaredResult,
		ServerProblems.Internal,
	];
	const hasInput = Object.keys(route.endpoint.inputs).length > 0 ||
		Object.keys(route.operation.inputs).length > 0;
	if (hasInput) definitions.unshift(ServerProblems.InvalidRequest);
	const hasBodyInput = route.endpoint.inputs.json !== undefined || route.endpoint.inputs.form !== undefined ||
		route.operation.inputs.json !== undefined || route.operation.inputs.form !== undefined;
	if (hasBodyInput) definitions.unshift(ServerProblems.UnsupportedMediaType);
	if (catalog.values<ResponseDefinition>(route.operation.responses ?? []).some((definition) => definition.mode !== 'empty' && definition.mode !== 'redirect')) {
		definitions.unshift(ServerProblems.NotAcceptable);
	}
	if (policies.some((policy) => policy.type === 'idempotency')) definitions.unshift(ServerProblems.IdempotencyConflict);
	if (policies.some((policy) => policy.type === 'rate-limit')) definitions.unshift(ServerProblems.RateLimited);
	if (policies.some((policy) => policy.type === 'bulkhead' || policy.type === 'circuit-breaker')) definitions.unshift(ServerProblems.CapacityUnavailable);
	if (policies.some((policy) => policy.type === 'body-limit')) definitions.unshift(ServerProblems.BodyTooLarge);
	if (policies.some((policy) => policy.type === 'timeout')) definitions.unshift(ServerProblems.DeadlineExceeded);
	return definitions;
}

/**
 * Builds the operation safety consumed by the compiled service runtime.
 *
 * @internal
 */
function operationSafety(method: EndpointMethod): import('@okikio/resilience').ResilienceOperationSafety {
	if (method === 'get' || method === 'head' || method === 'options') return 'safe';
	if (method === 'put' || method === 'delete') return 'idempotent';
	return 'unsafe';
}

/**
 * Normalizes route shape into the canonical internal form used by later phases.
 *
 * @internal
 */
function normalizeRouteShape(path: string): string {
	return path.replace(/:[^/]+/g, ':parameter').replace(/\/+/g, '/');
}

/**
 * Builds the manifest that records the state consumed by the compiled service runtime.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
function manifest(
	definition: ServiceDefinition,
	operations: readonly EffectiveServiceOperation[],
	implementations: import('@okikio/resource').ResourceImplementationSet,
): ServiceManifest {
	const resources = uniqueByIdentity(operations.flatMap((operation) => operation.resources));
	return Object.freeze({
		id: definition.id,
		path: definition.path,
		...(definition.description !== undefined ? { description: definition.description } : {}),
		routes: Object.freeze(operations.map(routeManifest)),
		...(definition.environment !== undefined ? { environment: env.manifest(definition.environment) } : {}),
		resources: Object.freeze(resources.map((entry) => entry.id)),
		resourceGraph: resource.document(resources, implementations),
		requirements: requirement.document(requirement.compose(operations.map((operation) => operation.requirements))),
		reachableRequirements: requirement.document(requirement.compose(operations.map((operation) => operation.reachableRequirements))),
		problems: Object.freeze(uniqueByIdentity(operations.flatMap((operation) => operation.problems)).map((entry) => entry.id)),
		responses: Object.freeze(uniqueByIdentity(operations.flatMap((operation) => operation.responses)).map((entry) => entry.id)),
		middleware: Object.freeze(uniqueByIdentity(operations.flatMap((operation) => middlewareDefinitions(operation.middleware))).map((entry) => entry.id)),
		resiliency: Object.freeze([...new Set(operations.flatMap((operation) => operation.resiliency.map((policy) => policy.type)))]),
		workflows: Object.freeze(definition.workflows.map((workflow) => workflow.id)),
	});
}

/**
 * Builds the route manifest that records the state consumed by the compiled service runtime.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
function routeManifest(operation: EffectiveServiceOperation): ServiceRouteManifestEntry {
	return Object.freeze({
		id: operation.id,
		method: operation.method.toUpperCase() as Uppercase<EndpointMethod>,
		path: operation.path,
		operationId: operation.operation.operationId,
		endpointId: operation.endpoint.id,
		authentication: Object.freeze(operation.authentication.map(definitionId)),
		requirements: requirement.document(operation.requirements),
		reachableRequirements: requirement.document(operation.reachableRequirements),
		resources: Object.freeze(operation.resources.map((entry) => entry.id)),
		problems: Object.freeze(operation.problems.map((entry) => entry.id)),
		responses: Object.freeze(operation.responses.map((entry) => entry.id)),
		middleware: Object.freeze({
			wholeRequest: Object.freeze(operation.middleware.wholeRequest.map((entry) => entry.id)),
			beforeValidation: Object.freeze(operation.middleware.beforeValidation.map((entry) => entry.id)),
			afterValidation: Object.freeze(operation.middleware.afterValidation.map((entry) => entry.id)),
			aroundOperation: Object.freeze(operation.middleware.aroundOperation.map((entry) => entry.id)),
		}),
		resiliency: Object.freeze(operation.resiliency.map((policy) => policy.type)),
	});
}

/**
 * Derives the definition id from exact imported definitions used by the compiled service runtime.
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
	return definition === undefined
		? Object.freeze({ code, message })
		: Object.freeze({ code, message, definition });
}
