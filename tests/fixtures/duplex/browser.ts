/** Own the browser origin and a real container endpoint for tests and optional timings. @module */
import '@okikio/dispose/polyfill';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import type { Page } from 'playwright';
import { build } from 'tsdown';
import * as container from './container.ts';
import type { Options, Receipt } from '../../browser/duplex.ts';

/** A browser engine is selected explicitly; a missing engine is a failed check, not a silent skip. */
export type BrowserName = 'chromium' | 'firefox' | 'webkit';
const engines = { chromium, firefox, webkit };
const root = fileURLToPath(new URL('../../../', import.meta.url));
/** A retained run can select its own evidence folder; ordinary runs use the test artifact owner. */
const evidence = process.env.UTILS_DUPLEX_OUTPUT ?? join(root, '.tmp/artifacts/tests/duplex');

/** Await a real cross-process condition with a finite diagnostic deadline. */
export async function until(test: () => Promise<boolean>, message: string): Promise<void> {
	const deadline = Date.now() + 8000;
	do {
		if (await test()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	} while (Date.now() < deadline);
	throw new Error(message);
}

/** Prepare one shared host; every browser still owns its independent document and controls. */
export async function open() {
	const owners = new AsyncDisposableStack();
	try {
		const scratch = join(root, '.tmp/tests/duplex/browser');
		await mkdir(scratch, { recursive: true });
		const output = await mkdtemp(join(scratch, 'bundle-'));
		const results = await build({
			config: false,
			cwd: root,
			entry: { duplex: join(root, 'tests/browser/duplex.ts') },
			outDir: output,
			platform: 'browser',
			target: 'es2022',
			format: ['esm'],
			dts: false,
			deps: { alwaysBundle: [/.*/] },
		});
		let entry: string | undefined;
		for (const result of results) {
			for (const chunk of result.chunks) if (chunk.type === 'chunk' && chunk.isEntry) entry = chunk.fileName;
			await result[Symbol.asyncDispose]();
		}
		if (!entry) throw new Error('The browser bundle has no entry.');
		const javascript = await readFile(join(output, entry));
		/** Only the fixture bundle and a minimal document are served; no checkout path is exposed. */
		const serve = async () => {
			const server = createServer((request, response) => {
				if (request.url === '/duplex.mjs') {
					response.setHeader('content-type', 'text/javascript');
					response.end(javascript);
				} else {
					response.setHeader('content-type', 'text/html');
					response.end('<!doctype html><title>Duplex browser verification</title>');
				}
			});
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(0, '127.0.0.1', resolve);
			});
			// A failed listen owns no socket. Register teardown only after admission
			// starts, so its error cannot be hidden by closing an unstarted server.
			owners.defer(async () => {
				await new Promise<void>((resolve, reject) => {
					server.close((error) => error ? reject(error) : resolve());
					server.closeAllConnections();
				});
			});
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('Browser origin did not bind.');
			return `http://127.0.0.1:${address.port}`;
		};
		const origin = await serve(), deniedOrigin = await serve();
		const host = await container.start({ allowedOrigin: origin });
		owners.use(host);
		return {
			host,
			origin,
			deniedOrigin,
			/** Launch and join a real engine; browser close also disposes its documents and network requests. */
			async browser(name: BrowserName) {
				const browser = await engines[name].launch({
					timeout: 15_000,
					...(name === 'chromium' ? { args: ['--no-sandbox'] } : {}),
				});
				return {
					browser,
					async page(allowed = true): Promise<Page> {
						const page = await browser.newPage();
						page.setDefaultTimeout(8000);
						page.setDefaultNavigationTimeout(8000);
						await page.goto(allowed ? origin : deniedOrigin);
						return page;
					},
					async [Symbol.asyncDispose]() {
						await browser.close();
					},
				};
			},
			async [Symbol.asyncDispose]() {
				await owners.disposeAsync();
			},
		};
	} catch (error) {
		try {
			await owners.disposeAsync();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], 'Browser fixture setup and cleanup both failed.');
		}
		throw error;
	}
}

/** Invoke the browser's actual Fetch client, with no Node-side interception or policy emulation. */
export async function run(page: Page, options: Options): Promise<Receipt> {
	return await page.evaluate(async (options) => {
		const path = '/duplex.mjs';
		return await (await import(path)).run(options);
	}, options);
}

/** Preserve engine, container and scenario receipts under the repository's temporary evidence owner. */
export async function report(name: string, value: unknown): Promise<void> {
	await mkdir(evidence, { recursive: true });
	await writeFile(join(evidence, name), JSON.stringify(value, null, 2) + '\n');
}
