/**
 * Keep a set of definitions or copy plain data without hiding which values are allowed.
 *
 * Use catalog for named definitions such as permissions or endpoints. Selecting a smaller catalog keeps
 * the original definition objects and narrows the available set. Use record for data operations instead of
 * treating live class instances as plain records.
 *
 * @module
 */
export * from './catalog/mod.ts';
export * as catalog from './catalog/mod.ts';
export * as record from './record/mod.ts';
