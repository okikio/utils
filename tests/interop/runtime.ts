/**
 * Run every case through a SQL client built into Bun or Deno, in that runtime. The Node suite starts this file as a
 * child process and reads one JSON line of outcomes from its output.
 *
 * Usage: `bun tests/interop/runtime.ts <client> <url> <schema>` or
 * `deno run -A --no-lock tests/interop/runtime.ts <client> <url> <schema>`.
 *
 * @module
 */
import '@okikio/duration/polyfill';
import { type FlavorType, runCases } from './cases/mod.ts';

const [client, url, schema, flavor = 'postgres'] = (globalThis as { Deno?: { args: string[] } }).Deno?.args ??
	(globalThis as unknown as { process: { argv: string[] } }).process.argv
		.slice(2);
if (!client || !url || !schema) {
	throw new TypeError('Usage: runtime.ts <client> <url> <schema>');
}
// Each runtime loads only its own client module, so a change to one does not touch the other's results.
const opened = client === 'deno-postgres'
	? await (await import('./clients/deno.ts')).open(url)
	: await (await import('./clients/bun.ts')).open(url, client);
try {
	const outcomes = await runCases(opened.db, schema, {
		flavor: flavor as FlavorType,
	});
	console.log(`interop-outcomes ${JSON.stringify(outcomes)}`);
} finally {
	await opened.close();
}
