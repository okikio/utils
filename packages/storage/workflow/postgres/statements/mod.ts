/**
 * Every statement the PostgreSQL workflow store sends, built with `@okikio/sql` and grouped by what it changes.
 * `statements.sql` beside this folder holds their compiled SQL; the statement tests compare it and ask PostgreSQL to
 * describe each one.
 *
 * @module
 */
export * as chain from './chain.ts';
export * as cleanups from './cleanups.ts';
export * as history from './history.ts';
export * as hosts from './hosts.ts';
export * as jobs from './jobs.ts';
export * as maintenance from './maintenance.ts';
export * as runs from './runs.ts';
export * as shared from './shared.ts';
export * as inspect from './inspect.ts';
