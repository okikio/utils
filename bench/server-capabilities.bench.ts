/** Real loopback client boundaries and read-only routing evidence use the existing compiler and router. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '#tools/bench/run.ts';
import * as client from '@okikio/server/client';
import * as endpoint from '@okikio/server/endpoint';
import * as service from '@okikio/server/service';
import * as router from '@okikio/server/http/router';
import * as response from '@okikio/http/response';
import { readBytes } from '@okikio/http/response/body';
import * as schema from '@okikio/schema';
await using owners = new AsyncDisposableStack();
for (const size of [1024, 1048576]) {
	const ValueSchema = schema.object({ text: schema.string() });
	const Output = response.ok(ValueSchema, { description: 'Echo payload.' });
	const Route = endpoint.post({ id: `echo-${size}`, path: '/echo', json: ValueSchema, responses: [Output] });
	const Api = service.define({ id: `echo-${size}`, path: '/', endpoints: [Route] });
	const compiled = service.compile(
		service.implement(Api, {
			endpoints: [endpoint.handler(Route, ({ input }) => response.create(Output, input.json))],
		}),
	);
	const runtime = owners.use(service.create(compiled, { host: {} }));
	const options = {
		baseUrl: 'https://local.invalid',
		fetch: runtime.fetch,
		maximumDeclarations: 10,
		maximumRequestBytes: size + 1024,
		maximumResponseBytes: size + 1024,
	};
	const caller = client.create(Route, options), payload = { text: 'x'.repeat(size) };
	const oracle = await caller.call(Route.operations[0], { json: payload });
	if (oracle.kind !== 'success' || oracle.value.text !== payload.text) {
		throw new Error('Client loopback oracle failed.');
	}
	const manual = async function (): Promise<unknown> {
		await schema.parse(ValueSchema, payload);
		const native = await runtime.fetch(
			new Request('https://local.invalid/echo', {
				method: 'POST',
				body: JSON.stringify(payload),
				headers: { 'content-type': 'application/json' },
				redirect: 'manual',
				credentials: 'omit',
			}),
		);
		if (native.status !== 200 || native.headers.get('content-type')?.split(';')[0] !== 'application/json') {
			throw new Error('Manual reference protocol failure.');
		}
		return await schema.parse(ValueSchema, JSON.parse(new TextDecoder().decode(await readBytes(native, size + 1024))));
	};
	if ((await manual() as { text: string }).text !== payload.text) throw new Error('Manual reference oracle failed.');
	group(`client real service loopback ${size} text code units`, () => {
		bench('client construction without IO', () => do_not_optimize(client.create(Route, options)));
		bench(
			'typed client bounded call',
			async () => do_not_optimize(await caller.call(Route.operations[0], { json: payload })),
		);
		bench('manual fetch same validators and body bound', async () => do_not_optimize(await manual()));
		bench('existing compiled document identity read', () => do_not_optimize(service.document(compiled)));
	});
}
for (const count of [10, 100, 1000]) {
	const plan = router.prepare(
		Array.from({ length: count }, (_, index) => ({ kind: 'route' as const, method: 'GET', path: `/items/${index}` })),
	);
	const bounds = { maximumRoutes: count, maximumComparisons: count * (count - 1) / 2, maximumOverlaps: count };
	if (router.inspect(plan, bounds).overlaps.length) throw new Error('Disjoint route oracle failed.');
	group(`route diagnostic ${count} disjoint routes`, () => {
		bench('complete bounded overlap pair scan', () => do_not_optimize(router.inspect(plan, bounds)));
		bench(
			'one real indexed match, smaller contract',
			() => do_not_optimize(router.matchRoute(plan, 'GET', '/items/0')),
		);
	});
}
await run();
