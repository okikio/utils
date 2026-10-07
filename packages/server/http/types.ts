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

/** Controls which pathname a mounted child Fetch handler receives. */
export interface MountOptions {
	/** Whether a prefix mount preserves the request pathname or strips its matched prefix. */
	readonly requestPath?: 'preserve' | 'strip-prefix';
}

/** Prefix-mounted Fetch handler owned by one framework-neutral HTTP application. @internal */
interface MountRouteType {
	readonly kind: 'mount';
	readonly path: string;
	readonly handler: Handler;
	readonly requestPath: 'preserve' | 'strip-prefix';
}

/** Route or mounted handler owned by one framework-neutral HTTP application. */
export type RouteType = ExactRouteType | MountRouteType;

/** Handler-free route description retained by a compiler or deployment artifact. */
export type RoutePlanInput =
	| Readonly<{ readonly kind: 'route'; readonly method: string; readonly path: string }>
	| Readonly<{ readonly kind: 'mount'; readonly path: string }>;

/** Immutable handler-free route plan prepared before request dispatch. */
export interface RoutePlan {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'http-route-plan';
	/** Authored or compiled route entries retained by this application or manifest. */
	readonly routes: readonly RoutePlanInput[];
}

/** Options used to create one framework-neutral HTTP application. */
export interface CreateOptionsType {
	/** Authored or compiled route entries retained by this application or manifest. */
	readonly routes?: readonly RouteType[];
	/** Declared middleware contributions or their compiled placement plan. */
	readonly middleware?: readonly Middleware[];
	/** Fetch-compatible handler used when no route matches the request. */
	readonly notFound?: Handler;
	/** Optional compiler-produced plan. Every authored route must bind to it exactly. */
	readonly plan?: RoutePlan;
}

/** Fetch-compatible HTTP application assembled from explicit routes and middleware. */
export interface App {
	/** Authored or compiled route entries retained by this application or manifest. */
	readonly routes: readonly RouteType[];
	/** Fetch-compatible request entry; its host owns listeners and transport shutdown. */
	readonly fetch: Handler;
}

/** Outcome returned by a readiness probe. */
export interface ReadinessType {
	/** Whether the probe reports that this application can accept useful work. */
	readonly ready: boolean;
	/** Human-readable explanation of this occurrence or readiness result. */
	readonly detail?: string;
	/** Named readiness outcomes returned by the explicit probe. */
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
