/** Signed, contract-bound continuation data. This module does not plan or execute database keyset predicates. @module */
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import type { Contract, ContractOutput } from '@okikio/schema/codec';
import { base64url, unbase64url } from '@okikio/hash/encoding';
import { decodeValue, encodeValue } from './value-codec.ts';
import type { CursorCodec, QuerySort } from './types.ts';

/** Borrowed signing capability. Use Hash HMAC or an application-owned signer; no keys are created or cached globally. */
export interface Signer {
	/** Return a complete tag for the supplied domain-separated bytes. */
	sign(bytes: Uint8Array): Uint8Array | Promise<Uint8Array>;
	/** Authenticate the complete tag. Implementations own constant-time verification where their algorithm requires it. */
	verify(bytes: Uint8Array, tag: Uint8Array): boolean | Promise<boolean>;
}
/** Selected key identity is public routing data, never a secret or authorization grant. */
export interface KeyType {
	/** Public label stored in tokens so decode can select the matching retained key. */
	readonly id: string;
	/** Application-owned signing capability. The token contains the label, never this key material. */
	readonly signer: Signer;
}
/** Binding is selected by the authorized caller for one normalized query and provider ordering contract. */
export interface DefinitionType<Values extends Contract> {
	/** Stable schema/query revision. Bump when key meanings or codecs change. */
	readonly contract: string;
	/** Exact normalized sort priority, ending with an application-guaranteed unique tiebreaker. */
	readonly order: readonly QuerySort[];
	/** Provider-owned null ordering, collation and uniqueness profile. The codec does not infer database behavior. */
	readonly semantics: string;
	/** Exact authorized tenant/filter context. It is authenticated but visible; use a stable opaque digest for secrets. */
	readonly context: string;
	/** Encoded output must be a scalar or flat scalar list accepted by Query's existing tagged wire model. */
	readonly values: Values;
}
/** Explicit finite admission and key-rotation policy. Keys and clock remain caller-owned. */
export interface Options {
	/** ASCII token bytes, including version, key identity, encoded payload and tag. */
	readonly maximumTokenBytes: number;
	/** Maximum retained authorized signing keys. Only the addressed key is tried. */
	readonly maximumKeys: number;
	/** Keys still accepted for verification, including old keys while issued tokens remain valid. */
	readonly keys: readonly KeyType[];
	/** ID in keys used to issue new tokens. Switching it does not invalidate retained old keys. */
	readonly activeKey: string;
	/** Milliseconds of validity, or explicit null to omit expiry. No ambient clock is consulted. */
	readonly expiresIn: number | null;
	/** Current safe nonnegative epoch milliseconds, read once per encode/decode. */
	readonly now: () => number;
}
/** Redacted malformed, forged, expired or wrong-binding token. Signer/codec defects retain their own errors. */
export class CursorError extends Error {
	/** Deliberately hide whether the token was forged, expired, malformed, or bound to another query. */
	constructor() {
		super('Cursor is invalid for this query.');
		this.name = 'CursorError';
	}
}

/** Asynchronous signed codec, assignable to the ordinary pagination CursorCodec contract. */
export interface Cursor<Value> extends CursorCodec<Value> {
	encode(value: Value): Promise<string>;
	decode(token: string): Promise<Value>;
}

/**
 * Create an authenticated cursor codec. Key rotation retains explicitly listed old keys for verification;
 * encoding uses activeKey. Tokens carry public envelope data, not encrypted secrets. A changed contract,
 * order, provider semantics or context rejects. This protects token integrity, not tenant authorization.
 * The caller still owns valid keyset predicates, actual uniqueness, null ordering and collation.
 */
