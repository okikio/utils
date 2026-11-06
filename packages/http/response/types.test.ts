import * as schema from '@okikio/schema';
import { DateSchema } from '@okikio/schema/time';
import * as response from './mod.ts';

/** Compile-time consumer fixture for constructible versus recognized redirect statuses. */
function redirectStatusContract(): void {
	const supported = response.redirect(308, { description: 'Permanent redirect.' });
	const status: 308 = supported.status;
	void status;

	// Historical statuses remain recognizable on the wire even when this utility
	// deliberately refuses to construct a new response with them.
	const recognized: boolean = response.redirectStatus.is(305) && response.redirectStatus.is(306);
	void recognized;

	// @ts-expect-error 305 Use Proxy is deprecated and is not constructible.
	response.redirect(305, { description: 'Deprecated redirect.' });
}

void redirectStatusContract;

/** Compile-time fixture proving custom pagination callbacks retain the page variant. */
function paginationContract(): void {
	const page = {
		kind: 'offset' as const,
		items: ['a', 'b'],
		offset: 0,
		limit: 2,
		hasMore: true,
	};
	response.pageLinks(page, '/items', {}, ({ page: snapshot }) => {
		const offset: number = snapshot.offset;
		void offset;

		// The callback observes the normalized snapshot, not the caller-owned mutable array.
		// @ts-expect-error Normalized page items are readonly inside the callback.
		snapshot.items.push('changed');
		return undefined;
	});
}

void paginationContract;

/** Response constructors retain selected modes and separate schema input from output. */
async function directionalContracts(): Promise<void> {
	const text = schema.string();
	const page = response.define({ id: 'typed-page', status: 200, description: 'Text.', mode: 'page', schema: text });
	const mode: 'page' = page.mode;
	void mode;
	response.create(page, { kind: 'offset', items: ['a'], offset: 0, limit: 1, hasMore: false });
	// @ts-expect-error A page mode requires a page window, not its item type.
	response.create(page, 'a');
	const empty = response.define({ id: 'typed-empty', status: 204, description: 'Empty.', mode: 'empty' });
	response.create(empty, undefined);
	// @ts-expect-error Empty responses cannot accept a body.
	response.create(empty, 'unexpected');
	const transformed = response.ok(schema.transform(text, (value) => value.length), { description: 'Length.' });
	const prepared = await response.prepare(response.create(transformed, 'hello'));
	const length: number = prepared[0];
	void length;
	// @ts-expect-error Handlers supply the schema input, not its converted output.
	response.create(transformed, 5);
	const timestamp = response.ok(DateSchema, { description: 'Timestamp.' });
	const encoded = await response.prepare(response.create(timestamp, new Date()));
	const wire: string = encoded[0];
	void wire;
	// @ts-expect-error A codec response accepts application values for its encoder.
	response.create(timestamp, '2026-01-01T00:00:00Z');
}
void directionalContracts;
