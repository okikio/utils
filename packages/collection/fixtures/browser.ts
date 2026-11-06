/** Same-origin iframe records exercise actual foreign intrinsics, not prototype lookalikes. @module */
import * as record from '../record/mod.ts';
import * as json from '../record/json.ts';
import * as schema from '@okikio/schema';

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Admit foreign ordinary records while preserving the data-only rejection contract. */
export async function verify(): Promise<readonly string[]> {
	const frame = document.createElement('iframe');
	frame.hidden = true;
	const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
	frame.srcdoc = '<!doctype html><script>globalThis.recordClass = new class Item { id = "job" };</script>';
	document.body.append(frame);
	try {
		await loaded;
		// A same-origin Window supplies that realm's JavaScript intrinsics as well as DOM members.
		const realm = frame.contentWindow as Window & typeof globalThis;
		assert(realm !== null, 'The iframe did not expose its same-origin Window.');
		const input: unknown = realm.JSON.parse(
			'{"id":"job","tags":["a"],"meta":{"attempt":1},"__proto__":{"owned":true},"constructor":"data"}',
		);
		assert(Object.getPrototypeOf(input) !== Object.prototype, 'The fixture lost its foreign object identity.');
		assert(record.is(input), 'A foreign ordinary data record was rejected.');
		record.assert(input);
		const snapshot = record.snapshot(input);
		assert(Object.getPrototypeOf(snapshot) === null, 'The outer snapshot retained a foreign prototype.');
		assert(record.keys(snapshot).length === 5, 'The snapshot dropped an own field.');
		assert(
			Object.hasOwn(snapshot, '__proto__') &&
				Object.getOwnPropertyDescriptor(snapshot, 'constructor')?.value === 'data',
			'Prototype-shaped fields did not remain own data.',
		);

		const copied = json.copy(input);
		assert(record.is(copied), 'The copied JSON root is not a data record.');
		assert(Object.getPrototypeOf(copied) === null && copied.meta !== input.meta, 'JSON copy retained an input record.');
		assert(Array.isArray(copied.tags) && copied.tags !== input.tags, 'JSON copy retained the foreign input array.');
		assert(record.is(input.meta), 'The authored nested record is missing.');
		Reflect.set(input.meta, 'attempt', 2);
		assert(record.is(copied.meta) && copied.meta.attempt === 1, 'JSON copy still aliases a foreign nested record.');

		const validator = schema.object({ id: schema.string(), tags: schema.array(schema.string()) }, {
			unknownKeys: 'preserve',
		});
		const parsed = validator.parse(input);
		assert(parsed.id === 'job' && parsed.tags[0] === 'a', 'Schema lost declared foreign-record values.');
		assert(
			Object.hasOwn(parsed, 'meta') && Object.hasOwn(parsed, '__proto__') &&
				Object.getOwnPropertyDescriptor(parsed, 'constructor')?.value === 'data',
			'Schema preserve policy lost foreign own fields.',
		);
		assert(Object.getPrototypeOf(parsed) === null, 'Schema output adopted the foreign prototype.');
		assert(record.is(schema.json().parse(input)), 'The JSON schema rejected the foreign record.');

		let reads = 0;
		const accessor: object = realm.JSON.parse('{"id":"job","tags":[]}');
		Object.defineProperty(accessor, 'extra', {
			enumerable: true,
			get() {
				reads++;
				return 'hidden work';
			},
		});
		const hidden: object = realm.JSON.parse('{"id":"job","tags":[]}');
		Object.defineProperty(hidden, 'extra', { value: 1 });
		const symbol: object = realm.JSON.parse('{"id":"job","tags":[]}');
		Object.defineProperty(symbol, Symbol('extra'), { value: 1, enumerable: true });
		for (const value of [Reflect.get(realm, 'recordClass'), accessor, hidden, symbol]) {
			assert(!record.is(value), 'A foreign class or non-data field was accepted.');
			for (const read of [() => record.assert(value), () => json.copy(value), () => validator.parse(value)]) {
				let rejected = false;
				try {
					read();
				} catch (error) {
					rejected = error instanceof TypeError || error instanceof schema.SchemaValidationError;
				}
				assert(rejected, 'A foreign non-data value escaped a data validator.');
			}
		}
		assert(reads === 0, 'Foreign own-property validation invoked an accessor.');
		return [
			'collection actual iframe ordinary records and own-field retention',
			'collection foreign nested JSON copy has independent local containers',
			'schema foreign data input with preserve policy and JSON validation',
			'collection and schema reject foreign classes, accessors, hidden and symbol properties',
		];
	} finally {
		frame.remove();
	}
}
