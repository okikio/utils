import { joinPath, pathParameters } from './path.ts';
import * as catalog from '@okikio/collection/catalog';
import * as record from '@okikio/collection/record';
import * as codec from '@okikio/schema/codec';
import { freeze as freezeOpenApi } from '../openapi/value.ts';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { ProblemDefinition } from '@okikio/http/problem';
import type { ResponseDefinition, ResponseExample } from '@okikio/http/response';
import { mediaType } from '@okikio/http/response';

import { schemaOf, validate } from './definition.ts';
import type {
	EndpointCompositionInput,
	EndpointDefinition,
	EndpointEntry,
	EndpointExample,
	EndpointGroup,
	EndpointInputSlot,
	EndpointInputSource,
	EndpointOperation,
} from './types.ts';

/** OpenAPI document versions that this projector can emit. */
export type OpenApiSpecVersion = '3.1.0' | '3.1.1' | '3.1.2' | '3.2.0';

/** Context supplied when OpenAPI needs a schema-library-specific projection. */
export interface OpenApiSchemaProjectionContext {
	/** Whether this schema projection describes request input or response output. */
	readonly purpose: 'request' | 'response';
	/** OpenAPI document version selected by the projection owner. */
	readonly specVersion: OpenApiSpecVersion;
	/** JSON Schema draft requested from this schema-library adapter. */
	readonly target: 'draft-2020-12';
}

/** Optional adapter used when a Standard Schema does not expose Standard JSON Schema directly. */
export type OpenApiSchemaProjector = (
	schema: StandardSchemaV1,
	context: OpenApiSchemaProjectionContext,
) => unknown | undefined | Promise<unknown | undefined>;

/** One server origin advertised by an OpenAPI document. */
export interface OpenApiServer {
	/** Explicit URL used by this contract; transport owners validate origins separately. */
	readonly url: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
}

/** One host-authored authentication scheme; validated at the portable artifact boundary. */
export type OpenApiSecurityScheme = Readonly<Record<string, unknown>>;
/** Schemes in one object are required together; separate objects are alternatives. */
export type OpenApiSecurityRequirement = Readonly<Record<string, readonly string[]>>;
/** Reusable owner components, grouped by the OpenAPI component category. */
export interface OpenApiComponents {
	/** Named groups such as schemas, responses and parameters. */
	readonly [group: string]: Readonly<Record<string, unknown>> | undefined;
	/** Host-authored authentication mechanisms referenced by operations. */
	readonly securitySchemes?: Readonly<Record<string, OpenApiSecurityScheme>>;
}

/** OpenAPI 3.1 document generated from one endpoint composition. */
export interface OpenApiDocument {
	/** Reusable local components. All references are data, never network fetches. */
	readonly components?: OpenApiComponents;
	/** OpenAPI document version emitted by this projection. */
	readonly openapi: OpenApiSpecVersion;
	/** API title, application version and description for generated clients and references. */
	readonly info: Readonly<{
		readonly title: string;
		readonly version: string;
		readonly description?: string;
	}>;
	/** Projected endpoint paths and method-operation descriptions. */
	readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	/** Advertised server origins; this projection does not open connections. */
	readonly servers?: readonly OpenApiServer[];
}

/** Options for the endpoint-only OpenAPI projection. */
export interface OpenApiOptions {
	/** API title shown in generated references. */
	readonly title: string;
	/** Application API version shown in generated references. */
	readonly version: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
	/** Include internal operations in this explicitly requested documentation projection. */
	readonly includeInternal?: boolean;
	/** OpenAPI document version. Defaults to 3.1.2. Selecting 3.2.0 does not synthesize features that only exist in 3.2. */
	readonly specVersion?: OpenApiSpecVersion;
	/** Controls whether a configured projector is a fallback or replaces the validator's Standard JSON Schema projection. */
	readonly schemaProjectorMode?: 'fallback' | 'override';
	/** Server origins advertised to generated clients and API reference tooling. */
	readonly servers?: readonly OpenApiServer[];
	/** Optional projection for validators that do not expose Standard JSON Schema directly. */
	readonly schemaProjector?: OpenApiSchemaProjector;
}

