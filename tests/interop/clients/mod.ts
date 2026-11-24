/** Every client adapter the suite runs, in report order. @module */
import { drivers } from './drivers.ts';
import { orms } from './orms.ts';
import { serverless } from './serverless.ts';
import type { ClientType } from './types.ts';

export type { ClientType, OpenedType } from './types.ts';

export const clients: readonly ClientType[] = [
	...drivers,
	...orms,
	...serverless,
];
