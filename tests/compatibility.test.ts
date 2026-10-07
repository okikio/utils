import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);

/** Run missing-global probes in a fresh instance of the current native runtime. */
async function probe(source: string): Promise<void> {
	const deno = 'Deno' in globalThis;
	const executable = deno ? Deno.execPath() : process.execPath;
	const args = deno ? ['eval', source] : ['--input-type=module', '-e', source];
	await exec(executable, args, { cwd: new URL('../', import.meta.url), timeout: 30_000 });
}

function module(path: string): string {
	return JSON.stringify(new URL(`../packages/${path}`, import.meta.url).href);
}

test('Temporal ponyfill works without installing a global', async () => {
	await probe(`
		delete globalThis.Temporal;
		const { Temporal } = await import(${module('duration/temporal.ts')});
		if (globalThis.Temporal !== undefined) throw new Error('Ponyfill installed a global');
		const instant = Temporal.Instant.from('2026-01-01T00:00:00Z').add({ seconds: 2 });
		if (instant.toString() !== '2026-01-01T00:00:02Z') throw new Error('Instant arithmetic failed');
	`);
});

test('explicit Temporal polyfill enables duration, clocks, queue expiry and workflow imports on a missing-global host', async () => {
	await probe(`
		delete globalThis.Temporal;
		await import(${module('duration/polyfill.ts')});
		const duration = await import(${module('duration/mod.ts')});
		const context = await import(${module('context/mod.ts')});
		const queue = await import(${module('queue/mod.ts')});
		await import(${module('workflow/mod.ts')});
		if (duration.milliseconds('PT2.5S') !== 2500) throw new Error('Duration conversion failed');
		const clock = new context.TestClock();
		const ctx = context.create({ id: 'compatibility', clock });
		const jobs = queue.memory({ clock });
		try {
			await jobs.add(ctx, 'work');
			const [first] = await jobs.claim(ctx, { owner: 'a', duration: { seconds: 1 } });
			clock.advance({ seconds: 2 });
			const [second] = await jobs.claim(ctx, { owner: 'b' });
			if (!first || !second || second.attempt !== 2 || first.id === second.id) throw new Error('Expiry recovery failed');
		} finally {
			await jobs.close();
			await ctx[Symbol.asyncDispose]();
		}
	`);
});

test('Temporal polyfill preserves a pre-existing host implementation', async () => {
	await probe(`
		const existing = Object.freeze({ host: true });
		globalThis.Temporal = existing;
		await import(${module('duration/polyfill.ts')});
		if (globalThis.Temporal !== existing) throw new Error('Host implementation was replaced');
	`);
});

test('disposal polyfill preserves thrown undefined and continues every cleanup', async () => {
	await probe(`
		delete globalThis.DisposableStack;
		delete globalThis.AsyncDisposableStack;
		delete globalThis.SuppressedError;
		await import(${module('dispose/polyfill.ts')});
		for (const asynchronous of [false, true]) {
			const stack = asynchronous ? new AsyncDisposableStack() : new DisposableStack();
			let cleaned = false;
			stack.defer(() => { cleaned = true; });
			stack.defer(() => { throw undefined; });
			let failed = false;
			try {
				if (asynchronous) await stack.disposeAsync(); else stack.dispose();
			} catch (error) {
				failed = true;
				if (error !== undefined) throw new Error('Cleanup changed the thrown value');
			}
			if (!failed || !cleaned || !stack.disposed) throw new Error('Cleanup failure was swallowed');
		}
	`);
});

test('disposal direct roots and ponyfills keep native and missing globals unchanged until installation', async () => {
	for (const missing of [false, true]) {
		await probe(`
			import assert from 'node:assert/strict';
			const names = ['DisposableStack', 'AsyncDisposableStack', 'SuppressedError'];
			if (${missing}) for (const name of names) delete globalThis[name];
			const before = names.map(name => globalThis[name]);
			const symbols = [Symbol.dispose, Symbol.asyncDispose];
			const root = await import(${module('dispose/mod.ts')});
			const local = await import(${module('dispose/ponyfill.ts')});
			assert.deepEqual(names.map(name => globalThis[name]), before);
			assert.deepEqual([Symbol.dispose, Symbol.asyncDispose], symbols);
			assert.equal(root.DisposableStack, local.DisposableStack);
			const error = local.SuppressedError('cleanup', undefined);
			assert.ok(error instanceof local.SuppressedError);
			assert.ok(error instanceof Error);
			assert.equal(error.error, 'cleanup');
			assert.equal(error.suppressed, undefined);
			assert.equal(Object.getOwnPropertyDescriptor(error, 'error').enumerable, false);
			class Derived extends local.SuppressedError {}
			assert.ok(new Derived(1, 2) instanceof Derived);
			await import(${module('dispose/polyfill.ts')});
			assert.deepEqual(names.map((name, index) => globalThis[name]), ${missing} ? names.map(name => local[name]) : before);
		`);
	}
});

test('disposal ponyfill uses local protocol keys without secretly installing host symbols', async () => {
	await probe(`
		import assert from 'node:assert/strict';
		const nativeSymbol = Symbol;
		function LegacySymbol(description) { return nativeSymbol(description); }
		for (const name of Reflect.ownKeys(nativeSymbol)) {
			if (!['dispose', 'asyncDispose', 'length', 'name', 'prototype'].includes(name)) {
				Object.defineProperty(LegacySymbol, name, Object.getOwnPropertyDescriptor(nativeSymbol, name));
			}
		}
		LegacySymbol.prototype = nativeSymbol.prototype;
		globalThis.Symbol = LegacySymbol;
		for (const name of ['DisposableStack', 'AsyncDisposableStack', 'SuppressedError']) delete globalThis[name];
		const local = await import(${module('dispose/ponyfill.ts')});
		assert.equal(Symbol.dispose, undefined); assert.equal(Symbol.asyncDispose, undefined);
		assert.equal(globalThis.DisposableStack, undefined);
		const order = [];
		const sync = new local.DisposableStack();
		sync.use({ [local.dispose]() { order.push('sync'); } });
		sync.dispose();
		const async = new local.AsyncDisposableStack();
		async.use({ async [local.asyncDispose]() { await Promise.resolve(); order.push('async'); } });
		await async.disposeAsync();
		assert.deepEqual(order, ['sync', 'async']);
		await import(${module('dispose/polyfill.ts')});
		assert.equal(Symbol.dispose, local.dispose); assert.equal(Symbol.asyncDispose, local.asyncDispose);
		assert.equal(globalThis.DisposableStack, local.DisposableStack);
	`);
});