/** Fully normalized options used by the OpenAPI projection after validation. */
type NormalizedOpenApiOptions =
	& Omit<OpenApiOptions, 'specVersion'>
	& Readonly<{
		readonly specVersion: OpenApiSpecVersion;
	}>;

interface EndpointVisit {
	readonly endpoint: EndpointDefinition;
	readonly path: string;
	readonly groups: readonly EndpointGroup[];
}

/**
 * Generate an endpoint-only OpenAPI document from the exact imported graph.
 *
 * Service-level authentication schemes, servers, and compiler-generated
 * failures are added after effective-operation resolution by `service.openapi`.
 */
export async function openapi(
	input: EndpointCompositionInput,
	options: OpenApiOptions,
): Promise<OpenApiDocument> {
	const normalizedOptions = normalizeOptions(options);
	const validation = validate(input);
	if (!validation.valid) {
		throw new TypeError(
			`Cannot project invalid endpoint definitions:\n${
				validation.issues.map((issue) => `- ${issue.message}`).join('\n')
			}`,
		);
	}

	const paths: Record<string, Record<string, unknown>> = Object.create(null);
	for (const visit of walk(input)) {
		const path = openApiPath(visit.path);
		const pathItem = paths[path] ??= Object.create(null) as Record<string, unknown>;
		for (const operation of visit.endpoint.operations) {
			const internal = isInternal(visit.groups, visit.endpoint, operation);
			if (internal && !normalizedOptions.includeInternal) continue;
			if (pathItem[operation.method] !== undefined) {
				throw new TypeError(
					`OpenAPI path ${operation.method.toUpperCase()} ${path} is declared more than once.`,
				);
			}
			pathItem[operation.method] = await operationObject(visit, operation, internal, normalizedOptions);
		}
	}

	return freezeOpenApi({
		openapi: normalizedOptions.specVersion,
		info: {
			title: normalizedOptions.title,
			version: normalizedOptions.version,
			...(normalizedOptions.description !== undefined ? { description: normalizedOptions.description } : {}),
		},
		paths,
		...(normalizedOptions.servers !== undefined
			? { servers: Object.freeze(normalizedOptions.servers.map((server) => freezeOpenApi({ ...server }))) }
			: {}),
	});
}

/**
 * Project one operation's effective input slots and declared output descriptions.
 * Operation input overrides endpoint input. Tags combine group, endpoint and
 * operation metadata; runtime middleware is not invoked.
 *
 * @internal
 */
async function operationObject(
	visit: EndpointVisit,
	operation: EndpointOperation,
	internal: boolean,
	options: OpenApiOptions,
): Promise<Readonly<Record<string, unknown>>> {
	const parameters: unknown[] = [];
	let requestBody: unknown;
	for (
		const source of [
			'param',
			'query',
			'header',
			'cookie',
			'json',
			'form',
			'raw',
		] as const satisfies readonly EndpointInputSource[]
	) {
		const slot = operation.inputs[source] ?? visit.endpoint.inputs[source];
		if (!slot) continue;
		const schema = await projectSchema(slot, internal, options);
		if (source === 'json' || source === 'form' || source === 'raw') {
			requestBody = requestBodyObject(source, slot, schema);
			continue;
		}
		parameters.push(...parameterObjects(source, slot, schema, visit.path));
	}

	const responses = await responseObjects(
		operation,
		problemDefinitions(visit.groups, visit.endpoint, operation),
		internal,
		options,
	);
	const tags = uniqueStrings([
		...visit.groups.flatMap((group) => group.tags ?? []),
		...(visit.endpoint.tags ?? []),
		...(operation.tags ?? []),
	]);

	return freezeOpenApi({
		operationId: operation.operationId,
		...(operation.summary !== undefined ? { summary: operation.summary } : {}),
		...(operation.description !== undefined ? { description: operation.description } : {}),
		...(tags.length > 0 ? { tags } : {}),
		...(operation.deprecated === true ? { deprecated: true } : {}),
		...(parameters.length > 0 ? { parameters } : {}),
		...(requestBody !== undefined ? { requestBody } : {}),
		responses,
	});
}

