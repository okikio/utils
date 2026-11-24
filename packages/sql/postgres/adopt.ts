/**
 * Adopt a PostgreSQL schema made elsewhere: read it, write table definitions for it, and check them against it.
 *
 * - {@link inspect} reads the tables, views, composite types and enums of some schemas from the catalog.
 * - {@link generate} writes TypeScript table definitions from that, under schemas marked `{ owned: false }`.
 * - {@link drift} compares table definitions with the live database and lists what would fail or change a value.
 *
 * @module
 */
export { type ColumnInfoType, inspect, type InspectionType, type TableInfoType } from './catalog.ts';
export { generate, type GenerateOptions } from './codegen.ts';
export { drift, type DriftType } from './drift.ts';
