/** Structural host contracts accepted by Input without requiring realm-global DOM constructors. @module */

/**
 * Use a host's declared native instance type when its constructor exists in that
 * consumer's type environment. Otherwise retain the supplied structural type.
 * This is type-only: importing Input does not add DOM globals to a Node or Worker
 * project, and browser callbacks still receive complete native event types.
 */
export type Native<Name extends string, Fallback = never> = typeof globalThis extends
	{ readonly [Key in Name]: { readonly prototype: infer Instance } } ? Instance : Fallback;

/** Native DOM scopes, including SVG and shadow roots, without imposing DOM globals on other consumers. */
export type NativeTarget = Native<'Window'> | Native<'Document'> | Native<'Element'> | Native<'ShadowRoot'>;

/** Select complete native event fields only for a declared DOM target; mocks keep their explicit fallback. */
export type HostEvent<Target, Name extends string, Fallback> = Target extends NativeTarget ? Native<Name, Fallback>
	: Fallback;

/** Report a failed callback without changing listener ownership or swallowing asynchronous rejections. */
export type ErrorReporter = (error: unknown) => void;

/** Listener options shared by browser targets and small test adapters. */
export interface ListenerOptions {
	/** Observe the capture phase when explicitly selected. */
	readonly capture?: boolean;
	/** Promise not to cancel the host's native default behavior. */
	readonly passive?: boolean;
}

/** Minimum event target needed for listener ownership. Native DOM targets satisfy this contract. */
export interface ListenerTarget {
	/** Attach exactly this listener; event shape is checked by the selected Input capability. */
	addEventListener(type: string, listener: (event: unknown) => void, options?: boolean | ListenerOptions): void;
	/** Detach the same listener and capture mode. */
	removeEventListener(type: string, listener: (event: unknown) => void, options?: boolean | ListenerOptions): void;
}

/** Callable cleanup also usable with explicit resource management. */
export interface BindingHandle extends Disposable {
	/** Release owned listeners and timers exactly once. */
	(): void;
	/** True once explicit disposal or the supplied signal stopped this binding. */
	readonly closed: boolean;
}

/** Event fields needed for key matching. Mocks can omit browser-only metadata. */
export interface KeyEvent {
	/** Logical key produced by the current layout. */
	readonly key: string;
	/** Physical key location, such as KeyQ; optional on small adapters. */
	readonly code?: string;
	/** Native target, possibly from another realm or a small adapter. */
	readonly target?: unknown;
	/** Whether another owner already claimed this event. */
	readonly defaultPrevented?: boolean;
	/** Native modifier states; omitted states are false. */
	readonly ctrlKey?: boolean;
	/** Whether Meta was held; omitted mock state is false. */
	readonly metaKey?: boolean;
	/** Whether Alt was held; omitted mock state is false. */
	readonly altKey?: boolean;
	/** Whether Shift was held; omitted mock state is false. */
	readonly shiftKey?: boolean;
	/** Held-key repeat and IME composition are ignored by default. */
	readonly repeat?: boolean;
	/** An active IME edit suppresses shortcut matching, independently of held-key repeats. */
	readonly isComposing?: boolean;
	/** Original propagation path, needed for shadow-root editable controls. */
	composedPath?(): readonly unknown[];
	/** Claim the native default only after a command or sequence prefix matches. */
	preventDefault(): void;
}

/** Coordinates shared by pointer and touch samples. */
export interface Point {
	/** Horizontal viewport coordinate in CSS pixels. */
	readonly clientX: number;
	/** Vertical viewport coordinate in CSS pixels. */
	readonly clientY: number;
}

/** Minimal pointer event accepted by gesture sessions. */
export interface PointerInput extends Point {
	/** Stable ID of this pointer during its contact. */
	readonly pointerId: number;
	/** Pointer category; browsers normally provide mouse, touch or pen. */
	readonly pointerType?: string;
	/** False identifies a secondary contact. */
	readonly isPrimary?: boolean;
	/** Mouse button number; non-primary mouse buttons are ignored. */
	readonly button?: number;
	/** Optional original host target and propagation path. */
	readonly target?: unknown;
	/** True when another owner already claimed the native default. */
	readonly defaultPrevented?: boolean;
	/** Original host timestamp, when available; elapsed gesture time uses the selected monotonic clock. */
	readonly timeStamp?: number;
	/** Original propagation path used to recognize editing controls inside shadow trees. */
	composedPath?(): readonly unknown[];
	/** Called only when a gesture explicitly opts into canceling native behavior. */
	preventDefault(): void;
}

/** Optional capture capabilities supplied by a pointer surface. */
export interface PointerTarget extends ListenerTarget {
	/** Keep subsequent pointer events routed to this surface while claimed. */
	setPointerCapture?(pointerId: number): void;
	/** Release a previously captured pointer. */
	releasePointerCapture?(pointerId: number): void;
}

/** Small element capabilities used for ownership, without instanceof checks or a required document. */
export interface ElementLike {
	/** Element name used to recognize built-in editing controls without realm constructors. */
	readonly tagName?: string;
	/** Resolved native editing state; an explicit false ends inherited editing lookup. */
	readonly isContentEditable?: boolean;
	/** Borrowed parent used to inspect inherited editing and interaction ownership. */
	readonly parentElement?: unknown;
	/** CSS selector lookup is optional; attribute and parent traversal provide a fallback. */
	closest?(selectors: string): unknown;
	/** Read role/contenteditable policy; null means absent, while an empty attribute can still enable editing. */
	getAttribute?(name: string): string | null;
}
