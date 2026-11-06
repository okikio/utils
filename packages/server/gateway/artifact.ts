import { Temporal } from '@okikio/duration/temporal';
import { elapsed } from '@okikio/duration';
import * as catalog from '@okikio/collection/catalog';
import type { CatalogEntryIdentity, DefinitionInput } from '@okikio/collection/catalog';
import type { EndpointMethod } from '../endpoint/types.ts';
import type { OpenApiDocument, OpenApiSecurityScheme } from '../endpoint/openapi.ts';
import { normalizePathTemplate } from '../endpoint/path.ts';
import { normalizeOrigin } from './_origin.ts';
import type { GatewayCachePolicy, GatewayCredentialPolicy, GatewayOrigin, GatewayRedirectPolicy } from './types.ts';

/** The owner-normalized routing portion of a serialized service contract. */
export interface GatewayArtifactRoute {
	/** Stable service route ID; admission uses this exact value. */
	readonly id: string;
	/** Uppercase HTTP method projected by the service owner. */
	readonly method: Uppercase<EndpointMethod>;
	/** Canonical service template with colon-prefixed parameter names. */
	readonly path: string;
	/** Owner's stable operation identifier. */
	readonly operationId: string;
	/** Owner's stable endpoint identifier. */
	readonly endpointId: string;
	/** Foreign authentication IDs that require explicit host bindings. */
	readonly authentication: readonly string[];
}

/** Minimal serialized manifest envelope; domain schemas remain in the owner document. */
export interface GatewayArtifactManifest {
	/** Owner service identity, also used to namespace reusable components. */
	readonly id: string;
	/** Canonical service prefix. */
	readonly path: string;
	/** All owner-projected routes, before the host's explicit admission. */
	readonly routes: readonly GatewayArtifactRoute[];
}

/** Host-owned caller scheme replacing one downstream documentation scheme. */
export interface GatewayArtifactSecurityMapping {
	/** Caller-facing scheme name; never inferred from a foreign authentication ID. */
	readonly name: string;
	/** Actual caller authentication mechanism declared by the composition root. */
	readonly scheme: OpenApiSecurityScheme;
}

/** Additive host transport controls for all explicitly admitted artifact routes. */
export interface GatewayArtifactPolicy {
	/** Extra host assertions, enforced by the existing gateway assertion adapter. */
	readonly assertion?: DefinitionInput<CatalogEntryIdentity>;
	/** Deadline for the forwarded request and response body lifetime. */
	readonly timeout?: Temporal.Duration;
	/** Maximum accepted request body bytes. */
	readonly bodyLimit?: number;
	/** Explicit response caching treatment. */
	readonly cache?: GatewayCachePolicy;
	/** Explicit treatment of reusable caller credentials and response cookies. */
	readonly credentials?: GatewayCredentialPolicy;
	/** Explicit upstream redirect treatment. */
	readonly redirects?: GatewayRedirectPolicy;
}

/** Host admission and security bindings for portable owner artifacts. */
export interface MountGatewayArtifactOptions extends GatewayArtifactPolicy {
	/** Host-resolved upstream origin; no document server is used for forwarding. */
	readonly origin: GatewayOrigin;
	/** Exact admitted route IDs. Neither a manifest nor a document proves public visibility. */
	readonly routes: readonly string[];
	/** Every admitted foreign authentication ID must bind to nonempty host definitions. */
	readonly authentication: Readonly<Record<string, DefinitionInput<CatalogEntryIdentity>>>;
	/** Explicit downstream scheme-name to caller scheme mapping, including an empty mapping for public operations. */
	readonly security: Readonly<Record<string, GatewayArtifactSecurityMapping>>;
}

/** Validated immutable data contract mounted independently of any live Definition catalog. */
export interface GatewayArtifactMount {
	/** Distinct mount discriminator; this value never impersonates a local service definition. */
	readonly kind: 'gateway-artifact-mount';
	/** Copied owner routing manifest. */
	readonly manifest: GatewayArtifactManifest;
	/** Copied, reference-qualified owner document with only explicitly admitted paths. */
	readonly document: OpenApiDocument;
	/** Host-resolved origin used by the existing forwarding runtime. */
	readonly origin: string;
	/** Admitted owner routes in original manifest order. */
	readonly routes: readonly GatewayArtifactRoute[];
	/** Host definition identities retained without serialization or reconstruction. */
	readonly authentication: Readonly<Record<string, readonly CatalogEntryIdentity[]>>;
	/** Validated additive transport policy. */
	readonly policy: GatewayArtifactPolicy;
}

