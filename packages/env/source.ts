import * as recordCore from '@okikio/record';
import type { EnvironmentRecord, EnvironmentSource, EnvironmentSourceInput } from './types.ts';

interface DenoEnvironmentRuntime {
	readonly env?: {
		get(key: string): string | undefined;
	};
}

interface ProcessEnvironmentRuntime {
	readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Return whether a value already implements the pull-based source contract. */
export function isSource(value: EnvironmentSourceInput): value is EnvironmentSource {
	return typeof value === 'object' && value !== null && typeof (value as EnvironmentSource).get === 'function';
}

/** Convert a source-or-record input to the pull-based source contract. */
function toSource(input: EnvironmentSourceInput): EnvironmentSource {
	return isSource(input) ? input : record(input);
}

/**
 * Capture raw values as a deterministic environment source.
 *
 * The snapshot uses `Map` because environment keys are external strings. Keys
 * such as `__proto__`, `constructor`, and `toString` therefore remain ordinary
 * data instead of interacting with an object's prototype.
 *
 * @example Test override
 * ```ts
 * const test = env.record({ PORT: '4321' });
 * test.get('PORT'); // '4321'
 * ```
 */
export function record(values: EnvironmentRecord): EnvironmentSource {
	recordCore.assert(values, 'environment record');
	const snapshot = new Map(Object.entries(values));
	return {
		/**
		 * Gets state from environment definition and resolution after its ownership and validation rules have been established.
		 *
		 * @internal
		 */
		get(key: string): string | undefined {
			return snapshot.get(key);
		},
	};
}

/**
 * Merge sparse sources from lowest to highest precedence.
 *
 * Later sources override earlier sources only when they provide a concrete
 * string. Returning `undefined` allows lookup to continue into lower layers.
 * This mirrors how a host can apply explicit overrides without copying the
 * entire ambient environment.
 *
 * @example Runtime values with explicit overrides
 * ```ts
 * const source = env.merge(env.env, { PORT: '4321' });
 * ```
 *
 * @example Sparse override
 * ```ts
 * const source = env.merge({ HOST: 'localhost', PORT: '8787' }, { PORT: '4321' });
 * source.get('HOST'); // 'localhost'
 * source.get('PORT'); // '4321'
 * ```
 */
export function merge(...sources: readonly EnvironmentSourceInput[]): EnvironmentSource {
	const normalized = sources.map(toSource);
	return {
		/**
		 * Gets state from environment definition and resolution after its ownership and validation rules have been established.
		 *
		 * @internal
		 */
		get(key: string): string | undefined {
			for (let index = normalized.length - 1; index >= 0; index -= 1) {
				const value = normalized[index]?.get(key);
				if (value !== undefined) return value;
			}
			return undefined;
		},
	};
}

/**
 * Reads runtime value under the module's cancellation and ownership rules.
 *
 * @internal
 */
function getRuntimeValue(key: string): string | undefined {
	const deno = (globalThis as typeof globalThis & { Deno?: DenoEnvironmentRuntime }).Deno;
	if (deno?.env?.get) return deno.env.get(key);

	const values = (globalThis as typeof globalThis & { process?: ProcessEnvironmentRuntime }).process?.env;
	return values && Object.hasOwn(values, key) ? values[key] : undefined;
}

/**
 * Lazy ambient environment source for Deno and supported Node.js runtimes.
 *
 * Importing this value performs no environment read. Each call to `get()` reads
 * only the requested key, which preserves narrow Deno permissions. Node-compatible runtimes are read through the ambient `process.env` object, so
 * browser module resolution never encounters a static `node:` import.
 *
 * Browser and edge runtimes that expose neither ambient API behave as an empty
 * source; their composition root should pass deployment bindings explicitly.
 */
export const env: EnvironmentSource = {
	/**
	 * Gets state from environment definition and resolution after its ownership and validation rules have been established.
	 *
	 * @internal
	 */
	get(key: string): string | undefined {
		return getRuntimeValue(key);
	},
};

/**
 * Read a bounded set of raw values without defining a validation schema.
 *
 * This is useful for deployment adapters and opaque pass-through settings that
 * need source selection but do not own the value's domain contract.
 */
export function select(source: EnvironmentSourceInput, keys: readonly string[]): EnvironmentRecord {
	const normalized = toSource(source);
	return Object.fromEntries(keys.map((key) => [key, normalized.get(key)]));
}