/**
 * Describe flat wire fields as OpenAPI parameters.
 * Path properties must match the template exactly. Repeated query arrays use
 * form/explode syntax; nested query objects reject because no parser is declared.
 *
 * @internal
 */
function parameterObjects(
	source: 'param' | 'query' | 'header' | 'cookie',
	slot: EndpointInputSlot,
	schema: unknown,
	path: string,
): readonly Readonly<Record<string, unknown>>[] {
	const object = asJsonObject(schema);
	const documentedInput = documented(slot);
	if (!object || !isRecord(object.properties)) {
		if (source === 'param') {
			throw new TypeError(`Path schema for ${path} must project an object with one property per route parameter.`);
		}
		return [freezeOpenApi({
			in: source,
			name: source,
			required: documentedInput?.required ?? false,
			schema,
			...(documentedInput?.description !== undefined ? { description: documentedInput.description } : {}),
			...examplesObject(documentedInput?.examples),
		})];
	}

	const properties = object.properties;
	const required = new Set(Array.isArray(object.required) ? object.required.filter(isString) : []);
	const pathNames = source === 'param' ? pathParameters(path) : [];
	if (source === 'param') {
		const projectedNames = Object.keys(properties);
		const missing = pathNames.filter((name) => !projectedNames.includes(name));
		const extra = projectedNames.filter((name) => !pathNames.includes(name));
		if (missing.length > 0 || extra.length > 0) {
			throw new TypeError(
				`Path parameter schema for ${path} does not match the route template ` +
					`(missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}).`,
			);
		}
	}

	return Object.freeze(
		Object.entries(properties).map(([name, property]) => {
			const nestedObject = asJsonObject(property)?.type === 'object';
			const nestedArray = asJsonObject(property)?.type === 'array';
			if (source === 'query' && nestedObject) {
				throw new TypeError(
					`Nested query parameter ${JSON.stringify(name)} has no declared wire serialization. ` +
						'Use a flat query schema or add an explicit transport parser before documenting deep-object syntax.',
				);
			}
			return freezeOpenApi({
				in: source === 'param' ? 'path' : source,
				name,
				required: source === 'param' || required.has(name),
				schema: property,
				...(documentedInput?.description !== undefined && Object.keys(properties).length === 1
					? { description: documentedInput.description }
					: {}),
				...(source === 'query' && nestedArray ? { style: 'form', explode: true } : {}),
			});
		}),
	);
}

/**
 * Describe the selected body mode and its authored media type.
 * Required defaults to true; this declaration does not parse a request body.
 *
 * @internal
 */
function requestBodyObject(
	source: 'json' | 'form' | 'raw',
	slot: EndpointInputSlot,
	schema: unknown,
): Readonly<Record<string, unknown>> {
	const input = documented(slot);
	const mediaType = input?.contentType ?? requestMedia(source);
	return freezeOpenApi({
		required: input?.required ?? true,
		...(input?.description !== undefined ? { description: input.description } : {}),
		content: {
			[mediaType]: {
				schema,
				...examplesObject(input?.examples),
			},
		},
	});
}

/**
 * Group success and public problem declarations under their HTTP status.
 * Multiple declarations at one status merge their media schemas. A raw operation
 * with no declarations receives an explicitly undocumented default response.
 *
 * @internal
 */