const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const mounts = new WeakSet<object>();

/** Only this package's checked, snapshotted artifacts may supply routing authority. @internal */
export function isArtifactMount(value: unknown): value is GatewayArtifactMount {
	return typeof value === 'object' && value !== null && mounts.has(value);
}

/**
 * Admit portable owner-projected artifacts without importing or casting foreign
 * catalogs. Inputs are snapshotted before validation; private visibility, auth,
 * upstream location and caller credential choices remain host-owned decisions.
 */
export function mountArtifact(
	input: Readonly<{ readonly manifest: unknown; readonly document: unknown }>,
	options: MountGatewayArtifactOptions,
): GatewayArtifactMount {
	const manifest = data(input.manifest);
	const document = data(input.document);
	if (!isRecord(manifest) || !identifier(manifest.id) || !template(manifest.path) || !Array.isArray(manifest.routes)) {
		throw new TypeError('Artifact requires a canonical owner manifest.');
	}
	if (
		!isRecord(document) || !['3.1.0', '3.1.1', '3.1.2', '3.2.0'].includes(String(document.openapi)) ||
		!isRecord(document.info) ||
		typeof document.info.title !== 'string' || !document.info.title.trim() ||
		typeof document.info.version !== 'string' || !document.info.version.trim() || !isRecord(document.paths)
	) {
		throw new TypeError('Artifact requires an OpenAPI 3.1 owner document.');
	}
	assertDefinitionOnly(manifest);
	assertReferences(document);
	const routes: GatewayArtifactRoute[] = [];
	const ids = new Set<string>();
	const operations = new Set<string>();
	const templates = new Map<string, string>();
	const keys = new Set<string>();
	for (const value of manifest.routes) {
		if (
			!isRecord(value) || !identifier(value.id) || !identifier(value.endpointId) || !identifier(value.operationId) ||
			!template(value.path) || typeof value.method !== 'string' || !methods.has(value.method) ||
			!strings(value.authentication) || !value.authentication.every(identifier)
		) throw new TypeError('Artifact manifest contains a malformed route.');
		assertDefinitionOnly(value);
		if (value.path !== manifest.path && !value.path.startsWith(`${manifest.path === '/' ? '' : manifest.path}/`)) {
			throw new TypeError('Artifact route is outside its service prefix.');
		}
		const key = `${value.method} ${normalizePathTemplate(value.path)}`;
		const shape = normalizePathTemplate(value.path);
		if (ids.has(value.id) || operations.has(value.operationId) || keys.has(key)) {
			throw new TypeError('Artifact contains duplicate route or operation identities.');
		}
		if (templates.has(shape) && templates.get(shape) !== value.path) {
			throw new TypeError('Artifact path templates disagree on parameter names.');
		}
		ids.add(value.id);
		operations.add(value.operationId);
		keys.add(key);
		templates.set(shape, value.path);
		const path = openApiPath(value.path);
		const item = document.paths[path];
		const operation = isRecord(item) ? item[value.method.toLowerCase()] : undefined;
		if (!isRecord(operation) || operation.operationId !== value.operationId || !isRecord(operation.responses)) {
			throw new TypeError(`Artifact manifest/document drift for ${value.id}.`);
		}
		assertParameters(value.path, item, operation, document);
		routes.push(value as unknown as GatewayArtifactRoute);
	}
	let count = 0;
	for (const [path, item] of Object.entries(document.paths)) {
		if (!isRecord(item) || '$ref' in item) throw new TypeError('Artifact path items must be explicit owner data.');
		for (const method of Object.keys(item)) {
			if (!methods.has(method.toUpperCase())) {
				if (!['summary', 'description', 'parameters', 'servers'].includes(method) && !method.startsWith('x-')) {
					throw new TypeError(`Unsupported artifact path field ${JSON.stringify(method)}.`);
				}
				continue;
			}
			count++;
			if (!routes.some((route) => openApiPath(route.path) === path && route.method.toLowerCase() === method)) {
				throw new TypeError('Artifact document contains an operation absent from its manifest.');
			}
		}
	}
	if (count !== routes.length) throw new TypeError('Artifact manifest/document route counts disagree.');
	if (!strings(options.routes) || options.routes.length === 0) {
		throw new TypeError('Artifact admission requires a nonempty unique route-ID allowlist.');
	}
	for (const id of options.routes) {
		if (!ids.has(id)) throw new TypeError(`Unknown admitted artifact route ${JSON.stringify(id)}.`);
	}
	const admitted = routes.filter((route) => options.routes.includes(route.id));
	const required = new Set(admitted.flatMap((route) => route.authentication));
	const authentication: Record<string, readonly CatalogEntryIdentity[]> = Object.create(null);
	for (const id of required) {
		if (!Object.hasOwn(options.authentication, id)) {
			throw new TypeError(`Missing host authentication binding for ${JSON.stringify(id)}.`);
		}
		const definitions = catalog.values(options.authentication[id]!);
		if (definitions.length === 0) throw new TypeError(`Empty host authentication binding for ${JSON.stringify(id)}.`);
		authentication[id] = Object.freeze([...definitions]);
	}
	for (const id of Object.keys(options.authentication)) {
		if (!required.has(id)) throw new TypeError(`Unknown host authentication binding ${JSON.stringify(id)}.`);
	}
	const projected = project(document, manifest.id, admitted, options.security);
	const mount: GatewayArtifactMount = Object.freeze({
		kind: 'gateway-artifact-mount',
		manifest: manifest as unknown as GatewayArtifactManifest,
		document: projected,
		origin: normalizeOrigin(options.origin),
		routes: Object.freeze(admitted),
		authentication: Object.freeze(authentication),
		policy: artifactPolicy(options),
	});
	mounts.add(mount);
	return mount;
}

