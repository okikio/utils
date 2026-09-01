import * as recordCore from '@okikio/record';
import type { ForwardedHeaderPolicy } from './types.ts';
import { RequestTransportError } from './types.ts';

/** Resolve the externally visible URL only when forwarding fields are explicitly trusted. */
export function externalUrl(request: Request, policy: ForwardedHeaderPolicy): URL {
	const normalizedPolicy = forwardedPolicy(policy);
	const result = new URL(request.url);
	const hasForwarding = request.headers.has('forwarded') || [...request.headers.keys()].some((name) => name.startsWith('x-forwarded-'));
	if (!normalizedPolicy.trust) {
		if (hasForwarding) return result;
		return result;
	}
	let protocol: string | undefined;
	let host: string | undefined;
	if (normalizedPolicy.allowForwarded !== false) {
		const first = request.headers.get('forwarded')?.split(',', 1)[0];
		if (first) {
			for (const pair of first.split(';')) {
				const [name, raw] = pair.split('=', 2).map((value) => value.trim());
				const value = raw?.replace(/^"|"$/g, '');
				if (name?.toLowerCase() === 'proto') protocol = value;
				if (name?.toLowerCase() === 'host') host = value;
			}
		}
	}
	if (normalizedPolicy.allowXForwarded !== false) {
		protocol ??= request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim();
		host ??= request.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim();
	}
	if (protocol) {
		const normalized = protocol.endsWith(':') ? protocol : `${protocol}:`;
		if (normalizedPolicy.allowedProtocols && !normalizedPolicy.allowedProtocols.includes(normalized as 'http:' | 'https:')) throw new RequestTransportError({ code: 'untrusted-forwarded-header', message: `Forwarded protocol ${JSON.stringify(protocol)} is not allowed.`, path: ['header', 'forwarded'] });
		result.protocol = normalized;
	}
	if (host) {
		if (/[\0\r\n/@\\]/.test(host)) throw new RequestTransportError({ code: 'untrusted-forwarded-header', message: 'Forwarded host is malformed.', path: ['header', 'forwarded'] });
		if (normalizedPolicy.allowedHosts && !normalizedPolicy.allowedHosts.some((allowed) => allowed.toLowerCase() === host!.toLowerCase())) throw new RequestTransportError({ code: 'untrusted-forwarded-header', message: `Forwarded host ${JSON.stringify(host)} is not allowed.`, path: ['header', 'forwarded'] });
		const forwarded = new URL(`${result.protocol}//${host}`);
		result.hostname = forwarded.hostname;
		result.port = forwarded.port;
	}
	return result;
}


/** Validate and snapshot forwarding trust policy before reading spoofable request metadata. @internal */
function forwardedPolicy(policy: ForwardedHeaderPolicy): ForwardedHeaderPolicy {
	recordCore.assert(policy, 'forwarded header policy');
	if (typeof policy.trust !== 'boolean') throw new TypeError('forwarded header policy trust must be a boolean.');
	for (const [name, value] of [['allowForwarded', policy.allowForwarded], ['allowXForwarded', policy.allowXForwarded]] as const) {
		if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean when provided.`);
	}
	const allowedHosts = policy.allowedHosts === undefined ? undefined : stringList(policy.allowedHosts, 'allowedHosts');
	const allowedProtocols = policy.allowedProtocols === undefined ? undefined : stringList(policy.allowedProtocols, 'allowedProtocols');
	if (allowedProtocols?.some((value) => value !== 'http:' && value !== 'https:')) throw new TypeError('allowedProtocols may contain only http: or https:.');
	return Object.freeze({
		trust: policy.trust,
		...(policy.allowForwarded === undefined ? {} : { allowForwarded: policy.allowForwarded }),
		...(policy.allowXForwarded === undefined ? {} : { allowXForwarded: policy.allowXForwarded }),
		...(allowedHosts === undefined ? {} : { allowedHosts }),
		...(allowedProtocols === undefined ? {} : { allowedProtocols: allowedProtocols as readonly ('http:' | 'https:')[] }),
	});
}

/** Snapshot one dense string-list option without invoking array accessors. @internal */
function stringList(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array of strings.`);
	const output: string[] = [];
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
			throw new TypeError(`${name} must contain dense string data elements.`);
		}
		output.push(descriptor.value);
	}
	return Object.freeze(output);
}
