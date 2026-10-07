import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Decode one command stream as UTF-8 without allocating decoders at every assertion site. */
const text = new TextDecoder();

/** Return the machine-readable Deno module graph for one local public entry point. */
async function graph(entry: URL): Promise<ReadonlySet<string>> {
	const output = await new Deno.Command(Deno.execPath(), {
		args: ['info', '--json', entry.href],
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	assert.equal(output.code, 0, text.decode(output.stderr));
	const data = JSON.parse(text.decode(output.stdout)) as {
		readonly roots: readonly string[];
		readonly redirects?: Readonly<Record<string, string>>;
		readonly modules: readonly {
			readonly specifier: string;
			readonly dependencies?: readonly { readonly code?: { readonly specifier?: string } }[];
		}[];
	};
	const modules = new Map(data.modules.map((module) => [module.specifier, module]));
	const pending = [...data.roots];
	const reached = new Set<string>();
	while (pending.length > 0) {
		const specifier = pending.pop()!;
		const resolved = data.redirects?.[specifier] ?? specifier;
		if (reached.has(resolved)) continue;
		reached.add(resolved);
		for (const dependency of modules.get(resolved)?.dependencies ?? []) {
			if (dependency.code?.specifier !== undefined) pending.push(dependency.code.specifier);
		}
	}
	return reached;
}

/** Assert that one import-safe entry point cannot statically reach runtime-only implementation files. */
async function excludes(entry: URL, forbidden: readonly string[]): Promise<void> {
	const moduleGraph = await graph(entry);
	for (const fragment of forbidden) {
		const forbiddenUrl = new URL(`..${fragment}`, import.meta.url).href;
		assert.equal(moduleGraph.has(forbiddenUrl), false, `${entry.pathname} unexpectedly reaches ${fragment}`);
	}
}

test('server definition entry points remain isolated from handlers, compilers, and runtimes', async () => {
	const endpoint = new URL('../packages/server/endpoint/definition.ts', import.meta.url);
	const service = new URL('../packages/server/service/definition.ts', import.meta.url);
	const gateway = new URL('../packages/server/gateway/definition.ts', import.meta.url);

	await excludes(endpoint, [
		'/packages/server/endpoint/handler.ts',
		'/packages/server/endpoint/openapi.ts',
	]);
	await excludes(service, [
		'/packages/server/endpoint/handler.ts',
		'/packages/server/endpoint/openapi.ts',
		'/packages/server/service/implementation.ts',
		'/packages/server/service/compile.ts',
		'/packages/server/service/runtime.ts',
	]);
	await excludes(gateway, [
		'/packages/server/endpoint/handler.ts',
		'/packages/server/endpoint/openapi.ts',
		'/packages/server/service/implementation.ts',
		'/packages/server/service/compile.ts',
		'/packages/server/service/runtime.ts',
		'/packages/server/gateway/compile.ts',
		'/packages/server/gateway/runtime.ts',
	]);
});

test('generic lifecycle imports do not install the disposal polyfill implicitly', async () => {
	for (
		const entry of [
			new URL('../packages/context/mod.ts', import.meta.url),
			new URL('../packages/resource/mod.ts', import.meta.url),
			new URL('../packages/task/mod.ts', import.meta.url),
			new URL('../packages/workflow/mod.ts', import.meta.url),
		]
	) {
		await excludes(entry, ['/packages/dispose/polyfill.ts', '/packages/duration/polyfill.ts']);
	}
});

/** Run runtime-neutral contracts in a realm that refuses host-specific APIs. */
async function isolated(source: string): Promise<void> {
	const output = await new Deno.Command(Deno.execPath(), {
		args: ['eval', source],
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	assert.equal(output.code, 0, text.decode(output.stderr));
}

test('generic server imports do not acquire a Deno listener', async () => {
	const entries = ['gateway/runtime.ts', 'service/runtime.ts', 'http/app.ts'].map((path) =>
		new URL(`../packages/server/${path}`, import.meta.url).href
	);
	await isolated(`
		Object.defineProperty(globalThis, 'Deno', { configurable: true, value: new Proxy(Deno, { get(target, key) {
			if (['serve', 'listen', 'listenTls'].includes(key)) throw new Error('Core accessed listener: ' + key);
			return Reflect.get(target, key);
		} }) });
		for (const entry of ${JSON.stringify(entries)}) await import(entry);
	`);
});

test('telemetry records without host globals or optional backend adapters', async () => {
	const entry = new URL('../packages/telemetry/mod.ts', import.meta.url);
	await excludes(entry, [
		'/packages/telemetry/logtape.ts',
		'/packages/telemetry/otel.ts',
		'/packages/telemetry/server.ts',
		'/packages/telemetry/lifecycle.ts',
	]);
	await isolated(`
		for (const name of ['Deno', 'Bun', 'process', 'window', 'localStorage', 'sessionStorage']) {
			Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('Telemetry accessed ' + name); } });
		}
		const telemetry = await import(${JSON.stringify(entry.href)});
		const reporter = telemetry.memory();
		await telemetry.create(reporter).report({ name: 'import.finished', fields: { rows: 3 } });
		if (reporter.records[0]?.fields.rows !== 3) throw new Error('Portable report was lost');
	`);
});

test('pure permission and requirement declarations import without execution globals', async () => {
	const entries = ['permission', 'requirement'].map((name) =>
		new URL(`../packages/${name}/definition.ts`, import.meta.url).href
	);
	for (const entry of entries) {
		await excludes(new URL(entry), [
			'/packages/context/mod.ts',
			'/packages/dispose/polyfill.ts',
			'/packages/duration/polyfill.ts',
		]);
	}
	await isolated(`
		delete globalThis.Temporal;
		delete globalThis.AsyncDisposableStack;
		delete globalThis.DisposableStack;
		const permission = await import(${JSON.stringify(entries[0])});
		const requirement = await import(${JSON.stringify(entries[1])});
		const read = permission.define({ id: 'asset.read' });
		if (permission.require(read) !== requirement.define({ family: 'permission', action: 'require', definition: read })) throw new Error('Definition identities diverged');
	`);
});