/** Reject dangling or remote JSON pointers rather than load another authority. @internal */
export function assertReferences(document: unknown): void {
	visit(document, (record) => {
		if ('$id' in record) throw new TypeError('Artifact schema $id scopes require owner inlining before composition.');
		for (const keyword of ['$dynamicRef', '$recursiveRef']) {
			if (keyword in record) {
				throw new TypeError(`Artifact ${keyword} is unsupported; owner must qualify static references.`);
			}
		}
		if ('$ref' in record) resolve(document, record.$ref);
	});
}

/**
 * Snapshot own enumerable JSON data without invoking accessors. Reject cycles and excessive nesting;
 * repeated aliases are copied. This does not bound total nodes or prevent Proxy descriptor traps.
 */
function data(value: unknown, ancestors = new Set<object>(), depth = 0): unknown {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'object' || depth > 128 || ancestors.has(value)) {
		throw new TypeError('Artifact must contain finite acyclic JSON data.');
	}
	if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Artifact JSON cannot contain symbols.');
	if (
		!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null
	) throw new TypeError('Artifact must contain plain records.');
	ancestors.add(value);
	try {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const output: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : Object.create(null);
		for (const [key, descriptor] of Object.entries(descriptors)) {
			if (Array.isArray(value) && key === 'length') continue;
			if (!('value' in descriptor) || !descriptor.enumerable) {
				throw new TypeError('Artifact must use enumerable data properties.');
			}
			if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) {
				throw new TypeError('Artifact arrays must use index properties.');
			}
			Object.defineProperty(output, key, { value: data(descriptor.value, ancestors, depth + 1), enumerable: true });
		}
		if (Array.isArray(value) && Object.keys(output).length !== value.length) {
			throw new TypeError('Artifact arrays must be dense.');
		}
		return Object.freeze(output);
	} finally {
		ancestors.delete(value);
	}
}

/** Assert exact declared path parameters, including path-item inheritance. */
function assertParameters(
	path: string,
	item: unknown,
	operation: Readonly<Record<string, unknown>>,
	document: unknown,
): void {
	const expected = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!);
	const names = new Set<string>();
	const parameters = [
		...(isRecord(item) && Array.isArray(item.parameters) ? item.parameters : []),
		...(Array.isArray(operation.parameters) ? operation.parameters : []),
	];
	for (const input of parameters) {
		const parameter = isRecord(input) && '$ref' in input ? resolve(document, input.$ref) : input;
		if (!isRecord(parameter)) throw new TypeError('Artifact parameters must be records.');
		if (parameter.in !== 'path') continue;
		if (typeof parameter.name !== 'string' || parameter.required !== true || !expected.includes(parameter.name)) {
			throw new TypeError('Artifact path parameter declaration drifts from its route.');
		}
		names.add(parameter.name);
	}
	if (names.size !== expected.length) throw new TypeError('Artifact omits a required route parameter.');
}