async function responseObjects(
	operation: EndpointOperation,
	problems: readonly ProblemDefinition[],
	internal: boolean,
	options: OpenApiOptions,
): Promise<Readonly<Record<string, unknown>>> {
	const byStatus = new Map<string, Readonly<Record<string, unknown>>[]>();
	for (const definition of definitionValues<ResponseDefinition>(operation.responses)) {
		appendStatus(byStatus, String(definition.status), await successResponseObject(definition, internal, options));
	}
	for (const definition of problems) {
		if (definition.exposure === 'internal' && !internal) continue;
		appendStatus(byStatus, String(definition.status), await problemResponseObject(definition, internal, options));
	}
	if (byStatus.size === 0) {
		if (!operation.rawResponse) {
			throw new TypeError(`Public operation ${operation.id} declares no response or problem definitions.`);
		}
		byStatus.set('default', [freezeOpenApi({ description: 'Undocumented raw response.' })]);
	}

	const result: Record<string, unknown> = Object.create(null);
	for (const [status, candidates] of byStatus) {
		result[status] = candidates.length === 1 ? candidates[0] : mergeResponses(candidates);
	}
	return freezeOpenApi(result);
}

/**
 * Describe response headers and the schema of the emitted wire body.
 * Codec output describes the wire direction; empty and redirect modes omit bodies.
 *
 * @internal
 */
async function successResponseObject(
	definition: ResponseDefinition,
	internal: boolean,
	options: OpenApiOptions,
): Promise<Readonly<Record<string, unknown>>> {
	const contentType = mediaType(definition) ?? 'application/json';
	const result: Record<string, unknown> = {
		description: definition.description,
	};
	if (definition.headers && Object.keys(definition.headers).length > 0) {
		result.headers = Object.fromEntries(
			Object.entries(definition.headers).map(([name, value]) => [
				name,
				freezeOpenApi({ schema: { type: 'string' }, example: value }),
			]),
		);
	}
	if (definition.schema !== undefined && definition.mode !== 'empty' && definition.mode !== 'redirect') {
		const projected = definition.jsonSchema !== undefined
			? freezeOpenApi(definition.jsonSchema)
			: await projectBareSchema(
				codec.is(definition.schema) ? codec.output(definition.schema) : definition.schema,
				internal,
				options,
				'response',
			);
		result.content = {
			[contentType]: {
				schema: responseBodySchema(definition, projected),
				...responseExamplesObject(definition.examples),
			},
		};
	}
	if (definition.mode === 'redirect') {
		result.headers = {
			...(isRecord(result.headers) ? result.headers : {}),
			Location: { schema: { type: 'string', format: 'uri-reference' } },
		};
	}
	return freezeOpenApi(result);
}

/**
 * Wrap the projected item schema in the response's actual envelope shape.
 * Page mode describes an array plus pagination metadata. This builds JSON Schema
 * data; it does not validate or materialize a response.
 *
 * @internal
 */
function responseBodySchema(definition: ResponseDefinition, schema: unknown): unknown {
	if (definition.mode === 'page') {
		const pagination = definition.pagination;
		return freezeOpenApi({
			type: 'object',
			required: ['data', 'meta'],
			properties: {
				data: { type: 'array', items: schema },
				meta: {
					type: 'object',
					required: ['pagination'],
					properties: {
						pagination: paginationMetadataSchema(
							pagination?.totals === 'body' || pagination?.totals === 'both',
						),
					},
					additionalProperties: true,
				},
				...((pagination?.links === 'body' || pagination?.links === 'both') ? { links: paginationLinksSchema() } : {}),
			},
			additionalProperties: false,
		});
	}
	if (definition.envelope === 'data' || definition.timestamp) {
		return freezeOpenApi({
			type: 'object',
			required: ['data'],
			properties: {
				data: schema,
				meta: {
					type: 'object',
					...(definition.timestamp ? { properties: { timestamp: { type: 'string', format: 'date-time' } } } : {}),
					additionalProperties: true,
				},
			},
			additionalProperties: false,
		});
	}
	return schema;
}

/**
 * Describe emitted page coordinates and optional totals as JSON Schema data.
 *
 * @internal
 */
