/** Load the same verification-built npm artifact on every measured runtime. @module */

/** Selected Fetch function accepted by native Vixeny response routes. */
export type VixenyFetchType = (request: Request) => Response | Promise<Response>;

/** The published response factory adds type/f/o; parameter compilation reads its native path. */
export interface VixenyRouteType {
	readonly type: 'response';
	readonly path: string;
	readonly method?: 'GET' | 'POST' | 'HEAD';
	readonly r: VixenyFetchType;
	readonly f: () => Response;
	readonly o?: unknown;
}

/** Narrow signatures inspected in npm vixeny@0.1.53; this does not assert upstream strict TS compatibility. */
export interface Vixeny {
	readonly composeResponse: (options?: {
		readonly 404?: (request: Request) => Response;
		readonly 405?: (request: Request) => Response;
	}) => (routes: VixenyRouteType[]) => Promise<VixenyFetchType>;
	readonly petitions: {
		readonly response: () => (options: {
			readonly path: string;
			readonly method?: 'GET' | 'POST' | 'HEAD';
			readonly r: VixenyFetchType;
		}) => VixenyRouteType;
	};
	readonly components: {
		readonly param: () => (route: VixenyRouteType) => (url: string) => string | Record<string, string> | null;
	};
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Load native Vixeny functions from the exact npm source compiled by tools/challenger-build.mjs.
 *
 * The published npm entry is TypeScript inside node_modules. Modern Node/Deno
 * loaders reject that source layout. The verification task emits one ESM
 * artifact before tests or measurements, retaining its source/build receipt.
 * This loader neither transforms code nor installs runtime hooks. Native ESM
 * import caching reuses the module; each factory still compiles its own routes.
 */
export async function loadVixeny(): Promise<Vixeny> {
	const artifact = new URL('../../../.artifacts/challengers/vixeny.mjs', import.meta.url);
	const loaded: unknown = await import(artifact.href);
	if (
		!record(loaded) || typeof loaded.composeResponse !== 'function' ||
		!record(loaded.petitions) || typeof loaded.petitions.response !== 'function' ||
		!record(loaded.components) || typeof loaded.components.param !== 'function'
	) {
		throw new TypeError('Vixeny verification artifact lost its selected public compiler/factory exports.');
	}
	return loaded as unknown as Vixeny;
}