/** Copy admitted operations, qualify component namespaces, and replace downstream credential documentation. */
function project(
	source: Readonly<Record<string, unknown>>,
	serviceId: string,
	routes: readonly GatewayArtifactRoute[],
	mappings: MountGatewayArtifactOptions['security'],
): OpenApiDocument {
	const components = isRecord(source.components) ? source.components : {};
	const available = isRecord(components.securitySchemes) ? components.securitySchemes : {};
	const securitySchemes: Record<string, unknown> = Object.create(null);
	const used = new Set<string>();
	const paths: Record<string, unknown> = Object.create(null);
	for (const route of routes) {
		const path = openApiPath(route.path);
		const item = (source.paths as Readonly<Record<string, Readonly<Record<string, unknown>>>>)[path]!;
		const original = item[route.method.toLowerCase()] as Readonly<Record<string, unknown>>;
		if ('callbacks' in original || 'webhooks' in source) {
			throw new TypeError('Artifact callback/webhook admission requires a separate host contract.');
		}
		const declared = original.security ?? source.security ?? [];
		if (!Array.isArray(declared)) throw new TypeError('Artifact security must be an array of alternatives.');
		const security = declared.map((alternative) => {
			if (!isRecord(alternative)) throw new TypeError('Artifact security alternatives must be records.');
			const mapped: Record<string, readonly string[]> = Object.create(null);
			for (const [name, scopes] of Object.entries(alternative)) {
				if (!strings(scopes) || !Object.hasOwn(available, name) || !Object.hasOwn(mappings, name)) {
					throw new TypeError(`Unresolved artifact caller security mapping ${JSON.stringify(name)}.`);
				}
				const mapping = mappings[name]!;
				if (!identifier(mapping.name)) throw new TypeError('Artifact caller scheme requires a stable name.');
				const scheme = data(mapping.scheme);
				assertScheme(scheme);
				if (scopes.length && scheme.type !== 'oauth2' && scheme.type !== 'openIdConnect') {
					throw new TypeError('Artifact caller scopes require an OAuth/OpenID scheme.');
				}
				if (scheme.type === 'oauth2' && isRecord(scheme.flows)) {
					const declaredScopes = new Set(
						Object.values(scheme.flows).flatMap((flow) =>
							isRecord(flow) && isRecord(flow.scopes) ? Object.keys(flow.scopes) : []
						),
					);
					if (scopes.some((scope) => !declaredScopes.has(scope))) {
						throw new TypeError('Artifact caller mapping references undeclared OAuth scopes.');
					}
				}
				if (Object.hasOwn(mapped, mapping.name)) {
					throw new TypeError('Artifact scheme mapping collapses distinct requirements.');
				}
				if (
					Object.hasOwn(securitySchemes, mapping.name) &&
					JSON.stringify(securitySchemes[mapping.name]) !== JSON.stringify(scheme)
				) throw new TypeError('Artifact caller scheme definitions conflict.');
				mapped[mapping.name] = scopes;
				securitySchemes[mapping.name] = scheme;
				used.add(name);
			}
			if (route.authentication.length > 0 && Object.keys(mapped).length === 0) {
				throw new TypeError('Authenticated artifact route cannot advertise anonymous caller access.');
			}
			return mapped;
		});
		if (
			(route.authentication.length > 0) !==
				(security.length > 0 && security.some((entry) => Object.keys(entry).length > 0))
		) throw new TypeError('Artifact manifest/document authentication drifts.');
		const { servers: _servers, security: _security, ...operation } = original;
		const { servers: _pathServers, ...pathFields } = item;
		const projected = rewrite(
			{ ...pathFields, [route.method.toLowerCase()]: { ...operation, security } },
			serviceId,
			mappings,
		);
		const current = isRecord(paths[path]) ? paths[path] : {};
		// Other owner methods are never copied from a path item as implicit admission.
		const inherited = Object.fromEntries(
			Object.entries(projected as Readonly<Record<string, unknown>>).filter(([name]) =>
				!methods.has(name.toUpperCase())
			),
		);
		paths[path] = {
			...current,
			...inherited,
			[route.method.toLowerCase()]: (projected as Readonly<Record<string, unknown>>)[route.method.toLowerCase()],
		};
	}
	for (const name of Object.keys(mappings)) {
		if (!used.has(name)) throw new TypeError(`Unknown artifact caller security mapping ${JSON.stringify(name)}.`);
	}
	const rewritten: Record<string, unknown> = Object.create(null);
	for (const [group, entries] of Object.entries(components)) {
		if (group === 'securitySchemes') continue;
		if (!isRecord(entries)) throw new TypeError('Artifact components must be named records.');
		rewritten[group] = Object.fromEntries(
			Object.entries(entries).map(([name, value]) => [`${serviceId}:${name}`, rewrite(value, serviceId, mappings)]),
		);
	}
	if (Object.keys(securitySchemes).length) rewritten.securitySchemes = securitySchemes;
	const projected = data({
		openapi: source.openapi === '3.2.0' ? '3.2.0' : '3.1.2',
		info: source.info,
		paths,
		...(Object.keys(rewritten).length ? { components: rewritten } : {}),
	});
	assertReferences(projected);
	return projected as OpenApiDocument;
}