function paginationMetadataSchema(includeTotals: boolean): Readonly<Record<string, unknown>> {
	return freezeOpenApi({
		type: 'object',
		required: ['kind', 'limit', 'hasMore'],
		properties: {
			kind: { type: 'string', enum: ['cursor', 'offset'] },
			limit: { type: 'integer', minimum: 1 },
			hasMore: { type: 'boolean' },
			cursor: { type: 'string' },
			offset: { type: 'integer', minimum: 0 },
			page: { type: 'integer', minimum: 1 },
			perPage: { type: 'integer', minimum: 1 },
			...(includeTotals
				? {
					total: { type: 'integer', minimum: 0 },
					approximateTotal: { type: 'integer', minimum: 0 },
					totalPages: { type: 'integer', minimum: 0 },
				}
				: {}),
			expiresAt: { type: 'string', format: 'date-time' },
		},
		additionalProperties: false,
	});
}

/**
 * Describe optional navigation relations as URI-reference strings.
 *
 * @internal
 */
function paginationLinksSchema(): Readonly<Record<string, unknown>> {
	const link = { type: 'string', format: 'uri-reference' };
	return freezeOpenApi({
		type: 'object',
		properties: { self: link, first: link, previous: link, next: link, last: link },
		additionalProperties: false,
	});
}

/**
 * Describe fixed RFC problem fields and optional extension properties.
 * Internal problems are filtered by the caller before this projection.
 *
 * @internal
 */
async function problemResponseObject(
	definition: ProblemDefinition,
	internal: boolean,
	options: OpenApiOptions,
): Promise<Readonly<Record<string, unknown>>> {
	const extensionSchema = definition.extensions === undefined
		? undefined
		: await projectBareSchema(definition.extensions.schema, internal, options, 'response');
	const extensionObject = asJsonObject(extensionSchema);
	const properties = {
		type: { type: 'string', const: definition.type, format: 'uri-reference' },
		title: { type: 'string', const: definition.title },
		status: { type: 'integer', const: definition.status },
		detail: { type: 'string' },
		instance: { type: 'string', format: 'uri-reference' },
		...(extensionObject && isRecord(extensionObject.properties) ? extensionObject.properties : {}),
	};
	return freezeOpenApi({
		description: definition.description,
		content: {
			'application/problem+json': {
				schema: {
					type: 'object',
					properties,
					required: ['type', 'title', 'status'],
					additionalProperties: extensionObject?.additionalProperties ?? true,
				},
				...problemExamplesObject(definition),
			},
		},
	});
}

/**
 * Merge declarations sharing a status into one OpenAPI response.
 * Shared media types use oneOf when several schemas remain; headers merge by
 * field name and later descriptions join earlier ones. Collisions do not reject.
 *
 * @internal
 */
function mergeResponses(
	responses: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
	const descriptions = uniqueStrings(responses.map((response) => String(response.description ?? '')).filter(Boolean));
	const media = new Map<string, unknown[]>();
	const headers: Record<string, unknown> = Object.create(null);
	for (const response of responses) {
		if (isRecord(response.headers)) Object.assign(headers, response.headers);
		if (!isRecord(response.content)) continue;
		for (const [contentType, value] of Object.entries(response.content)) {
			if (!isRecord(value)) continue;
			const schemas = media.get(contentType) ?? [];
			if (value.schema !== undefined) schemas.push(value.schema);
			media.set(contentType, schemas);
		}
	}
	const content: Record<string, unknown> = Object.create(null);
	for (const [contentType, schemas] of media) {
		content[contentType] = {
			schema: schemas.length === 1 ? schemas[0] : { oneOf: schemas },
		};
	}
	return freezeOpenApi({
		description: descriptions.join(' / ') || 'Response.',
		...(Object.keys(headers).length > 0 ? { headers } : {}),
		...(Object.keys(content).length > 0 ? { content } : {}),
	});
}

/**
 * Collect another declaration under its status; responseObjects() merges them later.
 *
 * @internal
 */