export function create<Values extends Contract>(
	definition: DefinitionType<Values>,
	options: Options,
): Cursor<ContractOutput<Values>> {
	const { maximumTokenBytes, maximumKeys, activeKey, expiresIn, now } = options;
	if (
		!Number.isSafeInteger(maximumTokenBytes) || maximumTokenBytes < 1 ||
		!Number.isSafeInteger(maximumKeys) || maximumKeys < 1 || options.keys.length > maximumKeys ||
		(expiresIn !== null && (!Number.isSafeInteger(expiresIn) || expiresIn <= 0)) || typeof now !== 'function'
	) {
		throw new RangeError('Invalid cursor size, key or expiry policy.');
	}
	if (definition.order.length > maximumTokenBytes) throw new RangeError('Cursor ordering exceeds token budget.');
	const order = definition.order.map((entry) => ({
		field: entry.field,
		direction: entry.direction,
		tiebreaker: entry.tiebreaker,
	}));
	if (
		order.length === 0 || order.length > maximumTokenBytes || order.at(-1)?.tiebreaker !== true ||
		order.some((entry) =>
			typeof entry.field !== 'string' || entry.field.length > maximumTokenBytes ||
			!['asc', 'desc'].includes(entry.direction)
		) ||
		order.filter((entry) => entry.tiebreaker).length !== 1 ||
		new Set(order.map((entry) => entry.field)).size !== order.length
	) throw new TypeError('Cursor requires a unique final tiebreaker and distinct ordered fields.');
	const contract = definition.contract, context = definition.context, semantics = definition.semantics;
	for (const text of [contract, context, semantics]) {
		if (typeof text !== 'string' || text.length > maximumTokenBytes) throw new TypeError('Invalid cursor binding.');
	}
	if (!contract || !semantics) throw new TypeError('Cursor requires contract and ordering semantics.');
	const binding = JSON.stringify(order);
	if (binding.length > maximumTokenBytes) throw new RangeError('Cursor ordering exceeds token budget.');
	const values = definition.values;
	/** Capture method identities so later caller mutation cannot silently replace verification policy. */
	const keys = new Map<string, Signer>();
	for (const key of options.keys) {
		if (
			!/^[A-Za-z0-9_-]{1,64}$/.test(key.id) || keys.has(key.id) ||
			typeof key.signer.sign !== 'function' || typeof key.signer.verify !== 'function'
		) throw new TypeError('Invalid or duplicate cursor signing key.');
		keys.set(
			key.id,
			Object.freeze({ sign: key.signer.sign.bind(key.signer), verify: key.signer.verify.bind(key.signer) }),
		);
	}
	const active = keys.get(activeKey);
	if (active === undefined) throw new TypeError('Cursor active key is not authorized.');
	/** Schema validates envelope shape independently of typed application key validation. */
	const EnvelopeSchema = schema.object({
		version: schema.literal(1),
		contract: schema.string({ maxLength: maximumTokenBytes }),
		order: schema.string({ maxLength: maximumTokenBytes }),
		semantics: schema.string({ maxLength: maximumTokenBytes }),
		context: schema.string({ maxLength: maximumTokenBytes }),
		expiresAt: schema.nullable(schema.number({ integer: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
		keys: schema.string({ maxLength: maximumTokenBytes }),
	});
	const encoder = new TextEncoder();
	/** Prefix prevents a valid tag for another protocol from authenticating the same arbitrary message here. */
	const message = (prefix: string): Uint8Array => encoder.encode(`okikio.query.cursor\0${prefix}`);
	/** Validate the borrowed clock once per encode/decode before deriving expiry decisions. */
	const clock = (): number => {
		const instant = now();
		if (!Number.isSafeInteger(instant) || instant < 0) {
			throw new RangeError('Cursor clock requires safe epoch milliseconds.');
		}
		return instant;
	};
	return Object.freeze({
		/** Encode validated ordered keys, authenticate the public binding envelope, and enforce the complete token budget. */
		async encode(value: ContractOutput<Values>): Promise<string> {
			const instant = clock();
			const expiresAt = expiresIn === null ? null : instant + expiresIn;
			if (expiresAt !== null && !Number.isSafeInteger(expiresAt)) {
				throw new RangeError('Cursor expiry exceeds safe milliseconds.');
			}
			const encoded = await codec.write(values, value);
			if ((Array.isArray(encoded) ? encoded.length : 1) !== order.length) {
				throw new TypeError('Cursor key count must match ordering.');
			}
			// A trusted codec may return a much larger scalar than its future token budget.
			// Reject obvious oversize before constructing the tagged JSON and Base64 representations.
			const members = Array.isArray(encoded) ? encoded : [encoded];
			let textSize = 0;
			for (const member of members) {
				if (typeof member === 'string') textSize += member.length;
				else if (typeof member === 'bigint') textSize += String(member).length;
				if (textSize > maximumTokenBytes) throw new RangeError('Cursor key text exceeds token budget.');
			}
			const envelope = {
				version: 1,
				contract,
				order: binding,
				semantics,
				context,
				expiresAt,
				keys: encodeValue(encoded),
			};
			const body = base64url(encoder.encode(JSON.stringify(envelope)));
			const prefix = `v1.${activeKey}.${body}`;
			if (prefix.length >= maximumTokenBytes) throw new RangeError('Cursor exceeds maximumTokenBytes.');
			const tag = await active.sign(message(prefix));
			if (tag.byteLength === 0) throw new TypeError('Cursor signer returned an empty tag.');
			const token = `${prefix}.${base64url(tag)}`;
			if (token.length > maximumTokenBytes) throw new RangeError('Cursor exceeds maximumTokenBytes.');
			return token;
		},
		/** Authenticate the addressed key before trusting envelope data; recheck binding and expiry before key decoding. */
		async decode(token: string): Promise<ContractOutput<Values>> {
			if (typeof token !== 'string' || token.length > maximumTokenBytes) throw new CursorError();
			const parts = /^(v1)\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
			if (parts === null) throw new CursorError();
			const signer = keys.get(parts[2]!);
			if (signer === undefined) throw new CursorError();
			let body: Uint8Array, tag: Uint8Array;
			try {
				body = unbase64url(parts[3]!);
				tag = unbase64url(parts[4]!);
			} catch {
				throw new CursorError();
			}
			if (!await signer.verify(message(`v1.${parts[2]}.${parts[3]}`), tag)) throw new CursorError();
			let raw: unknown;
			try {
				raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
			} catch {
				throw new CursorError();
			}
			const checked = await schema.validate(EnvelopeSchema, raw);
			if (checked.issues !== undefined) throw new CursorError();
			const envelope = checked.value;
			const instant = clock();
			if (
				envelope.contract !== contract || envelope.order !== binding || envelope.semantics !== semantics ||
				envelope.context !== context || (expiresIn !== null && envelope.expiresAt === null) ||
				(envelope.expiresAt !== null && instant >= envelope.expiresAt)
			) throw new CursorError();
			let decoded: unknown;
			try {
				decoded = decodeValue(envelope.keys, maximumTokenBytes, maximumTokenBytes);
			} catch {
				throw new CursorError();
			}
			if ((Array.isArray(decoded) ? decoded.length : 1) !== order.length) throw new CursorError();
			return await codec.read(values, decoded);
		},
	});
}
