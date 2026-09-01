/**
 * Server composition namespaces.
 *
 * Definitions remain import-safe. Runtime construction occurs only through an
 * explicit `service.create` or `gateway.create` call. Resource ownership lives
 * in the provider-neutral `@okikio/resource` package.
 */
export * as http from './http/mod.ts';
export * as endpoint from './endpoint/mod.ts';
export * as middleware from './middleware/mod.ts';
export * as gateway from './gateway/mod.ts';
export * as service from './service/mod.ts';
export { GatewayProblems } from './gateway/problems.ts';
export { ServerProblems } from './problems.ts';