function appendStatus(
	byStatus: Map<string, Readonly<Record<string, unknown>>[]>,
	status: string,
	value: Readonly<Record<string, unknown>>,
): void {
	const values = byStatus.get(status) ?? [];
	values.push(value);
	byStatus.set(status, values);
}

/**
 * Prefer an explicit request JSON Schema override; otherwise project its validator.
 *
 * @internal
 */
async function projectSchema(
	slot: EndpointInputSlot,
	internal: boolean,
	options: OpenApiOptions,
): Promise<unknown> {
	const input = documented(slot);
	if (input?.jsonSchema !== undefined) return freezeOpenApi(input.jsonSchema);
	const schema = schemaOf(slot);
	return await projectBareSchema(schema, internal, options, 'request');
}

/** Project Standard JSON Schema in the correct wire direction, with explicit mapper precedence. */
async function projectBareSchema(
	schema: StandardSchemaV1,
	internal: boolean,
	options: OpenApiOptions,
	purpose: OpenApiSchemaProjectionContext['purpose'],
): Promise<unknown> {
	const target = 'draft-2020-12' as const;
	const context: OpenApiSchemaProjectionContext = { purpose, specVersion: options.specVersion ?? '3.1.2', target };
	if (options.schemaProjectorMode === 'override') {
		const projected = await options.schemaProjector?.(schema, context);
		if (projected !== undefined) return freezeOpenApi(projected);
	}
	const standard = schema as StandardSchemaV1 & Partial<StandardJSONSchemaV1>;
	const converter = standard['~standard'].jsonSchema;
	if (converter !== undefined) {
		try {
			return freezeOpenApi(purpose === 'request' ? converter.input({ target }) : converter.output({ target }));
		} catch (error) {
			if (options.schemaProjector === undefined) {
				if (internal) return freezeOpenApi({});
				throw new TypeError('Public endpoint schema could not be projected through Standard JSON Schema.', {
					cause: error,
				});
			}
		}
	}
	const projected = await options.schemaProjector?.(schema, context);
	if (projected !== undefined) return freezeOpenApi(projected);
	if (internal) return freezeOpenApi({});
	throw new TypeError('Public endpoint schema has no Standard JSON Schema projection or configured projector.');
}

/**
 * Collect group, endpoint and operation problems, retaining unique imported identities.
 *
 * @internal
 */
function problemDefinitions(
	groups: readonly EndpointGroup[],
	endpoint: EndpointDefinition,
	operation: EndpointOperation,
): readonly ProblemDefinition[] {
	return uniqueDefinitions([
		...groups.flatMap((group) => definitionValues<ProblemDefinition>(group.problems)),
		...definitionValues<ProblemDefinition>(endpoint.problems),
		...definitionValues<ProblemDefinition>(operation.problems),
	]);
}

/**
 * Expand a catalog composition, or return no definitions for an absent contribution.
 *
 * @internal
 */
function definitionValues<Entry extends { readonly id: string; readonly kind: string }>(
	input: unknown,
): readonly Entry[] {
	if (input === undefined) return Object.freeze([]);
	return catalog.values(input as Parameters<typeof catalog.values<Entry>>[0]);
}

/**
 * Collect endpoint leaves with their effective group paths and metadata.
 * Selections retain only chosen members; they do not reapply the source group.
 *
 * @internal
 */
function walk(input: EndpointCompositionInput): readonly EndpointVisit[] {
	const result: EndpointVisit[] = [];
	/** Carry path/policy ancestry only when entering a real group. */
	const visit = (
		value: EndpointCompositionInput,
		prefix: string,
		groups: readonly EndpointGroup[],
	): void => {
		for (const entry of flatten(value)) {
			if (entry.kind === 'endpoint') {
				result.push(Object.freeze({ endpoint: entry, path: joinPath(prefix, entry.path), groups }));
				continue;
			}
			if (entry.kind === 'endpoint-group-selection') {
				visit(entry.endpoints, prefix, groups);
				continue;
			}
			visit(entry.endpoints, joinPath(prefix, entry.path), Object.freeze([...groups, entry]));
		}
	};
	visit(input, '', Object.freeze([]));
	return Object.freeze(result);
}

