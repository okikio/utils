import { compileDefinition } from './compile.ts';
import * as requirement from '@okikio/capability/requirement';
import * as record from '@okikio/collection/record';
import { freeze as freezeOpenApi } from '../openapi/value.ts';
import * as endpoint from '@okikio/server/endpoint';
import type {
	EndpointDefinition,
	EndpointOperation,
	OpenApiDocument,
	OpenApiOptions,
	OpenApiSecurityRequirement,
	OpenApiSecurityScheme,
} from '@okikio/server/endpoint';

import type { CompiledService, CompiledServiceDefinition, ServiceOperationContract } from './types.ts';

/** Service-level OpenAPI authentication projection supplied by the owning concern package. */
export interface ServiceOpenApiSecurity {
	/** Named reusable schemes referenced by operation-level security declarations. */
	readonly schemes: Readonly<Record<string, OpenApiSecurityScheme>>;
	/** Project one compiler-resolved operation into alternative OpenAPI authentication requirements. */
	readonly operation: (effective: ServiceOperationContract) => readonly OpenApiSecurityRequirement[] | undefined;
}

/** Options for projecting one compiled service to OpenAPI 3.1. */
export interface ServiceOpenApiOptions extends Omit<OpenApiOptions, 'description'> {
	/** Override the service definition description in the generated document. */
	readonly description?: string;
	/** Host-authored caller authentication projection; documentation does not enforce it. */
	readonly security?: ServiceOpenApiSecurity;
}

/**
 * Generate OpenAPI from the compiler-resolved operation graph.
 *
 * The projection uses effective response and problem envelopes, including
 * service, policy, group, endpoint, middleware, resource, and compiler-
 * generated contributions. It never reconstructs route ownership from IDs or
 * copied URL inventories.
 */
export async function openapi(
	input: import('./types.ts').ServiceDefinition | CompiledService | CompiledServiceDefinition,
	options: ServiceOpenApiOptions,
): Promise<OpenApiDocument> {
	record.assert(options, 'service OpenAPI options');
	const compiled = input.kind === 'service' ? compileDefinition(input) : input;
	const definitions = compiled.operations.map(effectiveEndpoint);
	const description = options.description ?? compiled.definition.description;
	const document = await endpoint.openapi(definitions, {
		title: options.title,
		version: options.version,
		...(options.specVersion === undefined ? {} : { specVersion: options.specVersion }),
		...(options.schemaProjectorMode === undefined ? {} : { schemaProjectorMode: options.schemaProjectorMode }),
		...(options.includeInternal !== undefined ? { includeInternal: options.includeInternal } : {}),
		...(options.servers !== undefined ? { servers: options.servers } : {}),
		...(options.schemaProjector !== undefined ? { schemaProjector: options.schemaProjector } : {}),
		...(description !== undefined ? { description } : {}),
	});
	return securityOpenApi(resilienceOpenApi(document, compiled.operations), compiled.operations, options.security);
}

/**
 * Project one resolved operation with its inherited problems/responses and complete service path.
 * Internal visibility includes its operation, endpoint, and containing groups.
 *
 * @internal
 */
function effectiveEndpoint(
	effective: ServiceOperationContract,
): EndpointDefinition {
	const operation = Object.freeze(
		{
			...effective.operation,
			problems: effective.problems,
			responses: effective.responses,
		} satisfies EndpointOperation,
	);
	return Object.freeze({
		kind: 'endpoint',
		id: `${effective.id}:openapi`,
		...(effective.endpoint.description !== undefined ? { description: effective.endpoint.description } : {}),
		path: effective.path,
		inputs: effective.endpoint.inputs,
		operations: Object.freeze([operation]),
		internal: effective.operation.internal === true ||
			effective.endpoint.internal === true ||
			effective.groups.some((group) => group.internal === true),
	});
}
/**
 * Document effective idempotency headers and retry hints without granting execution or retry authority.
 * Keep existing authored headers and avoid adding the same idempotency parameter twice.
 *
 * @internal
 */
function resilienceOpenApi(
	document: OpenApiDocument,
	operations: readonly ServiceOperationContract[],
): OpenApiDocument {
	const paths: Record<string, Readonly<Record<string, unknown>>> = { ...document.paths };
	for (const effective of operations) {
		const path = effective.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
		const pathItem = paths[path];
		if (pathItem === undefined) continue;
		const original = pathItem[effective.method];
		if (!isRecord(original)) continue;
		const operation: Record<string, unknown> = { ...original };
		const parameters = Array.isArray(operation.parameters) ? [...operation.parameters] : [];
		const idempotency = effective.resiliency.find((policy) => policy.type === 'idempotency');
		if (
			idempotency?.type === 'idempotency' &&
			!parameters.some((entry) =>
				isRecord(entry) && entry.in === 'header' && typeof entry.name === 'string' &&
				entry.name.toLowerCase() === idempotency.header.toLowerCase()
			)
		) {
			parameters.push({
				in: 'header',
				name: idempotency.header,
				required: idempotency.required,
				description: 'Identifies one logical mutation so a safe retry can reuse its recorded outcome.',
				schema: { type: 'string', minLength: 1 },
			});
		}
		if (parameters.length > 0) operation.parameters = parameters;
		const responses = isRecord(operation.responses) ? { ...operation.responses } : {};
		const retryableStatuses = new Set<string>();
		if (effective.resiliency.some((policy) => policy.type === 'rate-limit')) retryableStatuses.add('429');
		if (effective.resiliency.some((policy) => policy.type === 'circuit-breaker' || policy.type === 'bulkhead')) {
			retryableStatuses.add('503');
		}
		for (const status of retryableStatuses) {
			const existing = responses[status];
			if (!isRecord(existing)) continue;
			responses[status] = {
				...existing,
				headers: {
					...(isRecord(existing.headers) ? existing.headers : {}),
					'Retry-After': {
						description: 'Seconds or an HTTP date after which the client may retry.',
						schema: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string' }] },
					},
				},
			};
		}
		operation.responses = responses;
		paths[path] = { ...pathItem, [effective.method]: operation };
	}
	return freezeOpenApi({ ...document, paths });
}

/**
 * Admit object-shaped OpenAPI sections before copying their fields; arrays and null are not path/response maps.
 *
 * @internal
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Project explicit caller security without reconstructing authentication from IDs. @internal */
function securityOpenApi(
	document: OpenApiDocument,
	operations: readonly ServiceOperationContract[],
	security: ServiceOpenApiSecurity | undefined,
): OpenApiDocument {
	const paths: Record<string, Readonly<Record<string, unknown>>> = { ...document.paths };
	for (const effective of operations) {
		const path = effective.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
		const pathItem = paths[path];
		if (pathItem === undefined) continue;
		const original = pathItem[effective.method];
		if (!isRecord(original)) continue;
		const operation: Record<string, unknown> = { ...original };
		const activeRequirements = requirement.document(effective.requirements);
		if (activeRequirements.length > 0) operation['x-kaiju-requirements'] = activeRequirements;
		const projected = security?.operation(effective);
		if (projected !== undefined) operation.security = projected;
		paths[path] = { ...pathItem, [effective.method]: operation };
	}

	return freezeOpenApi({
		...document,
		paths,
		...(security === undefined || Object.keys(security.schemes).length === 0
			? {}
			: { components: { ...(document.components ?? {}), securitySchemes: security.schemes } }),
	});
}
