/** Exercise portable APIs, resource lifetimes and standard module Workers in a real browser. */
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.UTILS_PLAYWRIGHT ?? 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const selected = process.argv.includes('--artifact')
	? JSON.parse(await readFile(join(root, '.tmp/artifacts/npm/consumer-location.json'), 'utf8')).directory
	: process.env.UTILS_CONSUMER;
const consumer = selected === undefined ? undefined : await realpath(selected);
if (consumer === resolve(root) || consumer?.startsWith(root)) {
	throw new Error('Artifact checks requires a consumer outside the source checkout.');
}
const resolvedArtifacts = {};
if (consumer !== undefined) {
	const installed = createRequire(join(consumer, 'package.json'));
	for (
		const name of [
			'@okikio/input',
			'@okikio/context/events',
			'@okikio/context/state',
			'@okikio/storage/state/web',
			'@okikio/schema/time',
			'@okikio/schema/codec',
			'@okikio/duration',
			'@okikio/duration/polyfill',
			'@okikio/collection/record',
			'@okikio/collection/record/json',
			'@okikio/schema',
			'@okikio/runtime/browser/worker',
			'@okikio/pool',
			'@okikio/streams/events',
			'@okikio/worker/stream',
			'@okikio/scheduler/concurrency',
			'@okikio/capability/resource',
		]
	) {
		const target = await realpath(installed.resolve(name));
		if (!target.startsWith(consumer + sep) || !/\.[cm]?js$/.test(target)) {
			throw new Error(`Artifact ${name} must resolve to emitted JavaScript inside the clean consumer.`);
		}
		resolvedArtifacts[name] = target;
	}
}
const temporary = await mkdtemp(join(consumer ?? tmpdir(), 'utils-input-browser-'));
const output = join(temporary, 'dist');
let browser;
let server;
try {
	let input = join(root, 'packages/input/fixtures/browser.ts');
	let context = join(root, 'packages/context/fixtures/browser.ts');
	let collection = join(root, 'packages/collection/fixtures/browser.ts');
	let duration = join(root, 'packages/duration/fixtures/browser.ts');
	let lifetimes = join(root, 'tests/browser/lifetimes.ts');
	let byteThread = join(root, 'tests/browser/byte-thread.ts');
	let protocolBrowser = join(root, 'tests/browser/protocol.ts');
	let usability = join(root, 'tests/browser/usability.ts');
	let contextState = join(root, 'tests/browser/context-state.ts');
	let thread = join(root, 'packages/runtime/fixtures/web-thread.ts');
	let protocol = join(root, 'packages/runtime/node/fixtures/protocol.ts');
	if (consumer !== undefined) {
		const stateFixture = await readFile(contextState, 'utf8');
		contextState = join(temporary, 'context-state-browser.ts');
		await writeFile(contextState, stateFixture);
		const usabilityFixture = await readFile(usability, 'utf8');
		usability = join(temporary, 'usability-browser.ts');
		await writeFile(usability, usabilityFixture);
		for (const [name, path] of [['byte-thread', byteThread], ['protocol-browser', protocolBrowser]]) {
			const content = await readFile(path, 'utf8');
			const target = join(temporary, name + '.ts');
			await writeFile(target, content);
			if (name === 'byte-thread') byteThread = target;
			else protocolBrowser = target;
		}
		const lifetimeFixture = await readFile(lifetimes, 'utf8');
		lifetimes = join(temporary, 'lifetime-browser.ts');
		await writeFile(lifetimes, lifetimeFixture);
		const fixture = await readFile(input, 'utf8');
		if (!fixture.includes("from '../mod.ts'")) throw new Error('Canonical Input fixture import changed.');
		input = join(temporary, 'browser.ts');
		await writeFile(input, fixture.replace("from '../mod.ts'", "from '@okikio/input'"));
		let contextFixture = await readFile(context, 'utf8');
		for (const name of ['events', 'state']) {
			const original = `from '../${name}.ts'`;
			if (!contextFixture.includes(original)) throw new Error(`Canonical Context ${name} import changed.`);
			contextFixture = contextFixture.replace(original, `from '@okikio/context/${name}'`);
		}
		context = join(temporary, 'context-browser.ts');
		await writeFile(context, contextFixture);
		let collectionFixture = await readFile(collection, 'utf8');
		for (const [file, name] of [['mod', '@okikio/collection/record'], ['json', '@okikio/collection/record/json']]) {
			const original = `from '../record/${file}.ts'`;
			if (!collectionFixture.includes(original)) throw new Error(`Canonical Collection ${file} import changed.`);
			collectionFixture = collectionFixture.replace(original, `from '${name}'`);
		}
		collection = join(temporary, 'collection-browser.ts');
		await writeFile(collection, collectionFixture);
		let durationFixture = await readFile(duration, 'utf8');
		for (
			const [original, replacement] of [
				["from '../mod.ts'", "from '@okikio/duration'"],
				["import('../polyfill.ts')", "import('@okikio/duration/polyfill')"],
			]
		) {
			if (!durationFixture.includes(original)) throw new Error('Canonical Duration fixture import changed.');
			durationFixture = durationFixture.replace(original, replacement);
		}
		duration = join(temporary, 'duration-browser.ts');
		await writeFile(duration, durationFixture);
		const source = await readFile(thread, 'utf8');
		if (!source.includes("from '../node/fixtures/protocol.ts'")) {
			throw new Error('Canonical Worker fixture import changed.');
		}
		thread = join(temporary, 'web-thread.ts');
		await writeFile(
			thread,
			source.replace("from '../node/fixtures/protocol.ts'", "from './protocol.ts'"),
		);
		const definition = await readFile(protocol, 'utf8');
		protocol = join(temporary, 'protocol.ts');
		await writeFile(protocol, definition);
	}
	const module = (name, source) => consumer === undefined ? join(root, source) : name;
	const parent = join(temporary, 'parent.ts');
	await writeFile(
		parent,
		`
import ${JSON.stringify(module('@okikio/duration/polyfill', 'packages/duration/polyfill.ts'))};
import ${JSON.stringify(module('@okikio/dispose/polyfill', 'packages/dispose/polyfill.ts'))};
import * as context from ${JSON.stringify(module('@okikio/context', 'packages/context/mod.ts'))};
import * as workers from ${
			JSON.stringify(module('@okikio/runtime/browser/worker', 'packages/runtime/browser/worker.ts'))
		};
import { Protocol } from ${JSON.stringify(protocol)};
export async function verify(module) {
  await using ctx = context.create({ id: 'real-browser-worker' });
  const notices = [];
  let announce;
  const started = new Promise((resolve) => { announce = resolve; });
  await using thread = workers.open(ctx, { module, protocol: Protocol, notice(value) { notices.push(value); if(value === 11) announce(); }, call: (value) => value * 2 });
  if(await thread.request(ctx, { mode: 'echo', value: 3 }) !== 6) throw new Error('Browser reverse call failed.');
  const bytes = new Uint8Array([3, 4]).buffer;
  const result = await thread.request(ctx, { mode: 'transfer', value: 0, bytes }, { transfer: [bytes] });
  if(bytes.byteLength !== 0 || new Uint8Array(result)[1] !== 4) throw new Error('Browser transfer ownership failed.');
  await using request = context.child(ctx);
  const flag = new SharedArrayBuffer(4);
  const failure = thread.request(request, { mode: 'wait', value: 11, flag }).catch((error) => error);
  await started;
  context.cancel(request, 'browser cancellation');
  if(!(await failure instanceof context.ContextCancelledError) || Atomics.load(new Int32Array(flag), 0) !== 1) throw new Error('Browser cancellation released before cleanup.');
  return ['native module Worker', 'typed notice and reverse call', 'ArrayBuffer transfer', 'remote cleanup before cancellation settlement'];
}
`,
	);
	await build({
		config: false,
		cwd: consumer ?? root,
		entry: {
			browser: input,
			'context-browser': context,
			'collection-browser': collection,
			'duration-browser': duration,
			'lifetime-browser': lifetimes,
			'byte-thread': byteThread,
			'protocol-browser': protocolBrowser,
			'usability-browser': usability,
			'context-state-browser': contextState,
			'web-thread': thread,
			parent,
		},
		outDir: output,
		format: ['esm'],
		platform: 'browser',
		target: 'es2022',
		dts: false,
		treeshake: true,
		clean: true,
		publint: false,
		attw: false,
		deps: { alwaysBundle: [/.*/] },
	});
	const files = await readdir(output, { recursive: true });
	const select = (name) => {
		const found = files.find((file) => [`${name}.js`, `${name}.mjs`].includes(file.split(sep).at(-1)));
		if (!found) throw new Error(`Missing browser output ${name}.`);
		return `/${found}`;
	};
	server = createServer(async (request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		try {
			const path = new URL(request.url ?? '/', 'http://localhost').pathname;
			if (path === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end('<!doctype html><title>Utility browser tests</title><body></body>');
				return;
			}
			const file = resolve(output, path.slice(1));
			if (!file.startsWith(output + sep)) throw new Error('Invalid test path.');
			response.setHeader('Content-Type', 'text/javascript');
			response.end(await readFile(file));
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not bind a port.');
	browser = await chromium.launch({ executablePath: process.env.UTILS_CHROMIUM, args: ['--no-sandbox'] });
	// The explicit browser context lets independent documents share the real origin's
	// storage and lock service; a convenience newPage() context admits only one page.
	const pages = await browser.newContext({ viewport: { width: 900, height: 600 } });
	const page = await pages.newPage();
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	await page.goto(`http://127.0.0.1:${address.port}`);
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	const checks = await page.evaluate(async (path) => await (await import(path)).verify(), select('browser'));
	const contextChecks = await page.evaluate(
		async (path) => await (await import(path)).verify(),
		select('context-browser'),
	);
	const stateChecks = await page.evaluate(
		async (path) => await (await import(path)).contextState(),
		select('context-state-browser'),
	);
	const collectionChecks = await page.evaluate(
		async (path) => await (await import(path)).verify(),
		select('collection-browser'),
	);
	const durationChecks = await page.evaluate(
		async (path) => await (await import(path)).verify(),
		select('duration-browser'),
	);
	const protocolChecks = await page.evaluate(async ({ path, worker }) => await (await import(path)).verify(worker), {
		path: select('protocol-browser'),
		worker: select('byte-thread'),
	});
	const lifetimeChecks = await page.evaluate(
		async (path) => await (await import(path)).verify(),
		select('lifetime-browser'),
	);
	await page.evaluate(async (path) => {
		globalThis.inputHarness = (await import(path)).installPointer();
	}, select('browser'));
	const panel = await page.locator('#input-pointer-check').boundingBox();
	if (!panel) throw new Error('Native pointer target was absent.');
	await page.mouse.move(panel.x + 20, panel.y + 20);
	await page.mouse.down();
	await page.mouse.move(panel.x + panel.width + 80, panel.y + 20, { steps: 3 });
	await page.mouse.up();
	const pointerEvents = await page.evaluate(() => [...globalThis.inputHarness.events]);
	if (
		pointerEvents[0] !== 'start' || pointerEvents.at(-1) !== 'end' ||
		!pointerEvents.some((value) => value.startsWith('move:'))
	) throw new Error(`Pointer capture failed: ${pointerEvents}`);
	checks.push('real mouse pointer capture outside target and release');
	await page.evaluate(() => globalThis.inputHarness.dispose());
	const usabilityChecks = await page.evaluate(
		async (path) => await (await import(path)).verify(),
		select('usability-browser'),
	);
	const workerChecks = await page.evaluate(
		async ({ parent, thread }) => await (await import(parent)).verify(new URL(thread, location.href)),
		{ parent: select('parent'), thread: select('web-thread') },
	);
	stateChecks.push(
		...await storedDocuments(page, select('context-state-browser'), `http://127.0.0.1:${address.port}`, pageErrors),
	);
	if (pageErrors.length) throw new AggregateError(pageErrors, 'Browser raised unexpected errors.');
	const report = {
		projection: consumer === undefined ? 'source' : 'emitted',
		...(consumer === undefined ? {} : { consumer, resolvedArtifacts }),
		browser: await browser.version(),
		checkedAt: new Date().toISOString(),
		checks: [
			...checks,
			...contextChecks,
			...stateChecks,
			...collectionChecks,
			...durationChecks,
			...lifetimeChecks,
			...protocolChecks,
			...usabilityChecks,
			...workerChecks,
		],
		pointerEvents,
		pageErrors,
	};
	const reportDirectory = join(root, '.tmp', 'artifacts', 'tests', 'browser');
	await mkdir(reportDirectory, { recursive: true });
	const filename = consumer === undefined ? 'input-browser.json' : 'input-browser-artifact.json';
	await writeFile(join(reportDirectory, filename), JSON.stringify(report, null, 2) + '\n');
	console.log(JSON.stringify(report, null, 2));
} finally {
	await browser?.close();
	if (server) await new Promise((resolve) => server.close(resolve));
	await rm(temporary, { recursive: true, force: true });
}

/**
 * A saved draft must survive a new document, and two cooperating documents must
 * not both replace the same version. These actions use the same emitted fixture
 * as the single-page checks, so an in-memory mock cannot accidentally prove them.
 */
async function storedDocuments(page, path, origin, pageErrors) {
	const key = await page.evaluate(() => 'utils-state-documents-' + crypto.randomUUID());
	let peer;
	try {
		const seed = await page.evaluate(
			async ({ path, key }) => await (await import(path)).writeBrowserState(key, 40),
			{ path, key },
		);
		await page.reload();
		const reopened = await page.evaluate(
			async ({ path, key }) => await (await import(path)).readBrowserState(key),
			{ path, key },
		);
		if (reopened.value !== seed.value || reopened.version !== seed.version) {
			throw new Error('Native localStorage did not retain the exact snapshot across document reload.');
		}
		peer = await page.context().newPage();
		peer.on('pageerror', (error) => pageErrors.push(error.message));
		await peer.goto(origin);
		const outcomes = await Promise.all([page, peer].map((document, index) =>
			document.evaluate(
				async ({ path, key, version, value }) => await (await import(path)).replaceBrowserState(key, version, value),
				{ path, key, version: seed.version, value: 41 + index },
			)
		));
		if (outcomes.filter(Boolean).length !== 1) {
			throw new Error('Two native documents did not produce exactly one accepted version replacement.');
		}
		const values = await Promise.all([page, peer].map((document) =>
			document.evaluate(
				async ({ path, key }) => await (await import(path)).readBrowserState(key),
				{ path, key },
			)
		));
		const winner = outcomes[0] ? 41 : 42;
		if (
			values.some((value) => value.value !== winner || value.version === seed.version) ||
			values[0].version !== values[1].version
		) {
			throw new Error('Native documents did not reopen the same acknowledged winner.');
		}
		return [
			'native localStorage retains the exact value and version across document reload',
			'two native same-origin documents coordinate version replacement through Web Locks',
		];
	} finally {
		await page.evaluate((key) => localStorage.removeItem(key), key);
		await peer?.close();
	}
}
