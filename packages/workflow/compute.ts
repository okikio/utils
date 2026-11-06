/**
 * Immutable topology-neutral compute metadata.
 *
 * Dispatch and executor registration both retain this snapshot. A host can use
 * a flat model or attach a parent relationship without forcing one hierarchy on
 * every deployment.
 *
 * @module
 */
import * as record from '@okikio/collection/record';

import { freeze as freezeAffinity } from './affinity.ts';
import * as assert from './assert.ts';
import * as placement from './placement.ts';
import type { ComputeType } from './types.ts';

/**
 * Validate and snapshot optional executor compute metadata for durable storage.
 *
 * @internal
 */
export function freeze(value: ComputeType): ComputeType {
	record.assert(value, 'compute metadata');
	const lineage = placement.path(value);
	assert.id(value.id, 'compute');
	if (value.kind !== undefined) assert.id(value.kind, 'compute kind');
	if (value.parent !== undefined) assert.id(value.parent, 'compute parent');
	const attributes = value.attributes === undefined
		? undefined
		: freezeAffinity(value.attributes, 'compute attributes');
	return Object.freeze(
		{
			id: value.id,
			...(value.generation === undefined ? {} : { generation: value.generation }),
			...(value.capacity === undefined ? {} : { capacity: value.capacity }),
			...(value.ancestors === undefined ? {} : { ancestors: Object.freeze(lineage.slice(0, -1)) }),
			...(value.kind === undefined ? {} : { kind: value.kind }),
			...(value.parent === undefined ? {} : { parent: value.parent }),
			...(attributes === undefined ? {} : { attributes }),
		} satisfies ComputeType,
	);
}
