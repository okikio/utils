/**
 * Preserve HTTP syntax and trust decisions before application validation. Collapsing repeated query parameters or forwarding incoming credentials blindly changes what the caller asked for and what the next service can see.
 *
 * Use request helpers to bound and parse incoming data, response and problem definitions to declare outputs, and webhook helpers to verify exact raw bytes. headers.forward() strips fixed connection fields and fields named by Connection while retaining separate Set-Cookie values. request.forwardHeaders() adds credential and host trust policy. The application still authenticates actors and decides what credentials may cross an origin.
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