/**
 * Flatten nested composition arrays in order, leaving definition objects intact.
 *
 * @internal
 */
function flatten(input: EndpointCompositionInput): readonly EndpointEntry[] {
	return Array.isArray(input)
		? Object.freeze(input.flatMap((entry) => flatten(entry)))
		: Object.freeze([input as EndpointEntry]);
}

/**
 * Treat an operation as internal when it or any enclosing endpoint/group says so.
 *
 * @internal
 */
function isInternal(
	groups: readonly EndpointGroup[],
	endpoint: EndpointDefinition,
	operation: EndpointOperation,
): boolean {
	return groups.some((group) => group.internal === true) ||
		endpoint.internal === true ||
		operation.internal === true;
}

/**
 * Read explicit endpoint.input() metadata when a slot wraps a schema.
 * A bare validator supplies no transport examples or media-type overrides.
 *
 * @internal
 */
function documented(slot: EndpointInputSlot) {
	return typeof slot === 'object' && slot !== null && (slot as { kind?: unknown }).kind === 'endpoint-input'
		? slot as Extract<EndpointInputSlot, { kind: 'endpoint-input' }>
		: undefined;
}

/**
 * Index authored input examples by key for OpenAPI output.
 *
 * @internal
 */
function examplesObject(examples: readonly EndpointExample[] | undefined): Readonly<Record<string, unknown>> {
	if (!examples || examples.length === 0) return Object.freeze({});
	return freezeOpenApi({
		examples: Object.fromEntries(examples.map((example) => [example.key, {
			...(example.summary !== undefined ? { summary: example.summary } : {}),
			...(example.description !== undefined ? { description: example.description } : {}),
			value: example.value,
		}])),
	});
}

/**
 * Index authored successful-response examples by key for OpenAPI output.
 *
 * @internal
 */
function responseExamplesObject(examples: readonly ResponseExample[] | undefined): Readonly<Record<string, unknown>> {
	if (!examples || examples.length === 0) return Object.freeze({});
	return freezeOpenApi({
		examples: Object.fromEntries(examples.map((example) => [example.key, {
			...(example.summary !== undefined ? { summary: example.summary } : {}),
			...(example.description !== undefined ? { description: example.description } : {}),
			value: example.value,
		}])),
	});
}

/**
 * Combine each authored example with its problem's standard fields.
 * Example values remain author-controlled and are frozen by the output boundary.
 *
 * @internal
 */
function problemExamplesObject(definition: ProblemDefinition): Readonly<Record<string, unknown>> {
	if (!definition.examples || definition.examples.length === 0) return Object.freeze({});
	return freezeOpenApi({
		examples: Object.fromEntries(definition.examples.map((example) => [example.key, {
			...(example.summary !== undefined ? { summary: example.summary } : {}),
			value: {
				type: definition.type,
				title: definition.title,
				status: definition.status,
				...example.value,
			},
		}])),
	});
}

/**
 * Choose the default documented media type for JSON, form or raw body input.
 *
 * @internal
 */
function requestMedia(source: 'json' | 'form' | 'raw'): string {
	if (source === 'json') return 'application/json';
	if (source === 'form') return 'application/x-www-form-urlencoded';
	return 'application/octet-stream';
}

