/**
 * FSB family on a pool of workers, for many inputs at once.
 *
 * Each worker runs this family's WebAssembly module in its own thread. Use it when one thread cannot keep up: many
 * files, many records, or a few large inputs. `many()` returns one digest per input, in order. Deno, Bun and browsers
 * have a global `Worker`; Node.js needs `create` from `@okikio/runtime/node/worker`.
 *
 * ```ts ignore
 * import * as context from '@okikio/context';
 * import { open } from '@okikio/hash/fsb/shared';
 *
 * await using ctx = context.create({ id: 'hashes' });
 * await using pool = open(ctx, { workers: 4 });
 * const digests = await pool.many(ctx, 'fsb256', ['a', 'b', 'c']);
 * ```
 *
 * @module
 */
import type { Context } from '@okikio/context';
import type { NameType } from '../../_wasm/registry.ts';
import { open as pool, type PoolOptionsType, type PoolType } from './pool.ts';
export type { PoolOptionsType, PoolType } from './pool.ts';
export type { HashOptionsType } from '../../_family.ts';
export type { InputType } from '../../_bytes.ts';

/** Algorithm names of this family. */
export type AlgorithmType = NameType<'fsb'>;

/** Open a pool of workers for this family. `ctx` owns the workers; dispose the pool to stop them. */
export function open(ctx: Context, options?: PoolOptionsType): PoolType<AlgorithmType> {
	return pool<AlgorithmType>(ctx, 'fsb', options);
}
