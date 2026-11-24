/** Every target, in the order the suite starts them. @module */
import { embedded } from './embedded.ts';
import { poolers } from './poolers.ts';
import { distributions, postgres } from './postgres.ts';
import { remote } from './remote.ts';
import type { TargetType } from './types.ts';

export type { StartedType, TargetType } from './types.ts';

export const targets: readonly TargetType[] = [
	...postgres,
	...poolers,
	...remote,
	...distributions,
	...embedded,
];
