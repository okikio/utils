import * as record from '@okikio/record';

/** Recursively freeze one OpenAPI data graph without invoking accessors or custom object behavior. */
export function freeze<Value>(value: Value, name = 'OpenAPI value'): Value {
	return freezeValue(value, name, new WeakSet<object>());
}

/** Validate and freeze one nested value while rejecting cycles and non-data objects. @internal */
function freezeValue<Value>(value: Value, name: string, path: WeakSet<object>): Value {
	if (typeof value !== 'object' || value === null) return value;
	if (path.has(value)) throw new TypeError(`${name} must not contain circular references.`);
	path.add(value);
	try {
		if (Array.isArray(value)) {
			freezeArray(value, name, path);
			return Object.freeze(value);
		}
		record.assert(value, name);
		for (const [key, nested] of record.entries(value, name)) freezeValue(nested, `${name}.${key}`, path);
		return Object.freeze(value);
	} finally {
		path.delete(value);
	}
}

/** Validate dense array storage through property descriptors before recursing. @internal */
function freezeArray(value: unknown[], name: string, path: WeakSet<object>): void {
	if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${name} arrays must not use symbol properties.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of Object.keys(descriptors)) {
		if (key === 'length') continue;
		if (!/^(0|[1-9]\d*)$/.test(key)) throw new TypeError(`${name} arrays must not use named properties.`);
	}
	for (let index = 0; index < value.length; index++) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined) throw new TypeError(`${name} arrays must be dense.`);
		if (!('value' in descriptor)) throw new TypeError(`${name}[${index}] must be a data property.`);
		freezeValue(descriptor.value, `${name}[${index}]`, path);
	}
}
