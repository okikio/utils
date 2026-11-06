import * as endpoint from './endpoint/mod.ts';
import * as response from '@okikio/http/response';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { create } from './client.ts';
/** Exact operation inputs remain wire types; successful values use the response codec's application type. */
async function inference(): Promise<void> {
	const numeric = codec.define({
		decode: schema.transform(schema.string(), Number),
		encode: schema.transform(schema.number(), String),
	});
	const Route = endpoint.post({
		id: 'typed',
		path: '/typed',
		json: schema.object({ text: schema.string() }),
		responses: [response.ok(numeric, { description: 'Number.' })],
	});
	const caller = create(Route, {
		baseUrl: 'https://local.invalid',
		fetch: () => Response.json('42'),
		maximumDeclarations: 2,
		maximumRequestBytes: 100,
		maximumResponseBytes: 100,
	});
	const value = await caller.call(Route.operations[0], { json: { text: 'wire' } });
	if (value.kind === 'success') {
		const number: number = value.value;
		void number;
	}
	// @ts-expect-error Authored request shape has a string field.
	caller.call(Route.operations[0], { json: { text: 42 } });
	// @ts-expect-error Required JSON input is not optional.
	caller.call(Route.operations[0], {});
	const Head = endpoint.head({
		id: 'typed.head',
		path: '/typed',
		responses: [response.ok(numeric, { description: 'Bodyless number metadata.' })],
	});
	const head = create(Head, {
		baseUrl: 'https://local.invalid',
		fetch: () => new Response(null),
		maximumDeclarations: 2,
		maximumRequestBytes: 100,
		maximumResponseBytes: 100,
	});
	const result = await head.call(Head.operations[0], {});
	if (result.kind === 'success') {
		const absent: undefined = result.value;
		void absent;
	}
}
void inference;
