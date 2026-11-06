/** Shared ordinary-record prototype classification; never reads user accessors. @module */

const functionSource = Function.prototype.toString;
const objectSource = functionSource.call(Object);

/**
 * Accept this realm's ordinary prototype, null, or another realm's Object.prototype.
 * The foreign constructor and its prototype are inspected as own data descriptors.
 * This is a data-shape check; Proxy inspection can execute traps.
 * @internal
 */
export function hasOrdinaryPrototype(value: object): boolean {
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype === null || prototype === Object.prototype) return true;
	if (Object.getPrototypeOf(prototype) !== null) return false;
	const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
	if (constructor === undefined || !('value' in constructor) || typeof constructor.value !== 'function') return false;
	if (functionSource.call(constructor.value) !== objectSource) return false;
	const owner = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
	return owner !== undefined && 'value' in owner && owner.value === prototype;
}
