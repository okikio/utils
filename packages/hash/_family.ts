/**
 * The runtime of every entry point except `/static`, with the full loader: compiled modules, bytes,
 * URLs, responses and packed text. See `_runtime.ts` for how a call picks its backend.
 *
 * @module
 */
import { runtime as build, type RuntimeOptionsType, type RuntimeType } from './_runtime.ts';
import type { FamilyType } from './_wasm/registry.ts';
import { load, type SourceType, unpack } from './_wasm/load.ts';

export { CollisionError, NotReadyError, UnsupportedError } from './_runtime.ts';
export type { FallbackType, HashOptionsType, ModeType, RuntimeOptionsType, RuntimeType } from './_runtime.ts';

const loader = { load, unpack };

/** Build the runtime of one family entry point. */
export function runtime<F extends FamilyType>(config: RuntimeOptionsType<F>): RuntimeType<F, SourceType> {
	return build<F, SourceType>(config, loader);
}
