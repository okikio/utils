/**
 * Shared activity-affinity validation and matching.
 *
 * Affinity is durable placement data, not a live provider resource. These
 * helpers therefore snapshot it as ordinary finite scalar data before either
 * workflow instructions or live engine registrations retain it.
 *
 * @module
 */
import * as record from '@okikio/record';
import type { EngineAffinityType } from './types.ts';

/** Snapshot one affinity record before it becomes instruction or placement identity. */
export function freeze(value: EngineAffinityType, name = 'activity affinity'): EngineAffinityType {
	const snapshot = record.snapshot(value, name);
	for (const [key, field] of record.entries(snapshot, name)) {
		if (typeof field !== 'string' && typeof field !== 'boolean' && (typeof field !== 'number' || !Number.isFinite(field))) {
			throw new TypeError(`${name} ${JSON.stringify(key)} must be a string, boolean, or finite number.`);
		}
	}
	return snapshot;
}

/** Return whether every requested affinity field exactly matches one offered host fact. */
export function matches(requested: EngineAffinityType | undefined, offered: EngineAffinityType | undefined): boolean {
	if (requested === undefined) return true;
	if (offered === undefined) return false;
	return record.entries(requested, 'requested activity affinity').every(([key, value]) => offered[key] === value);
}
