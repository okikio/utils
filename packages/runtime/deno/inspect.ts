/** Deno permission evidence through query only; this entry never requests a grant. @module */
import { inspect as portable } from '../inspect.ts';
import type { InspectionType } from '../inspect.ts';

/** Each state belongs to the caller's exact descriptor, including its optional path/host/command scope. */
export interface PermissionInspectionType {
	/** Input position. Descriptors are not retained because they may contain private paths or hosts. */
	readonly index: number;
	/** Query evidence for this descriptor at observation time; not authorization for a later operation. */
	readonly state: 'granted' | 'denied' | 'prompt' | 'unavailable';
}
/** Deno feature snapshot plus bounded caller-selected permission queries. No descriptors or credentials are returned. */
export interface DenoInspectionType extends Omit<InspectionType, 'permissions'> {
	/** Ordered redacted query outcomes, bounded by maximumQueries. */
	readonly permissions: readonly PermissionInspectionType[];
}

/**
 * Query each selected descriptor once, in order, without requesting permissions or probing an operation.
 * An unscoped descriptor asks about its whole capability, not every possible scoped grant. Unknown
 * descriptors become unavailable only for a host TypeError; other query defects propagate. The input
 * count is checked before the first query. This snapshot cannot authorize or guarantee later I/O.
 */
export async function inspect(
	descriptors: readonly Deno.PermissionDescriptor[],
	options: Readonly<{ maximumQueries: number }>,
): Promise<DenoInspectionType> {
	if (
		!Number.isSafeInteger(options.maximumQueries) || options.maximumQueries < 0 ||
		descriptors.length > options.maximumQueries
	) {
		throw new RangeError('Permission descriptors exceed maximumQueries.');
	}
	const inputs = descriptors.map((descriptor) => ({ ...descriptor }));
	const permissions: PermissionInspectionType[] = [];
	for (let index = 0; index < inputs.length; index++) {
		let state: PermissionInspectionType['state'];
		try {
			state = (await Deno.permissions.query(inputs[index]!)).state;
		} catch (error) {
			if (!(error instanceof TypeError)) throw error;
			state = 'unavailable';
		}
		permissions.push(Object.freeze({ index, state }));
	}
	return Object.freeze({ ...portable(), permissions: Object.freeze(permissions) });
}
