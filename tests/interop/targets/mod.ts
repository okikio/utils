/** Every target, in the order the suite starts them. @module */
import { postgres } from './postgres.ts';
import type { TargetType } from './types.ts';

export type { StartedType, TargetType } from './types.ts';

export const targets: readonly TargetType[] = [...postgres];
