/**
 * Shared activity-affinity validation and matching.
 *
 * Affinity is durable placement data, not a live provider resource. These
 * helpers therefore snapshot it as ordinary finite scalar data before either
 * workflow instructions or live engine registrations retain it.
 *
 * @module
 */
import * as record from '@okikio/collection/record';
import * as placement from './placement.ts';
import type { ComputeType } from './types.ts';
import type { EngineAffinityType } from './types.ts';

/** Snapshot one affinity record before it becomes instruction or placement identity. */
export function freeze(value: EngineAffinityType, name = 'activity affinity'): EngineAffinityType {
	const snapshot = record.snapshot(value, name);
	for (const [key, field] of record.entries(snapshot, name)) {
		if (
			typeof field !== 'string' && typeof field !== 'boolean' && (typeof field !== 'number' || !Number.isFinite(field))
		) {
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

/** Activity facts used by placement; payloads, resources and credentials are deliberately absent. */
export interface PlacementActivityType {
	/** Required nested compute scope in this diagnostic snapshot. */
	readonly location?: placement.SelectionType;
	/** Stable activity definition identity. */
	readonly id: string;
	/** Exact activity contract version. */
	readonly version: string;
	/** Requested finite scalar host facts. */
	readonly affinity?: Readonly<Record<string, string | number | boolean>>;
}
/** One host snapshot. Its owner must provide current active counts and lifecycle flags. */
export interface PlacementHostType {
	/** Trusted complete compute path; parent-only metadata cannot satisfy ancestors. */
	readonly compute?: ComputeType;
	/** Registration identity, distinct from the stable host identity. */
	readonly id: string;
	/** Stable host identity, retained across registration generations. */
	readonly hostId: string;
	/** Engine identity advertised by this registration. */
	readonly engineId: string;
	/** Exact supported activity contracts. */
	readonly activities: readonly Readonly<{ id: string; version: string }>[];
	/** Host affinity facts; these do not grant authority. */
	readonly affinity?: Readonly<Record<string, string | number | boolean>>;
	/** Maximum concurrent attempts. */
	readonly capacity: number;
	/** Attempts already owned by this registration. */
	readonly active: number;
	/** Whether this registration has closed. */
	readonly closed?: boolean;
	/** Whether it is draining and cannot accept new work. */
	readonly draining?: boolean;
	/** Absolute lease expiry, if registrations are leased. */
	readonly expiresAt?: Readonly<{ epochMilliseconds: number; epochNanoseconds?: bigint }>;
}
/** First failed dispatch constraint; undefined means eligible at this snapshot. */
export type PlacementReasonType =
	| 'closed'
	| 'draining'
	| 'engine'
	| 'capacity'
	| 'expired'
	| 'affinity'
	| 'activity'
	| 'location';
/** Diagnose snapshot eligibility without reserving work. Current ancestor generations and shared budgets require the dispatch authority. */
export function rejection(
	activity: PlacementActivityType,
	host: PlacementHostType,
	engine: string,
	now: number | bigint,
): PlacementReasonType | undefined {
	if (typeof now === 'number' && !Number.isFinite(now)) {
		throw new RangeError('Placement time must be finite epoch milliseconds.');
	}
	if (host.closed) return 'closed';
	if (activity.location !== undefined && !placement.matches(activity.location, placement.path(host.compute))) {
		return 'location';
	}
	if (host.draining) return 'draining';
	if (host.engineId !== engine) return 'engine';
	if (host.active >= host.capacity) return 'capacity';
	if (
		host.expiresAt !== undefined &&
		(typeof now === 'bigint'
			? now >= (host.expiresAt.epochNanoseconds ?? BigInt(host.expiresAt.epochMilliseconds) * 1_000_000n)
			: now >= host.expiresAt.epochMilliseconds)
	) return 'expired';
	if (
		activity.affinity !== undefined &&
		(host.affinity === undefined ||
			Object.entries(activity.affinity).some(([key, value]) =>
				!Object.hasOwn(host.affinity!, key) || host.affinity![key] !== value
			))
	) return 'affinity';
	if (!host.activities.some((entry) => entry.id === activity.id && entry.version === activity.version)) {
		return 'activity';
	}
	return undefined;
}
