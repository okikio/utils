import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Decode one command stream as UTF-8 without allocating decoders at every assertion site. */
const text = new TextDecoder();

/** Return the machine-readable Deno module graph for one local public entry point. */
async function graph(entry: URL): Promise<string> {
	const output = await new Deno.Command(Deno.execPath(), {
		args: ['info', '--json', entry.href],
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	assert.equal(output.code, 0, text.decode(output.stderr));
	return text.decode(output.stdout).replaceAll('\\', '/');
}

/** Assert that one import-safe entry point cannot statically reach runtime-only implementation files. */
async function excludes(entry: URL, forbidden: readonly string[]): Promise<void> {
	const moduleGraph = await graph(entry);
	for (const fragment of forbidden) {
		assert.equal(moduleGraph.includes(fragment), false, `${entry.pathname} unexpectedly reaches ${fragment}`);
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
	for (const entry of [
		new URL('../packages/context/mod.ts', import.meta.url),
		new URL('../packages/resource/mod.ts', import.meta.url),
		new URL('../packages/task/mod.ts', import.meta.url),
		new URL('../packages/workflow/mod.ts', import.meta.url),
	]) {
		await excludes(entry, ['/packages/dispose/polyfill.ts']);
	}
});

/** Assert that generic server cores cannot acquire a Deno listener behind a host adapter. */
test('gateway and service runtimes remain transport-host neutral', async () => {
	for (const entry of [
		new URL('../packages/server/gateway/runtime.ts', import.meta.url),
		new URL('../packages/server/service/runtime.ts', import.meta.url),
		new URL('../packages/server/http/app.ts', import.meta.url),
	]) {
		const source = await Deno.readTextFile(entry);
		assert.doesNotMatch(source, /\bDeno\.(?:serve|listen|listenTls)\b/u, `${entry.pathname} must not own a Deno listener`);
	}
});

/** Prove the telemetry core stays portable and does not activate optional backend adapters. */
test('telemetry core remains runtime and backend neutral', async () => {
	const entry = new URL('../packages/telemetry/mod.ts', import.meta.url);
	await excludes(entry, [
		'/packages/telemetry/logtape.ts',
		'/packages/telemetry/otel.ts',
		'/packages/telemetry/server.ts',
		'/packages/telemetry/lifecycle.ts',
	]);
	const source = await Deno.readTextFile(entry);
	assert.doesNotMatch(source, /\b(?:Deno|Bun|process|window|localStorage|sessionStorage)\b/u);
});
