/** Execute the physically installed npm projection in both claimed Node module formats. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { lstat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);

// Each probe starts before any utility import, so module caches cannot hide a missing-global or ownership bug.
for (const commonJS of [false, true]) {
	const load = commonJS ? 'async (name) => require(name)' : '(name) => import(name)';
	const setup = commonJS
		? "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
		: '';
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
			assert.equal(duration.milliseconds({ seconds: 2, milliseconds: 250 }), 2250);
			assert.equal(duration.milliseconds({ months: 1 }), 31 * 86400000);
			assert.equal(duration.compare({ months: 1 }, { days: 31 }), 0);
			assert.equal(duration.compare({ microseconds: 1 }, { nanoseconds: 999 }), 1);
		`,
		], { cwd: new URL('./', import.meta.url), timeout: 30000, stdio: 'pipe' });
	}
}
console.log(
	'Fresh ESM and CommonJS Temporal probes preserved native globals and enabled missing-global duration/calendar behavior.',
);

// Direct disposal APIs must remain pure before the explicit installer is ever loaded.
for (const commonJS of [false, true]) {
	const setup = commonJS
		? "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
		: '';
	const load = commonJS ? 'async (name) => require(name)' : '(name) => import(name)';
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
	'Fresh ESM and CommonJS disposal roots/ponyfill preserved globals and passed native, missing-global and local-key ownership probes.',
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
	const cjs = require(specifier);
	assert.deepEqual(
		Object.keys(esm).sort(),
		Object.keys(cjs).filter((name) => name !== '__esModule').sort(),
		`${specifier} module formats disagree`,
	);
}
for (const load of [async (name) => import(name), async (name) => require(name)]) {
	const result = await load('@okikio/result');
	assert.equal(result.unwrap(result.ok('asset-42')), 'asset-42');
	assert.equal(result.getOr(result.fail('missing'), 'fallback'), 'fallback');
	const umbrella = await load('@okikio/utils/result');
	assert.equal(umbrella.unwrap(umbrella.ok(42)), 42);
	const duration = await load('@okikio/duration');
	assert.equal(duration.milliseconds('PT2.5S'), 2500);
	const csv = await load('@okikio/csv');
	const document = csv.parse('name,description\nasset,"line one\n雪,quote"\n', { headerRow: 1 });
	assert.deepEqual(document.rows[0].values, ['asset', 'line one\n雪,quote']);
	const process = await load('@okikio/process');
	const adapter = await load('@okikio/process/node');
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
		'@okikio/deno',
		'@okikio/utils/deno',
		'@okikio/utils/process/deno',
		'@okikio/process/deno',
		'@okikio/worker/deno',
	]
) {
	await assert.rejects(
		import(specifier),
		(error) => ['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code),
	);
}
console.log(
	`Executed ${paths.length} public subpaths through ESM and CommonJS plus data, result, duration and child-process behavior.`,
);
