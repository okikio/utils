import type { ProblemDefinition } from '@okikio/http/problem';
import type {
	OpenApiDocument,
	OpenApiOptions,
	OpenApiSecurityRequirement,
	OpenApiSecurityScheme,
} from '../endpoint/openapi.ts';
import { openapi as endpointOpenApi } from '../endpoint/openapi.ts';
import { normalizePathTemplate } from '../endpoint/path.ts';
import { freeze } from '../openapi/value.ts';
import { openapi as serviceOpenApi } from '../service/openapi.ts';
import { routes as serviceRoutes } from '../service/route.ts';
import { compileDefinition } from '../service/compile.ts';
import type {
	CompiledService,
	CompiledServiceDefinition,
	ServiceDefinition,
	ServiceOperationContract,
} from '../service/types.ts';
import { GatewayProblems } from './problems.ts';
import { assertReferences } from './artifact.ts';
import type { GatewayArtifactRoute } from './artifact.ts';
import type { CompiledGateway, CompiledGatewayRoute } from './types.ts';

/** Caller-facing authentication projection owned by the host's identity concern. */
export interface GatewayOpenApiSecurity {
	/** Available schemes. Only schemes referenced by selected operations are emitted. */
	readonly schemes: Readonly<Record<string, OpenApiSecurityScheme>>;
	/**
	 * Project the combined edge/service authentication contract for the caller.
	 *
	 * Return alternatives as separate objects; schemes in one object are required
	 * together. Do not advertise credentials inserted by the gateway itself.
	 */
	readonly operation: (
		route: CompiledGatewayRoute,
		effective: ServiceOperationContract,
	) => readonly OpenApiSecurityRequirement[] | undefined;
}

/** Options for projecting the exact mounted operation graph without live resources. */
export interface GatewayOpenApiOptions extends OpenApiOptions {
	/**
	 * Optional contracts to drift-check against the exact mounted definitions. Defaults to resolving those
	 * definitions alone.
	 */
	readonly services?: readonly (ServiceDefinition | CompiledServiceDefinition | CompiledService)[];
	/** Narrow the mounted graph to an audience. This cannot add an unmounted route. */
	readonly include?: (route: CompiledGatewayRoute, effective: ServiceOperationContract) => boolean;
	/** Narrow explicitly admitted portable routes without synthesizing a local service contract. */
	readonly includeArtifact?: (route: CompiledGatewayRoute, effective: GatewayArtifactRoute) => boolean;
	/** Caller authentication projection; downstream assertions are never inferred from IDs. */
	readonly security?: GatewayOpenApiSecurity;
	/** Additional problems returned by host-owned authentication/assertion adapters. */
	readonly problems?: (
		route: CompiledGatewayRoute,
		effective: ServiceOperationContract,
	) => readonly ProblemDefinition[];
}

/**
 * Project mounted Gateway routes through the existing effective-service emitter.
 *
 * Mounted definitions supply the complete service contracts by default; optional
 * compiled artifacts allow explicit drift checks. Every route joins by definition and route
 * identity, with method/path/endpoint/operation drift rejected. The default
 * includes explicitly admitted internal callbacks because they are reachable;
 * `includeInternal: false` and `include` can produce a narrower audience view.
 * Origin URLs are not advertised: `servers` is always host-supplied public data.
 * No environment, network, database, handler, or resource factory is executed.
 *
 * @example
 * ```ts
 * const document = await openapi(compiledGateway, {
 *   title: 'Customer API',
 *   version: '1.0.0',
 *   servers: [{ url: 'https://api.example.com' }],
 *   schemaProjector,
 *   security: callerSecurity,
 * });
 * ```
 */
