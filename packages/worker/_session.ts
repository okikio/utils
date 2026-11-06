/**
 * Agree on a protocol before admitting application requests to a thread or process.
 * Both peers advertise a contract version and supported features. Each must support
 * the other's required features; accepting a message shape alone cannot establish
 * that agreement. Request/result validation happens separately after the handshake.
 * @internal @module
 */
import type { CompatibilityType } from './protocol.ts';

/** Capture own inert fields; remote messages cannot cause accessors to run during inspection. */
export function descriptor(value: unknown): CompatibilityType {
	if (typeof value !== 'object' || value === null) throw new TypeError('Invalid protocol compatibility declaration.');
	const fields = Object.getOwnPropertyDescriptors(value);
	for (const key of Reflect.ownKeys(fields)) {
		if (
			typeof key !== 'string' || !['contract', 'version', 'features', 'required'].includes(key) ||
			!('value' in fields[key]!)
		) throw new TypeError('Invalid protocol compatibility fields.');
	}
	const contract: unknown = fields.contract?.value, version: unknown = fields.version?.value;
	if (
		typeof contract !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(contract) || typeof version !== 'number' ||
		!Number.isSafeInteger(version) || version < 1
	) throw new TypeError('Invalid protocol identity or version.');
	/** Read one bounded dense feature list without invoking remote accessors. */
	function list(key: string): readonly string[] {
		const value: unknown = fields[key]?.value;
		if (!Array.isArray(value) || value.length > 32) {
			throw new TypeError('Protocol feature lists must contain at most 32 identifiers.');
		}
		const result: string[] = [];
		for (let index = 0; index < value.length; index++) {
			const field = Object.getOwnPropertyDescriptor(value, index);
			if (
				!field || !('value' in field) || typeof field.value !== 'string' ||
				!/^[A-Za-z0-9_.:/-]{1,128}$/.test(field.value) || result.includes(field.value)
			) throw new TypeError('Invalid or duplicate protocol feature.');
			result.push(field.value);
		}
		return Object.freeze(result);
	}
	return Object.freeze({ contract, version, features: list('features'), required: list('required') });
}

/** A single borrowed transport owns one handshake. Calling close never settles an application request. */
export class Session {
	/** Immutable local advertisement; absence deliberately selects legacy transport behavior. */
	readonly offer: CompatibilityType | undefined;
	/** Shared wait for agreement. Each request observes it through its own cancellation signal. */
	readonly #ready = Promise.withResolvers<void>();
	/** Set before send, so a synchronous host acknowledgement cannot send another hello. */
	#started = false;
	/** Only a validated acknowledgement permits payload admission. */
	#accepted = false;
	/**
	 * Snapshot the offered protocol before any message can arrive.
	 * No offer selects the existing transport behavior and needs no handshake wait.
	 */
	constructor(value: CompatibilityType | undefined) {
		this.offer = value === undefined ? undefined : descriptor(value);
		if (value === undefined) {
			this.#accepted = true;
			this.#ready.resolve();
		}
		void this.#ready.promise.catch(() => {});
	}
	/** Send one bounded hello before waiting; no application request has been encoded yet. */
	begin(send: (message: unknown) => void | Promise<void>): Promise<void> {
		if (!this.#started && this.offer !== undefined) {
			this.#started = true;
			try {
				void Promise.resolve(send({ type: 'hello', protocol: this.offer })).catch((error) => this.close(error));
			} catch (error) {
				this.close(error);
			}
		}
		return this.#ready.promise;
	}
	/** Validate exact revision and mutual features, then release all already bounded waiters once. */
	receive(value: unknown): void {
		if (this.offer === undefined || this.#accepted) throw new TypeError('Unexpected protocol hello.');
		const remote = descriptor(value), local = this.offer;
		if (
			local.contract !== remote.contract || local.version !== remote.version ||
			local.required.some((feature) => !remote.features.includes(feature)) ||
			remote.required.some((feature) => !local.features.includes(feature))
		) throw new TypeError('Incompatible protocol identity, version or required feature.');
		this.#accepted = true;
		this.#ready.resolve();
	}
	/** Fail closed if a configured peer attempts to bypass negotiation. */
	check(): void {
		if (!this.#accepted) throw new TypeError('Protocol negotiation is required before requests.');
	}
	/** Reject pending handshake waits when the actual transport retires. */
	close(reason: unknown): void {
		this.#ready.reject(reason);
	}
}

/** Admission counts include validators, handshake waits and sent requests awaiting cleanup receipts. */
export function maximum(value: number | undefined): number {
	const count = value ?? 1000;
	if (!Number.isSafeInteger(count) || count < 1) {
		throw new RangeError('maximumRequests must be a positive safe integer.');
	}
	return count;
}