/** Namespace local component pointers; never resolve a network or file reference. */
function rewrite(value: unknown, serviceId: string, mappings: MountGatewayArtifactOptions['security']): unknown {
	if (Array.isArray(value)) return value.map((entry) => rewrite(entry, serviceId, mappings));
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => {
			if (key !== '$ref' || typeof entry !== 'string' || !entry.startsWith('#/components/')) {
				return [key, rewrite(entry, serviceId, mappings)];
			}
			const parts = entry.slice(2).split('/').map(unescapePointer);
			const name = parts[2]!;
			const renamed = parts[1] === 'securitySchemes' ? mappings[name]?.name : `${serviceId}:${name}`;
			if (!renamed) {
				throw new TypeError('Artifact component security reference has no caller mapping.');
			}
			parts[2] = renamed;
			return [key, `#/${parts.map(escapePointer).join('/')}`];
		}),
	);
}

/** Follow an own-property JSON Pointer without executing objects or fetching references. */
function resolve(document: unknown, reference: unknown): unknown {
	if (typeof reference !== 'string' || !reference.startsWith('#/')) {
		throw new TypeError('Artifact references must be qualified local JSON pointers.');
	}
	let current: unknown = document;
	for (const part of reference.slice(2).split('/').map(unescapePointer)) {
		if (Array.isArray(current) && !/^(0|[1-9]\d*)$/.test(part)) {
			throw new TypeError('Artifact array pointers must address JSON elements.');
		}
		if (typeof current !== 'object' || current === null || !Object.hasOwn(current, part)) {
			throw new TypeError(`Unresolved artifact reference ${JSON.stringify(reference)}.`);
		}
		current = (current as Readonly<Record<string, unknown>>)[part];
	}
	return current;
}

/** Inspect already-snapshotted data recursively. */
function visit(value: unknown, accept: (value: Readonly<Record<string, unknown>>) => void): void {
	if (Array.isArray(value)) {
		for (const entry of value) visit(entry, accept);
		return;
	}
	if (!isRecord(value)) return;
	accept(value);
	for (const entry of Object.values(value)) visit(entry, accept);
}

/** Snapshot normalized transport fields while retaining host definition identity. */
function artifactPolicy(options: MountGatewayArtifactOptions): GatewayArtifactPolicy {
	if (options.bodyLimit !== undefined && (!Number.isSafeInteger(options.bodyLimit) || options.bodyLimit < 1)) {
		throw new TypeError('Artifact bodyLimit must be a positive safe integer.');
	}
	const timeout = options.timeout === undefined ? undefined : Temporal.Duration.from(options.timeout);
	if (timeout && elapsed(timeout) <= 0) {
		throw new TypeError('Artifact timeout must be positive.');
	}
	return Object.freeze({
		...(options.assertion === undefined ? {} : { assertion: Object.freeze([...catalog.values(options.assertion)]) }),
		...(timeout === undefined ? {} : { timeout }),
		...(options.bodyLimit === undefined ? {} : { bodyLimit: options.bodyLimit }),
		...(options.cache === undefined ? {} : { cache: Object.freeze({ ...options.cache }) }),
		...(options.credentials === undefined ? {} : { credentials: Object.freeze({ ...options.credentials }) }),
		...(options.redirects === undefined ? {} : {
			redirects: Object.freeze({
				...options.redirects,
				allowedOrigins: Object.freeze([...options.redirects.allowedOrigins]),
			}),
		}),
	});
}

