/**
 * Read and write HTTP data without losing syntax or silently changing trust decisions. For example, keep
 * both tag values in a repeated query parameter instead of overwriting the first one.
 *
 * Request helpers parse bounded incoming data. Response and problem definitions describe outgoing data.
 * Webhook helpers verify the exact received bytes before application parsing.
 *
 * Header forwarding removes connection-specific fields. Forwarding credentials and trusting a host still
 * require application policy. Parsing a request does not authenticate its caller.
 *
 * @example
 * ```ts
 * import * as request from '@okikio/http/request';
 * import { forward } from '@okikio/http/headers';
 * console.log(JSON.stringify(request.parseQuery('?tag=one&tag=two')));
 * const headers = forward(new Headers({ Connection: 'X-Internal', 'X-Internal': 'secret', Accept: 'application/json' }));
 * console.log(headers.has('x-internal'), headers.get('accept'));
 * ```
 *
 * @module
 */
export * as cookie from './cookie/mod.ts';
export * as problem from './problem/mod.ts';
export * as request from './request/mod.ts';
export * as response from './response/mod.ts';
export * as webhook from './webhook/mod.ts';