export async function openapi(compiled: CompiledGateway, options: GatewayOpenApiOptions): Promise<OpenApiDocument> {
	if (
		options.specVersion !== '3.2.0' &&
		compiled.definition.artifacts?.some((artifact) => artifact.document.openapi === '3.2.0')
	) {
		throw new TypeError('OpenAPI 3.2 artifacts require specVersion 3.2.0; implicit downgrade is unsupported.');
	}
	const description = options.description ?? compiled.definition.description;
	const base = await endpointOpenApi([], {
		title: options.title,
		version: options.version,
		...(options.specVersion === undefined ? {} : { specVersion: options.specVersion }),
		...(options.schemaProjectorMode === undefined ? {} : { schemaProjectorMode: options.schemaProjectorMode }),
		...(description === undefined ? {} : { description }),
		...(options.servers === undefined ? {} : { servers: options.servers }),
	});
	const services = indexServices(
		compiled,
		options.services ??
			compiled.definition.services.map((mount) =>
				mount.target.kind === 'service-selection' ? mount.target.service : mount.target
			),
	);
	const authoredRoutes = new Map(
		[...services].map((
			[id, service],
		) => [id, new Map(serviceRoutes(service.definition).map((route) => [route.id, route]))]),
	);
	const byService = new Map<CompiledServiceDefinition, ServiceOperationContract[]>();
	const sourceRoutes = new Map<ServiceOperationContract, CompiledGatewayRoute>();
	const operationIds = new Set<string>();
	const pathTemplates = new Map<string, string>();
	for (const route of compiled.routes) {
		if (route.artifact !== undefined) continue;
		const service = services.get(route.serviceId);
		if (service === undefined) {
			throw new TypeError(`Missing compiled service contract for ${JSON.stringify(route.serviceId)}.`);
		}
		const effective = service.operations.find((operation) => operation.id === route.serviceRouteId);
		const authored = authoredRoutes.get(route.serviceId)?.get(route.serviceRouteId);
		if (
			effective === undefined || authored === undefined || effective.service !== service.definition ||
			effective.endpoint !== authored.endpoint || effective.operation !== authored.operation ||
			effective.endpoint.id !== route.endpointId ||
			effective.operation.operationId !== route.operationId || effective.method.toUpperCase() !== route.method ||
			effective.path !== route.path
		) {
			throw new TypeError(`Gateway route ${JSON.stringify(route.id)} does not match its compiled service contract.`);
		}
		const internal = effective.endpoint.internal === true || effective.operation.internal === true ||
			effective.groups.some((group) => group.internal === true);
		if ((options.includeInternal === false && internal) || options.include?.(route, effective) === false) continue;
		const shape = normalizePathTemplate(route.path);
		const previousPath = pathTemplates.get(shape);
		if (previousPath !== undefined && previousPath !== route.path) {
			throw new TypeError(
				`Gateway OpenAPI paths ${previousPath} and ${route.path} use different parameter names for the same template.`,
			);
		}
		pathTemplates.set(shape, route.path);
		if (operationIds.has(route.operationId)) {
			throw new TypeError(
				`Gateway OpenAPI operation ID ${JSON.stringify(route.operationId)} is declared more than once.`,
			);
		}
		operationIds.add(route.operationId);
		const augmented: ServiceOperationContract = Object.freeze({
			...effective,
			problems: uniqueProblems([
				...effective.problems,
				...edgeProblems(route),
				...(options.problems?.(route, effective) ?? []),
			]),
		});
		const operations = byService.get(service) ?? [];
		operations.push(augmented);
		byService.set(service, operations);
		sourceRoutes.set(augmented, route);
	}

	const paths: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
	for (const [service, operations] of byService) {
		const document = await serviceOpenApi({ ...service, operations }, {
			title: options.title,
			version: options.version,
			...(options.specVersion === undefined ? {} : { specVersion: options.specVersion }),
			...(options.schemaProjectorMode === undefined ? {} : { schemaProjectorMode: options.schemaProjectorMode }),
			includeInternal: true,
			...(options.schemaProjector === undefined ? {} : { schemaProjector: options.schemaProjector }),
			...(options.security === undefined ? {} : {
				security: {
					schemes: options.security.schemes,
					operation: (effective) => options.security!.operation(sourceRoutes.get(effective)!, effective),
				},
			}),
		});
		for (const [path, entry] of Object.entries(document.paths)) {
			const merged = { ...paths[path] };
			for (const [method, operation] of Object.entries(entry)) {
				if (Object.hasOwn(merged, method)) {
					throw new TypeError(`Gateway OpenAPI operation ${method.toUpperCase()} ${path} is declared more than once.`);
				}
				merged[method] = operation;
			}
			paths[path] = merged;
		}
	}
	const components: Record<string, Record<string, unknown>> = Object.create(null);
	const available: Record<string, OpenApiSecurityScheme> = { ...(options.security?.schemes ?? {}) };
	for (const artifact of compiled.definition.artifacts ?? []) {
		for (const [group, entries] of Object.entries(artifact.document.components ?? {})) {
			if (!isRecord(entries)) throw new TypeError('Artifact OpenAPI components must be records.');
			if (group === 'securitySchemes') {
				for (const [name, scheme] of Object.entries(entries)) {
					if (!isRecord(scheme)) throw new TypeError('Artifact caller security schemes must be records.');
					if (Object.hasOwn(available, name) && JSON.stringify(available[name]) !== JSON.stringify(scheme)) {
						throw new TypeError(`Conflicting gateway caller scheme ${JSON.stringify(name)}.`);
					}
					available[name] = scheme;
				}
				continue;
			}
			const target = components[group] ??= Object.create(null);
			for (const [name, value] of Object.entries(entries)) {
				if (Object.hasOwn(target, name)) {
					throw new TypeError(`Conflicting artifact OpenAPI component ${JSON.stringify(name)}.`);
				}
				target[name] = value;
			}
		}
	}
	for (const route of compiled.routes) {
		if (route.artifact === undefined || route.artifactRoute === undefined) continue;
		if (options.includeArtifact?.(route, route.artifactRoute) === false) continue;
		const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
		const item = route.artifact.document.paths[path]!;
		const method = route.method.toLowerCase();
		const operation = item[method];
		if (!isRecord(operation)) throw new TypeError('Compiled artifact route has no checked owner operation.');
		const inherited = Object.fromEntries(
			Object.entries(item).filter(([key]) =>
				!['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(key)
			),
		);
		if (paths[path]?.[method] !== undefined) {
			throw new TypeError('Artifact OpenAPI route conflicts with a local operation.');
		}
		paths[path] = { ...paths[path], ...inherited, [method]: artifactProblems(operation, route) };
	}
	const schemes = referencedSchemes(paths, available);
	const document = freeze({
		...base,
		paths,
		...(Object.keys(components).length === 0 && Object.keys(schemes).length === 0 ? {} : {
			components: { ...components, ...(Object.keys(schemes).length === 0 ? {} : { securitySchemes: schemes }) },
		}),
	});
	if (compiled.definition.artifacts?.length) assertReferences(document);
	return document;
}

/** Add the actual generic gateway failure bodies without modifying owner schemas. */
function artifactProblems(
	operation: Readonly<Record<string, unknown>>,
	route: CompiledGatewayRoute,
): Readonly<Record<string, unknown>> {
	const responses: Record<string, unknown> = { ...(isRecord(operation.responses) ? operation.responses : {}) };
	for (const definition of edgeProblems(route)) {
		const status = String(definition.status);
		const existing = responses[status];
		if (isRecord(existing) && '$ref' in existing) {
			throw new TypeError('Artifact referenced response requires owner inlining before gateway problem augmentation.');
		}
		const content = isRecord(existing) && isRecord(existing.content) ? existing.content : {};
		const media = isRecord(content['application/problem+json']) ? content['application/problem+json'] : {};
		const schema = {
			type: 'object',
			required: ['type', 'title', 'status'],
			properties: {
				type: { type: 'string', const: definition.type },
				title: { type: 'string', const: definition.title },
				status: { type: 'integer', const: definition.status },
				detail: { type: 'string' },
				instance: { type: 'string' },
			},
		};
		responses[status] = {
			...(isRecord(existing) ? existing : {}),
			description: isRecord(existing) && typeof existing.description === 'string'
				? existing.description
				: definition.description ?? definition.title,
			content: {
				...content,
				'application/problem+json': {
					...media,
					schema: media.schema === undefined ? schema : { oneOf: [media.schema, schema] },
				},
			},
		};
	}
	return { ...operation, responses };
}

/** Reject reused IDs attached to different definition objects before projecting anything. */
function indexServices(
	compiled: CompiledGateway,
	input: readonly (ServiceDefinition | CompiledServiceDefinition | CompiledService)[],
): ReadonlyMap<string, CompiledServiceDefinition> {
	const result = new Map<string, CompiledServiceDefinition>();
	const supplied = new Map<string, ServiceDefinition | CompiledServiceDefinition | CompiledService>();
	for (const entry of input) {
		if (entry.kind !== 'service' && entry.kind !== 'compiled-service-definition' && entry.kind !== 'compiled-service') {
			throw new TypeError('Gateway OpenAPI requires service definitions or compiled contracts, not route manifests.');
		}
		const artifact: CompiledServiceDefinition = entry.kind === 'service'
			? compileDefinition(entry)
			: entry.kind === 'compiled-service-definition'
			? entry
			: Object.freeze({
				kind: 'compiled-service-definition',
				definition: entry.definition,
				operations: entry.operations,
				manifest: entry.manifest,
			});
		const existing = supplied.get(artifact.definition.id);
		if (existing !== undefined && existing !== entry) {
			throw new TypeError(`Conflicting compiled service contracts for ${JSON.stringify(artifact.definition.id)}.`);
		}
		supplied.set(artifact.definition.id, entry);
		result.set(artifact.definition.id, artifact);
	}
	for (const mount of compiled.definition.services) {
		const definition = mount.target.kind === 'service-selection' ? mount.target.service : mount.target;
		const artifact = result.get(definition.id);
		if (artifact !== undefined && artifact.definition !== definition) {
			throw new TypeError(`Compiled service ${JSON.stringify(definition.id)} is not the exact mounted definition.`);
		}
	}
	return result;
}

/** Only failures actually emitted by generic transport or a selected route policy are added. */
function edgeProblems(route: CompiledGatewayRoute): readonly ProblemDefinition[] {
	return [
		GatewayProblems.InvalidRequest,
		GatewayProblems.Unavailable,
		...(route.bodyLimit === undefined ? [] : [GatewayProblems.BodyTooLarge]),
		...(route.timeout === undefined ? [] : [GatewayProblems.DeadlineExceeded]),
		...(route.redirects.mode === 'reject-cross-origin' ? [GatewayProblems.InvalidRedirect] : []),
	];
}

/** Preserve problem identity and reject a collision rather than silently substituting a contract. */
function uniqueProblems(input: readonly ProblemDefinition[]): readonly ProblemDefinition[] {
	const byId = new Map<string, ProblemDefinition>();
	for (const entry of input) {
		const previous = byId.get(entry.id);
		if (previous !== undefined && previous !== entry) {
			throw new TypeError(`Conflicting OpenAPI problem definitions for ${JSON.stringify(entry.id)}.`);
		}
		byId.set(entry.id, entry);
	}
	return Object.freeze([...byId.values()]);
}

/** Validate security references and omit unused schemes, including private hop credentials. */
function referencedSchemes(
	paths: OpenApiDocument['paths'],
	available: GatewayOpenApiSecurity['schemes'],
): GatewayOpenApiSecurity['schemes'] {
	const result: Record<string, OpenApiSecurityScheme> = Object.create(null);
	for (const entry of Object.values(paths)) {
		for (const operation of Object.values(entry)) {
			if (!isRecord(operation) || operation.security === undefined) continue;
			if (!Array.isArray(operation.security)) {
				throw new TypeError('Gateway OpenAPI security must be an array of alternatives.');
			}
			for (const alternative of operation.security) {
				if (!isRecord(alternative)) throw new TypeError('Gateway OpenAPI security alternatives must be records.');
				for (const [name, scopes] of Object.entries(alternative)) {
					if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
						throw new TypeError(`Invalid scopes for OpenAPI security scheme ${JSON.stringify(name)}.`);
					}
					if (!Object.hasOwn(available, name)) {
						throw new TypeError(`Undeclared OpenAPI security scheme ${JSON.stringify(name)}.`);
					}
					result[name] = available[name]!;
				}
			}
		}
	}
	return result;
}

/**
 * Recognize object-shaped values in already-projected OpenAPI data. This structural check does not
 * validate prototypes.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
