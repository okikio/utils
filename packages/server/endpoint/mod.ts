/**
 * Describe a route from input and response contracts before a handler or provider starts.
 *
 * Bind the exact Health definition with endpoint.handler(), then compile its service. Domain schemas remain authoritative for coercion and validation; endpoint wire projections describe what clients actually send.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as endpoint from '@okikio/server/endpoint';
 * import * as response from '@okikio/http/response';
 * import * as service from '@okikio/server/service';
 * import { z } from 'zod';
 * const Healthy = response.ok(z.object({ ok: z.boolean() }), { id: 'health.ok', description: 'Service health.' });
 * const Health = endpoint.get({ id: 'health.read', path: '/health', responses: [Healthy] });
 * const Api = service.define({ id: 'health-api', path: '/api', endpoints: [Health] });
 * console.log(Health.path, Api.path);
 * ```
 *
 * @module
 */
export {
	compose,
	define,
	del as delete,
	document,
	get,
	group,
	head,
	input,
	isInput,
	match,
	operation,
	options,
	patch,
	post,
	put,
	schemaOf,
	select,
	validate,
} from './definition.ts';
export { handler, handlers } from './handler.ts';
export { joinPath, normalizePathTemplate, pathParameters } from './path.ts';
export type {
	AnyEndpointHandler,
	AnyEndpointHandlerBinding,
	EmptyEndpointHost,
	EndpointCompositionInput,
	EndpointContext,
	EndpointContributions,
	EndpointDefinition,
	EndpointDefinitionInput,
	EndpointDocument,
	EndpointDocumentation,
	EndpointEntry,
	EndpointExample,
	EndpointGroup,
	EndpointGroupInput,
	EndpointGroupMembers,
	EndpointGroupSelection,
	EndpointHandler,
	EndpointHandlerBinding,
	EndpointHandlerContext,
	EndpointHandlerResult,
	EndpointHandlerSet,
	EndpointInput,
	EndpointInputSchema,
	EndpointInputSlot,
	EndpointInputSlots,
	EndpointInputSource,
	EndpointMethod,
	EndpointOperation,
	EndpointOperationDocument,
	EndpointOperationInput,
	EndpointRequestValues,
	EndpointResourceDefinition,
	EndpointResourceResolver,
	EndpointResources,
	EndpointResourceValue,
	EndpointRuntimeInputValues,
	EndpointSchema,
	EndpointValidationIssue,
	EndpointValidationResult,
	ErasedEndpointHandlerContext,
	InferEndpointInputs,
	InferEndpointWireInputs,
	MergeEndpointInputs,
	PickEndpointInputSlots,
	SingleMethodEndpointInput,
} from './types.ts';

export { openapi } from './openapi.ts';
export type {
	OpenApiDocument,
	OpenApiOptions,
	OpenApiSchemaProjectionContext,
	OpenApiSchemaProjector,
	OpenApiServer,
} from './openapi.ts';
