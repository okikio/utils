/** Execute the physically installed npm projection through the supported Node ESM entrypoints. */
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Provider startup must also work from the packed artifacts, not only TypeScript source.
{
	execFileSync(process.execPath, [
		'--input-type=module',
		'-e',
		`
		import assert from 'node:assert/strict';
				import { createServer } from 'node:http';
		import { once } from 'node:events';
				const load = name => import(name);
		const telemetry = await load('@okikio/telemetry/node');
		const instrument = await load('@okikio/telemetry/instrument');
		assert.equal(instrument.noop.capture(), undefined);
		const logtape = await load('@logtape/logtape');
		const records = [];
		const server = createServer(async (request, response) => {
			const parts = [];
			for await (const part of request) parts.push(part);
			records.push(JSON.parse(Buffer.concat(parts).toString('utf8')));
			response.setHeader('content-type', 'application/json');
			response.end('{}');
		});
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const collection = await telemetry.open({ service: 'packed',
			endpoint: 'http://127.0.0.1:' + server.address().port, traces: { sample: 1 } });
		try {
			await logtape.configure({ sinks: { otlp: collection.sink }, contextLocalStorage: collection.storage,
				loggers: [{ category: ['packed'], lowestLevel: 'info', sinks: ['otlp'] },
					{ category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] }] });
			assert.equal(instrument.get({ instrument: collection.instrument }), collection.instrument);
			await collection.instrument.span('packed.save', {}, async () => logtape.getLogger(['packed']).info('saved'));
		} finally {
			await logtape.reset();
			await collection.close();
			server.closeAllConnections();
			await new Promise(resolve => server.close(resolve));
		}
		const spans = records.flatMap(data => data.resourceSpans ?? []).flatMap(data => data.scopeSpans).flatMap(data => data.spans);
		const logs = records.flatMap(data => data.resourceLogs ?? []).flatMap(data => data.scopeLogs).flatMap(data => data.logRecords);
		assert.equal(spans.length, 1);
		assert.equal(logs.length, 1);
		assert.equal(logs[0].traceId, spans[0].traceId);
		assert.equal(collection.errors, 0);
	`,
	], { cwd: new URL('./', import.meta.url), timeout: 30000, stdio: 'pipe' });
}
console.log('Packed ESM collection exported correlated LogTape logs and spans.');

// Each probe starts before any utility import, so module caches cannot hide a missing-global or ownership bug.
{
	const load = '(name) => import(name)';
	const setup = '';
	for (const missing of [false, true]) {
		execFileSync(process.execPath, [
			'--input-type=module',
			'-e',
			`
			import assert from 'node:assert/strict';
			${setup}
			const load = ${load};
			const original = globalThis.Temporal;
			${missing ? 'delete globalThis.Temporal;' : "assert.equal(typeof original?.Instant?.from, 'function');"}
			const before = globalThis.Temporal;
			const { Temporal: local } = await load('@okikio/duration/temporal');
			assert.equal(globalThis.Temporal, before);
			assert.equal(local.Instant.from('2026-01-01T00:00:00Z').add({ seconds: 2 }).toString(), '2026-01-01T00:00:02Z');
			assert.equal(local.PlainDate.from('2026-01-01').withCalendar('hebrew').calendarId, 'hebrew');
			await load('@okikio/duration/polyfill');
			assert.equal(globalThis.Temporal, ${missing ? 'local' : 'original'});
			const duration = await load('@okikio/duration');
			assert.equal(duration.elapsed({ seconds: 2, milliseconds: 250 }), 2250);
			assert.throws(() => duration.elapsed({ months: 1 }), RangeError);
			assert.equal(duration.total({ months: 1 }, 'days', { relativeTo: '2024-02-01' }), 29);
			assert.throws(() => duration.compare({ months: 1 }, { days: 29 }), RangeError);
			assert.equal(duration.compare({ months: 1 }, { days: 29 }, { relativeTo: '2024-02-01' }), 0);
			assert.equal(duration.compare({ microseconds: 1 }, { nanoseconds: 999 }), 1);
		`,
		], { cwd: new URL('./', import.meta.url), timeout: 30000, stdio: 'pipe' });
	}
}
console.log(
	'Fresh ESM Temporal probes preserved native globals and enabled missing-global duration/calendar behavior.',
);