/** Unbound domain/resource requirements cannot be converted into an edge authorization decision. */
function assertDefinitionOnly(value: Readonly<Record<string, unknown>>): void {
	for (const key of ['requirements', 'reachableRequirements', 'resources', 'resourceGraph', 'workflows']) {
		if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].length > 0)) {
			throw new TypeError(
				`Artifact ${key} requires an explicit host capability binding; unsupported by this data boundary.`,
			);
		}
	}
}

/** Reject unusable caller mechanisms; scheme names alone are not an authentication contract. */
function assertScheme(value: unknown): asserts value is OpenApiSecurityScheme {
	if (!isRecord(value)) throw new TypeError('Artifact caller scheme must be a record.');
	if (value.type === 'http') {
		if (typeof value.scheme !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value.scheme)) {
			throw new TypeError('Artifact HTTP caller scheme requires an authentication token.');
		}
	} else if (value.type === 'apiKey') {
		if (
			typeof value.name !== 'string' || !value.name.trim() || !['header', 'query', 'cookie'].includes(String(value.in))
		) throw new TypeError('Artifact API-key caller scheme requires a name and header/query/cookie location.');
	} else if (value.type === 'openIdConnect') {
		if (!absoluteHttp(value.openIdConnectUrl)) {
			throw new TypeError('Artifact OpenID caller scheme requires an absolute discovery URL.');
		}
	} else if (value.type === 'oauth2') {
		if (!isRecord(value.flows) || Object.keys(value.flows).length === 0) {
			throw new TypeError('Artifact OAuth caller scheme requires explicit flows.');
		}
		for (const [name, flow] of Object.entries(value.flows)) {
			if (
				!['implicit', 'password', 'clientCredentials', 'authorizationCode'].includes(name) || !isRecord(flow) ||
				!isRecord(flow.scopes) || Object.values(flow.scopes).some((scope) => typeof scope !== 'string')
			) throw new TypeError('Artifact OAuth flow requires declared scopes and a supported flow type.');
			if (['implicit', 'authorizationCode'].includes(name) && !absoluteHttp(flow.authorizationUrl)) {
				throw new TypeError('Artifact OAuth flow requires an absolute authorization URL.');
			}
			if (name !== 'implicit' && !absoluteHttp(flow.tokenUrl)) {
				throw new TypeError('Artifact OAuth flow requires an absolute token URL.');
			}
			if (flow.refreshUrl !== undefined && !absoluteHttp(flow.refreshUrl)) {
				throw new TypeError('Artifact OAuth refresh URL must be absolute.');
			}
		}
	} else throw new TypeError('Artifact caller scheme requires a declared OpenAPI authentication type.');
}

/**
 * Check URL syntax and an HTTP(S) scheme without network access. A valid URL is not evidence that an
 * identity provider or endpoint is trustworthy.
 */
function absoluteHttp(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
	} catch {
		return false;
	}
}

/** Recognize object-shaped data after the inert snapshot boundary; arrays are handled separately. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Require a nonempty portable catalog identifier without introducing a new normalization rule. */
function identifier(value: unknown): value is string {
	return typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]*$/i.test(value);
}
/** Accept an array whose every element is a string; semantic membership is checked by its caller. */
function strings(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0) &&
		new Set(value).size === value.length;
}
/** Accept an absolute colon-parameter route template with no query or fragment. */
function template(value: unknown): value is string {
	return typeof value === 'string' && !value.split('/').some((part) => part === '.' || part === '..') &&
		(value === '/' || /^\/(?:[A-Za-z0-9._~-]+|:[A-Za-z0-9_]+)(?:\/(?:[A-Za-z0-9._~-]+|:[A-Za-z0-9_]+))*$/.test(value));
}
/** Convert colon parameters to OpenAPI braces after route-template validation. */
function openApiPath(path: string): string {
	return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}
/** Escape one component name as a JSON Pointer token before qualifying a local reference. */
function escapePointer(value: string): string {
	return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
/** Decode one JSON Pointer token in the required order so an escaped tilde cannot create a second escape. */
function unescapePointer(value: string): string {
	if (/~(?![01])/.test(value)) throw new TypeError('Artifact JSON pointer has invalid escaping.');
	return value.replace(/~1/g, '/').replace(/~0/g, '~');
}