/** Normalize OpenAPI options before projection can observe caller mutation or accessors. @internal */
function normalizeOptions(options: OpenApiOptions): NormalizedOpenApiOptions {
	record.assert(options, 'OpenAPI options');
	if (typeof options.title !== 'string' || options.title.length === 0) {
		throw new TypeError('OpenAPI title must be a non-empty string.');
	}
	if (typeof options.version !== 'string' || options.version.length === 0) {
		throw new TypeError('OpenAPI version must be a non-empty string.');
	}
	if (options.description !== undefined && typeof options.description !== 'string') {
		throw new TypeError('OpenAPI description must be a string.');
	}
	if (options.includeInternal !== undefined && typeof options.includeInternal !== 'boolean') {
		throw new TypeError('includeInternal must be a boolean.');
	}
	if (options.schemaProjector !== undefined && typeof options.schemaProjector !== 'function') {
		throw new TypeError('schemaProjector must be a function.');
	}
	const specVersion = options.specVersion ?? '3.1.2';
	if (!['3.1.0', '3.1.1', '3.1.2', '3.2.0'].includes(specVersion)) {
		throw new TypeError('Unsupported OpenAPI specVersion.');
	}
	if (
		options.schemaProjectorMode !== undefined && options.schemaProjectorMode !== 'fallback' &&
		options.schemaProjectorMode !== 'override'
	) throw new TypeError('schemaProjectorMode must be fallback or override.');
	const servers = options.servers === undefined ? undefined : normalizeServers(options.servers);
	return Object.freeze(
		{
			title: options.title,
			version: options.version,
			specVersion,
			...(options.description !== undefined ? { description: options.description } : {}),
			...(options.includeInternal !== undefined ? { includeInternal: options.includeInternal } : {}),
			...(servers !== undefined ? { servers } : {}),
			...(options.schemaProjector !== undefined ? { schemaProjector: options.schemaProjector } : {}),
			...(options.schemaProjectorMode !== undefined ? { schemaProjectorMode: options.schemaProjectorMode } : {}),
		} satisfies NormalizedOpenApiOptions,
	);
}

/** Snapshot advertised servers as inert OpenAPI data. @internal */
function normalizeServers(servers: readonly OpenApiServer[]): readonly OpenApiServer[] {
	if (!Array.isArray(servers)) throw new TypeError('OpenAPI servers must be an array.');
	const result: OpenApiServer[] = [];
	for (const server of servers) {
		record.assert(server, 'OpenAPI server');
		if (typeof server.url !== 'string' || server.url.length === 0) {
			throw new TypeError('OpenAPI server URL must be a non-empty string.');
		}
		if (server.description !== undefined && typeof server.description !== 'string') {
			throw new TypeError('OpenAPI server description must be a string.');
		}
		result.push(
			Object.freeze({
				url: server.url,
				...(server.description !== undefined ? { description: server.description } : {}),
			}),
		);
	}
	return Object.freeze(result);
}

/**
 * Replace :name route tokens with OpenAPI {name} parameter notation.
 *
 * @internal
 */
function openApiPath(path: string): string {
	return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Return non-array object candidates for JSON Schema property inspection.
 *
 * @internal
 */
function asJsonObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return isRecord(value) ? value : undefined;
}

/**
 * Recognize non-null object candidates, excluding arrays; this is not full data validation.
 *
 * @internal
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrow a schema required-list element to a string.
 *
 * @internal
 */
function isString(value: unknown): value is string {
	return typeof value === 'string';
}

/**
 * Remove repeated string values while preserving their first occurrence.
 *
 * @internal
 */
function uniqueStrings(values: readonly string[]): readonly string[] {
	return Object.freeze([...new Set(values)]);
}

/**
 * Deduplicate exact definition objects and reject different objects claiming one ID.
 *
 * @internal
 */
function uniqueDefinitions<Entry extends { readonly id: string }>(values: readonly Entry[]): readonly Entry[] {
	const result: Entry[] = [];
	const owners = new Map<string, Entry>();
	const seen = new Set<Entry>();
	for (const value of values) {
		const owner = owners.get(value.id);
		if (owner && owner !== value) {
			throw new TypeError(`Definition ID ${JSON.stringify(value.id)} belongs to different objects.`);
		}
		owners.set(value.id, value);
		if (!seen.has(value)) {
			seen.add(value);
			result.push(value);
		}
	}
	return Object.freeze(result);
}