// Direct disposal APIs must remain pure before the explicit installer is ever loaded.
{
	const setup = '';
	const load = '(name) => import(name)';
	for (const mode of ['native', 'missing', 'local-keys']) {
		execFileSync(process.execPath, [
			'--input-type=module',
			'-e',
			`
			import assert from 'node:assert/strict';
			${setup}
			const load = ${load};
			const names = ['DisposableStack', 'AsyncDisposableStack', 'SuppressedError'];
			if (${JSON.stringify(mode)} !== 'native') for (const name of names) delete globalThis[name];
			if (${JSON.stringify(mode)} === 'local-keys') {
				const native = Symbol;
				function LegacySymbol(description) { return native(description); }
				for (const name of Reflect.ownKeys(native)) {
					if (!['dispose', 'asyncDispose', 'length', 'name', 'prototype'].includes(name)) {
						Object.defineProperty(LegacySymbol, name, Object.getOwnPropertyDescriptor(native, name));
					}
				}
				LegacySymbol.prototype = native.prototype;
				globalThis.Symbol = LegacySymbol;
			}
			const before = names.map(name => globalThis[name]);
			const symbols = [Symbol.dispose, Symbol.asyncDispose];
			const globalDescriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
			const symbolNames = ['dispose', 'asyncDispose'];
			const symbolDescriptors = symbolNames.map(name => Object.getOwnPropertyDescriptor(Symbol, name));
			const api = await load('@okikio/dispose/ponyfill');
			const root = await load('@okikio/dispose');
			const umbrella = await load('@okikio/utils/dispose/ponyfill');
			const umbrellaRoot = await load('@okikio/utils/dispose');
			assert.deepEqual(names.map(name => globalThis[name]), before);
			assert.deepEqual([Symbol.dispose, Symbol.asyncDispose], symbols);
			assert.deepEqual(names.map(name => Object.getOwnPropertyDescriptor(globalThis, name)), globalDescriptors);
			assert.deepEqual(symbolNames.map(name => Object.getOwnPropertyDescriptor(Symbol, name)), symbolDescriptors);
			for (const exported of [root, umbrella, umbrellaRoot]) assert.equal(exported.DisposableStack, api.DisposableStack);
			const order = [];
			const stack = new api.DisposableStack();
			stack.use({ [api.dispose]() { order.push('resource'); } });
			stack.defer(() => { order.push('callback'); });
			const moved = stack.move(); stack.dispose();
			assert.deepEqual(order, []); assert.equal(stack.disposed, true);
			assert.throws(() => stack.defer(() => {}), ReferenceError);
			moved.dispose(); moved.dispose(); assert.deepEqual(order, ['callback', 'resource']);
			const failing = new api.DisposableStack(); const current = new Error('cleanup');
			failing.defer(() => { throw current; }); failing.defer(() => { throw undefined; });
			assert.throws(() => failing.dispose(), error => error instanceof api.SuppressedError && error.error === current && error.suppressed === undefined);
			const error = api.SuppressedError(1, undefined);
			assert.ok(error instanceof Error); assert.ok(error instanceof api.SuppressedError);
			assert.equal(Object.getOwnPropertyDescriptor(error, 'error').enumerable, false);
			class Derived extends api.SuppressedError {} assert.ok(new Derived(1, 2) instanceof Derived);
			const async = new api.AsyncDisposableStack();
			async.defer(() => { order.push('older'); });
			async.use({ async [api.asyncDispose]() { await Promise.resolve(); order.push('awaited'); } });
			const movedAsync = async.move();
			await async.disposeAsync(); assert.deepEqual(order, ['callback', 'resource']);
			assert.equal(async.disposed, true); assert.equal(movedAsync.disposed, false);
			assert.throws(() => async.defer(() => {}), ReferenceError);
			await movedAsync.disposeAsync(); await movedAsync.disposeAsync();
			assert.deepEqual(order, ['callback', 'resource', 'awaited', 'older']);
			const asyncOrder = [];
			const undefinedAsync = new api.AsyncDisposableStack();
			undefinedAsync.defer(() => { asyncOrder.push('older'); });
			undefinedAsync.defer(async () => { await Promise.resolve(); asyncOrder.push('newer'); throw undefined; });
			let rejected = false; let rejectedValue;
			try { await undefinedAsync.disposeAsync(); } catch (error) { rejected = true; rejectedValue = error; }
			assert.equal(rejected, true); assert.equal(rejectedValue, undefined);
			assert.equal(undefinedAsync.disposed, true); assert.deepEqual(asyncOrder, ['newer', 'older']);
			const chainedAsync = new api.AsyncDisposableStack(); const chainOrder = [];
			chainedAsync.defer(async () => { await Promise.resolve(); chainOrder.push('older'); throw current; });
			chainedAsync.defer(async () => { await Promise.resolve(); chainOrder.push('newer'); throw undefined; });
			await assert.rejects(chainedAsync.disposeAsync(), error => error instanceof api.SuppressedError && error.error === current && error.suppressed === undefined);
			assert.deepEqual(chainOrder, ['newer', 'older']);
			assert.throws(() => new api.AsyncDisposableStack().use({ [api.asyncDispose]: 1, [api.dispose]() {} }), TypeError);
			let assimilated = false;
			const fallback = new api.AsyncDisposableStack();
			fallback.use({ [api.dispose]() { return { then() { assimilated = true; } }; } });
			await fallback.disposeAsync(); assert.equal(assimilated, false);
			await load('@okikio/dispose/polyfill');
			assert.deepEqual(names.map(name => globalThis[name]), ${
				JSON.stringify(mode)
			} === 'native' ? before : names.map(name => api[name]));
			assert.equal(Symbol.dispose, api.dispose); assert.equal(Symbol.asyncDispose, api.asyncDispose);
			if (${JSON.stringify(mode)} === 'native') {
				assert.deepEqual(names.map(name => Object.getOwnPropertyDescriptor(globalThis, name)), globalDescriptors);
				assert.deepEqual(symbolNames.map(name => Object.getOwnPropertyDescriptor(Symbol, name)), symbolDescriptors);
			}
		`,
		], { cwd: new URL('./', import.meta.url), timeout: 30000, stdio: 'pipe' });
	}
}
console.log(
	'Fresh ESM disposal roots/ponyfill preserved globals and passed native, missing-global and local-key ownership probes.',
);

