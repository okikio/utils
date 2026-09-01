/** Readonly diagnostic array produced by fault projection. */
export interface FaultArray extends ReadonlyArray<FaultValue> {}

/** Readonly diagnostic record produced by fault projection. */
export interface FaultRecord {
	readonly [key: string]: FaultValue;
}

/** JSON-safe diagnostic value produced from an arbitrary runtime fault. */
export type FaultValue = null | string | number | boolean | FaultArray | FaultRecord;

/** Limits applied while projecting arbitrary runtime faults into diagnostic data. */
export interface Options {
	/** Maximum nested object/array depth inspected before a marker is emitted. @default 6 */
	readonly maximumDepth?: number;
	/** Maximum own array items or object fields retained at each level. @default 32 */
	readonly maximumEntries?: number;
	/** Maximum UTF-16 string length retained for one string field. @default 4096 */
	readonly maximumStringLength?: number;
	/** Include an own string `stack` field from Error objects when available. @default true */
	readonly includeStack?: boolean;
}
