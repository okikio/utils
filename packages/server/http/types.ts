/** Fetch-compatible HTTP handler used by framework-neutral server composition. */
export type Handler = (request: Request) => Response | Promise<Response>;

/** Onion-style continuation used by framework-neutral HTTP middleware. */
export type Next = Handler;

/** Fetch-compatible middleware that can inspect or replace the request and response. */
export type Middleware = (request: Request, next: Next) => Response | Promise<Response>;

/** Exact method/path route owned by one framework-neutral HTTP application. @internal */
interface ExactRouteType {
	readonly kind: 'route';
	readonly method: string;
	readonly path: string;
	readonly handler: Handler;
}

/** Prefix-mounted Fetch handler owned by one framework-neutral HTTP application. @internal */
interface MountRouteType {
	readonly kind: 'mount';
	readonly path: string;
	readonly handler: Handler;
}

/** Route or mounted handler owned by one framework-neutral HTTP application. */
export type RouteType = ExactRouteType | MountRouteType;

/** Options used to create one framework-neutral HTTP application. */
export interface CreateOptionsType {
	readonly routes?: readonly RouteType[];
	readonly middleware?: readonly Middleware[];
	readonly notFound?: Handler;
}

/** Fetch-compatible HTTP application assembled from explicit routes and middleware. */
export interface App {
	readonly routes: readonly RouteType[];
	readonly fetch: Handler;
}

/** Outcome returned by a readiness probe. */
export interface ReadinessType {
	readonly ready: boolean;
	readonly detail?: string;
	readonly checks?: Readonly<Record<string, boolean>>;
}

/** Request metadata common to access observation events. @internal */
interface AccessBaseType {
	readonly request: Request;
	readonly method: string;
	readonly pathname: string;
}

/** Request-start observation. @internal */
interface AccessStartType extends AccessBaseType {
	readonly kind: 'start';
}

/** Response-created observation. This does not mean a streamed body finished delivery. @internal */
interface AccessResponseType extends AccessBaseType {
	readonly kind: 'response';
	readonly durationMs: number;
	readonly status: number;
}

/** Request failure observed before a Response was created. @internal */
interface AccessFailureType extends AccessBaseType {
	readonly kind: 'failed';
	readonly durationMs: number;
	readonly error: Error;
}

/** Structured event emitted by access observation middleware. */
export type AccessEventType = AccessStartType | AccessResponseType | AccessFailureType;