await import('@okikio/dispose/polyfill');
await import('@okikio/duration/polyfill');
const paths = JSON.parse(await readFile(new URL('./paths.json', import.meta.url), 'utf8'));
for (const specifier of paths) {
	assert.equal(
		(await lstat(new URL(`./node_modules/${specifier.split('/').slice(0, 2).join('/')}`, import.meta.url)))
			.isSymbolicLink(),
		false,
	);
	const esm = await import(specifier);
	assert.equal(typeof esm, 'object', `${specifier} must import as a module namespace`);
}
for (const load of [async (name) => import(name)]) {
	const result = await load('@okikio/result');
	assert.equal(result.unwrap(result.ok('asset-42')), 'asset-42');
	assert.equal(result.getOr(result.fail('missing'), 'fallback'), 'fallback');
	const umbrella = await load('@okikio/utils/result');
	assert.equal(umbrella.unwrap(umbrella.ok(42)), 42);
	const duration = await load('@okikio/duration');
	assert.equal(duration.elapsed('PT2.5S'), 2500);
	const csv = await load('@okikio/format/csv');
	const document = csv.parse('name,description\nasset,"line one\n雪,quote"\n', { headerRow: 1 });
	assert.deepEqual(document.rows[0].values, ['asset', 'line one\n雪,quote']);
	const process = await load('@okikio/worker/process');
	const adapter = await load('@okikio/runtime/node/process');
	const context = await load('@okikio/context');
	const ctx = context.create({ id: 'npm-consumer' });
	try {
		const value = await process.exec(ctx, adapter.create(), {
			command: globalThis.process.execPath,
			arguments: ['-e', 'console.log("owned-child")'],
			stdout: { type: 'capture', maximumBytes: 1024 },
			stderr: { type: 'capture', maximumBytes: 1024 },
		});
		assert.equal(value.success, true);
		assert.equal(new TextDecoder().decode(value.stdout).trim(), 'owned-child');
	} finally {
		await ctx[Symbol.asyncDispose]();
	}
}
const all = await import('@okikio/utils/all');
assert.equal('deno' in all, false);
for (
	const specifier of [
		'@okikio/runtime/deno',
		'@okikio/utils/runtime/deno',
		'@okikio/utils/runtime/deno/process',
		'@okikio/runtime/deno/process',
		'@okikio/runtime/deno/worker',
	]
) {
	await assert.rejects(
		import(specifier),
		(error) => ['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code),
	);
}
console.log(
	`Executed ${paths.length} public subpaths through ESM plus data, result, duration and child-process behavior.`,
);
