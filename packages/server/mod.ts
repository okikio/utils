/**
 * Build a Fetch application from routes and middleware, then choose a host that listens for requests.
 * Start with Web Request and Response values, as in a POST route that validates and saves a note.
 *
 * Endpoint definitions describe stable input and output contracts. Services bind those definitions to
 * implementations, and a gateway composes services. Definitions do not open connections or start
 * listeners.
 *
 * The executable selects the host adapter. Middleware and response bodies still have cancellation and
 * cleanup costs; buffer only payloads with an explicit bound.
 *
 * @example
 * ```ts
 * import * as http from '@okikio/server/http';
 * const app = http.create({
 * 	routes: [http.route('GET', '/health', () => Response.json({ ok: true }))],
 * 	middleware: [http.securityHeaders()],
 * });
 * const response = await app.fetch(new Request('https://service.invalid/health'));
 * console.log(response.status, (await response.json()).ok);
 * ```
 *
 * @module
 */
export * as http from './http/mod.ts';
export * as endpoint from './endpoint/mod.ts';
export * as middleware from './middleware/mod.ts';
export * as gateway from './gateway/mod.ts';
export * as service from './service/mod.ts';
export { GatewayProblems } from './gateway/problems.ts';
export { ServerProblems } from './problems.ts';
