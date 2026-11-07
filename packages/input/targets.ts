/** Realm-independent inspection of the small element capabilities used by Input. @module */
import type { ElementLike } from './types.ts';

/** Admit non-null objects for capability checks without requiring a global Element constructor. */
export function object(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Inspect the dispatch path when the host supplies it. Keep the reported
 * target as a candidate even if the host omits it from that path. Outside
 * dispatch, a native path can be empty; the target may be the only evidence.
 */
export function path(event: { readonly target?: unknown; composedPath?(): readonly unknown[] }): readonly unknown[] {
	if (typeof event.composedPath === 'function') {
		const values = event.composedPath();
		if (values.length > 0) {
			return event.target !== undefined && event.target !== null && !values.includes(event.target)
				? [event.target, ...values]
				: values;
		}
	}
	return event.target === undefined || event.target === null ? [] : [event.target];
}

/** Decide whether an unknown value exposes element-like inspection, including small mock elements. */
export function element(value: unknown): value is ElementLike {
	return object(value) && (typeof value.closest === 'function' || typeof value.getAttribute === 'function' ||
		typeof value.tagName === 'string' || 'parentElement' in value);
}

/** Read a native or mock attribute when the capability is present. */
function attribute(value: ElementLike, name: string): string | null {
	return typeof value.getAttribute === 'function' ? value.getAttribute(name) : null;
}

/** Editable and composite controls retain native editing and navigation behavior. */
export function editing(target: unknown): boolean {
	const visited = new Set<object>();
	for (let current = target; element(current) && !visited.has(current); current = current.parentElement) {
		visited.add(current);
		const tag = current.tagName?.toLowerCase();
		if (tag !== undefined && ['input', 'textarea', 'select'].includes(tag)) return true;
		const role = attribute(current, 'role');
		if (role !== null && ['combobox', 'menu', 'listbox', 'textbox', 'searchbox'].includes(role)) return true;
		if (
			typeof current.closest === 'function' &&
			current.closest(
				'input,textarea,select,[role=combobox],[role=menu],[role=listbox],[role=textbox],[role=searchbox]',
			)
		) return true;
		if (current.isContentEditable === true) return true;
		// An explicit false stops inherited editability; climbing farther would claim a native editing boundary.
		const editable = attribute(current, 'contenteditable');
		if (editable !== null) return editable.toLowerCase() !== 'false';
		if (current.isContentEditable === false) return false;
		if (typeof current.closest === 'function' && current.closest('[contenteditable]:not([contenteditable="false"])')) {
			return true;
		}
	}
	return false;
}

/** Navigation gestures leave native interactive controls and composite grids alone. */
export function interactive(target: unknown): boolean {
	if (!element(target)) return false;
	if (editing(target)) return true;
	const tag = target.tagName?.toLowerCase();
	if (tag !== undefined && ['button', 'a', 'summary'].includes(tag)) return true;
	return typeof target.closest === 'function' &&
		Boolean(target.closest('button,a,summary,[role=button],[role=grid],[role=slider]'));
}

/** Visible dialogs suppress global shortcuts when the supplied host exposes document queries. */
export function modal(target: unknown): boolean {
	const document = object(target) && object(target.document) ? target.document : target;
	if (!object(document) || typeof document.querySelectorAll !== 'function') return false;
	const matches: unknown = Reflect.apply(document.querySelectorAll, document, [
		'[role=dialog],[role=alertdialog],dialog[open]',
	]);
	if (!iterable(matches)) return false;
	for (const value of matches) {
		if (object(value) && typeof value.getClientRects === 'function') {
			const rects: unknown = Reflect.apply(value.getClientRects, value, []);
			if (object(rects) && typeof rects.length === 'number' && rects.length > 0) return true;
		}
	}
	return false;
}

/** Only iterate a host query result after checking its actual iteration capability. */
function iterable(value: unknown): value is Iterable<unknown> {
	return object(value) && typeof value[Symbol.iterator] === 'function';
}
