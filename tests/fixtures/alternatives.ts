/**
 * Comparable public operations with independently authored expected values.
 *
 * Fixtures return fresh values and own every response/stream they consume. Shared
 * parser engines qualify adapter behavior, not independent parser correctness.
 * Benchmark callers may reuse these functions; assertions stay in the test/preflight.
 */
import { z } from 'zod';
import pLimit from 'p-limit';
import { err, ok } from 'neverthrow';
import { pooledMap } from '@std/async';
import { parse as parseCsv } from '@std/csv/parse';
import { compare as compareSemver, parse as parseSemver } from '@std/semver';
import { parse as parseNpmCsv } from 'csv-parse/sync';
import { defaultTreeAdapter, parse as parseHtml } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { parse as parseCss, walk } from 'css-tree';
import { SaxesParser } from 'saxes';
import { Hono } from 'hono';
import { decode as decodeCodec, define as defineCodec, encode as encodeCodec } from '@okikio/codec';
import { mapPooledOrdered } from '@okikio/concurrency';
import { parseResources } from '@okikio/css';
import { parse as parseCsvUtility } from '@okikio/csv';
import { define as defineEnvironment, record as environmentRecord } from '@okikio/env/zod';
import { attribute, parse as parseHtmlUtility, selectAll } from '@okikio/html';
import { parseJson } from '@okikio/http/request';
import { fail, getOr, match, ok as resultOk } from '@okikio/result';
import type { Result } from '@okikio/result';
import { parse as parseSchema } from '@okikio/schema';
import { create as createServer, route } from '@okikio/server/http';
import { locations } from '@okikio/sitemap';
import { lines } from '@okikio/streams';
import { semanticVersionScheme } from '@okikio/version';

/** One shared physical operation, with implementation-specific extra contracts documented separately. */
export interface AlternativeCase {
	readonly id: string;
	readonly family: string;
	readonly scope: 'shared-output' | 'same-engine-adapter';
	readonly expected: unknown;
	readonly utils: () => unknown | Promise<unknown>;
	readonly alternative: () => unknown | Promise<unknown>;
}

export const PortSchema = z.coerce.number().int().min(1).max(65535).describe('TCP listener port.');
export const ModeSchema = z.enum(['development', 'production']).describe('Application mode.');
export const Environment = defineEnvironment({ PORT: PortSchema, MODE: ModeSchema });
export const EnvironmentSchema = z.object({ PORT: PortSchema, MODE: ModeSchema });
export const rawEnvironment = Object.freeze({ PORT: '8787', MODE: 'production' });
export const timestamp = '2026-01-01T00:00:00.000Z';
export const TimestampCodec = defineCodec({
	decode: z.iso.datetime().transform((value) => new Date(value)),
	encode: z.date().transform((value) => value.toISOString()),
});
export const ZodTimestampCodec = z.codec(z.iso.datetime(), z.date(), {
	decode: (value) => new Date(value),
	encode: (value) => value.toISOString(),
});
export const csvSource = 'Company,Note,Value\r\n"Northstar, Inc.","line 1\nline 2",001\r\n雪,"a ""quote""",0\r\n';
export const csvExpected = Object.freeze([
	Object.freeze(['Northstar, Inc.', 'line 1\nline 2', '001']),
	Object.freeze(['雪', 'a "quote"', '0']),
]);
export const htmlSource =
	'<main><a href="/guide">Guide<strong> now</strong></a><a>No target</a><a href="/pricing">Pricing';
export const cssSource = '.hero { background: url("hero.webp"); } @font-face { src: url("brand.woff2"); }';
export const sitemapSource = '<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">' +
	'<sm:url><sm:loc>https://example.com/?a=1&amp;b=2</sm:loc></sm:url>' +
	'<sm:url><sm:loc><![CDATA[https://example.com/雪]]></sm:loc></sm:url></sm:urlset>';
export const mapValues = Object.freeze(Array.from({ length: 32 }, (_, index) => index));

/** Collect only CSV data cells; source-header interpretation and metadata are excluded from the shared output. */
export function csvUtility(source = csvSource): readonly (readonly string[])[] {
	return parseCsvUtility(source, { headerRow: 1 }).rows.map((row) => row.values);
}
export function csvNpm(source = csvSource): string[][] {
	return (parseNpmCsv(source, { cast: false, bom: true }) as string[][]).slice(1);
}
export function csvStd(source = csvSource): string[][] {
	return (parseCsv(source, { fieldsPerRecord: 3 }) as string[][]).slice(1);
}

/** Both adapters materialize a finite ordered successful map; cancellation and stream admission remain distinct. */
export async function mapUtility(values: readonly number[] = mapValues, maximum = 4): Promise<readonly number[]> {
	return await Array.fromAsync(mapPooledOrdered({
		items: values,
		concurrency: maximum,
		async map(value) {
			return value * 3 + 1;
		},
	}));
}
export async function mapPLimit(values: readonly number[] = mapValues, maximum = 4): Promise<readonly number[]> {
	const limit = pLimit(maximum);
	return await Promise.all(values.map((value) => limit(() => value * 3 + 1)));
}
export async function mapStd(values: readonly number[] = mapValues, maximum = 4): Promise<readonly number[]> {
	return await Array.fromAsync(pooledMap(maximum, values, (value) => Promise.resolve(value * 3 + 1)));
}

/** Extract anchor targets with parse5's standard tree; this tests adapter/traversal overhead, not a second HTML grammar. */
export function htmlParse5(source = htmlSource): readonly string[] {
	const document = parseHtml(source, { sourceCodeLocationInfo: true });
	const urls: string[] = [];
	function visit(node: DefaultTreeAdapterMap['node']): void {
		if (defaultTreeAdapter.isElementNode(node) && defaultTreeAdapter.getTagName(node) === 'a') {
			const target = defaultTreeAdapter.getAttrList(node).find((attribute) => attribute.name === 'href');
			if (target !== undefined) urls.push(target.value);
		}
		if ('childNodes' in node) { for (const child of defaultTreeAdapter.getChildNodes(node)) visit(child); }
	}
	visit(document);
	return urls;
}
export function htmlUtility(source = htmlSource): readonly string[] {
	return selectAll(parseHtmlUtility(source).document, 'a[href]').map((link) => attribute(link, 'href')!);
}

/** URL tokens only: source kinds, de-duplication and string-valued @import rules are not supplied by this raw walk. */
export function cssTree(source = cssSource): readonly string[] {
	const urls: string[] = [];
	walk(parseCss(source, { positions: true }), {
		visit: 'Url',
		enter(node) {
			urls.push(node.value);
		},
	});
	return urls;
}
export function cssUtility(source = cssSource): readonly string[] {
	return parseResources(source).map((reference) => reference.url);
}

/** Namespace-aware loc text from a small Sitemap; no feed, index, limit or diagnostics adapter is implied. */
export function sitemapSaxes(source = sitemapSource): readonly string[] {
	const parser = new SaxesParser({ xmlns: true });
	const urls: string[] = [];
	let capture = false, text = '';
	parser.on('opentag', (tag) => {
		if (tag.uri === 'http://www.sitemaps.org/schemas/sitemap/0.9' && tag.local === 'loc') {
			capture = true;
			text = '';
		}
	});
	parser.on('text', (value) => {
		if (capture) text += value;
	});
	parser.on('cdata', (value) => {
		if (capture) text += value;
	});
	parser.on('closetag', (tag) => {
		if (capture && tag.uri === 'http://www.sitemaps.org/schemas/sitemap/0.9' && tag.local === 'loc') {
			urls.push(text.trim());
			capture = false;
		}
	});
	parser.write(source).close();
	return urls;
}
export function sitemapUtility(source = sitemapSource): readonly string[] {
	return locations({
		url: 'https://example.com/sitemap.xml',
		text: source,
		contentType: 'application/xml',
		policy: 'standards',
	});
}

const fetchApp = createServer({
	routes: [
		route(
			'GET',
			'/accounts/:id',
			(incoming) => Response.json({ id: new URL(incoming.url).pathname.split('/').at(-1) }),
		),
	],
});
const honoApp = new Hono();
honoApp.get('/accounts/:id', (ctx) => ctx.json({ id: ctx.req.param('id') }));
/** Both fetch paths fully consume one response body; no network server, endpoint validation or request lifetime is measured. */
export async function routeUtility(): Promise<unknown> {
	return await (await fetchApp.fetch(new Request('https://example.com/accounts/42'))).json();
}
export async function routeHono(): Promise<unknown> {
	return await (await honoApp.fetch(new Request('https://example.com/accounts/42'))).json();
}

/** UTF-8 framing on finite known input, with both consumers holding only their resulting line array. */
export const lineSource = 'snow:雪\r\nsecond\nlast';
export async function linesUtility(): Promise<readonly string[]> {
	const bytes = new TextEncoder().encode(lineSource);
	let position = 0;
	const input = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (position === bytes.length) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.subarray(position, ++position));
		},
	});
	return await Array.fromAsync(lines(input));
}
export async function linesNative(): Promise<readonly string[]> {
	const text = await new Response(lineSource).text();
	return text.split(/\r?\n/u);
}

/** Exact SemVer release order only; coarse evidence refinement is intentionally a separate utility feature. */
export function versionUtility(): readonly number[] {
	const scheme = semanticVersionScheme;
	const left = scheme.parse('2.9.0')!, right = scheme.parse('2.10.0')!;
	return [scheme.compareReleaseOrder(left, right)!, ...right.release];
}
export function versionStd(): readonly number[] {
	const left = parseSemver('2.9.0'), right = parseSemver('2.10.0');
	return [compareSemver(left, right), right.major, right.minor, right.patch];
}

/** Literal independent expected results precede both candidates; normalized projections do not equate error formats. */
export const alternatives: readonly AlternativeCase[] = Object.freeze([
	{
		id: 'schema-port',
		family: 'schema',
		scope: 'same-engine-adapter',
		expected: 8787,
		utils: () => parseSchema(PortSchema, '8787'),
		alternative: () => PortSchema.parse('8787'),
	},
	{
		id: 'environment-record',
		family: 'env',
		scope: 'same-engine-adapter',
		expected: { PORT: 8787, MODE: 'production' },
		utils: () => Environment.parseSync(environmentRecord(rawEnvironment)),
		alternative: () => EnvironmentSchema.parse(rawEnvironment),
	},
	{
		id: 'timestamp-codec',
		family: 'codec',
		scope: 'same-engine-adapter',
		expected: timestamp,
		utils: async () => encodeCodec(TimestampCodec, await decodeCodec(TimestampCodec, timestamp)),
		alternative: () => z.encode(ZodTimestampCodec, z.decode(ZodTimestampCodec, timestamp)),
	},
	{
		id: 'result-branches',
		family: 'result',
		scope: 'shared-output',
		expected: ['saved:asset-1', 'reject:missing', 'default'],
		utils: () => [
			match(resultOk('asset-1'), {
				ok: (value) => `saved:${value}`,
				failure: (reason) => `reject:${reason}`,
			}),
			match(fail('missing'), { ok: (value) => `saved:${value}`, failure: (reason) => `reject:${reason}` }),
			getOr(fail('missing') as Result<string, string>, 'default'),
		],
		alternative: () => [
			ok('asset-1').match((value) => `saved:${value}`, (reason) => `reject:${reason}`),
			err('missing').match((value) => `saved:${value}`, (reason) => `reject:${reason}`),
			err<string, string>('missing').unwrapOr('default'),
		],
	},
	{
		id: 'csv-npm',
		family: 'csv',
		scope: 'same-engine-adapter',
		expected: csvExpected,
		utils: csvUtility,
		alternative: csvNpm,
	},
	{
		id: 'csv-std',
		family: 'csv',
		scope: 'shared-output',
		expected: csvExpected,
		utils: csvUtility,
		alternative: csvStd,
	},
	{
		id: 'ordered-map-p-limit',
		family: 'concurrency',
		scope: 'shared-output',
		expected: Array.from({ length: 32 }, (_, index) => index * 3 + 1),
		utils: mapUtility,
		alternative: mapPLimit,
	},
	{
		id: 'ordered-map-std',
		family: 'concurrency',
		scope: 'shared-output',
		expected: Array.from({ length: 32 }, (_, index) => index * 3 + 1),
		utils: mapUtility,
		alternative: mapStd,
	},
	{
		id: 'html-anchor-targets',
		family: 'html',
		scope: 'same-engine-adapter',
		expected: ['/guide', '/pricing'],
		utils: htmlUtility,
		alternative: htmlParse5,
	},
	{
		id: 'css-url-tokens',
		family: 'css',
		scope: 'same-engine-adapter',
		expected: ['hero.webp', 'brand.woff2'],
		utils: cssUtility,
		alternative: cssTree,
	},
	{
		id: 'sitemap-locations',
		family: 'sitemap',
		scope: 'shared-output',
		expected: ['https://example.com/?a=1&b=2', 'https://example.com/雪'],
		utils: sitemapUtility,
		alternative: sitemapSaxes,
	},
	{
		id: 'fetch-route-hono',
		family: 'server',
		scope: 'shared-output',
		expected: { id: '42' },
		utils: routeUtility,
		alternative: routeHono,
	},
	{
		id: 'utf8-lines',
		family: 'streams',
		scope: 'shared-output',
		expected: ['snow:雪', 'second', 'last'],
		utils: linesUtility,
		alternative: linesNative,
	},
	{
		id: 'exact-semver',
		family: 'version',
		scope: 'same-engine-adapter',
		expected: [-1, 2, 10, 0],
		utils: versionUtility,
		alternative: versionStd,
	},
	{
		id: 'http-json-body',
		family: 'http',
		scope: 'shared-output',
		expected: { id: 'asset-1' },
		utils: () =>
			parseJson(
				new Request('https://example.com/import', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{"id":"asset-1"}',
				}),
				{ maximumBodyBytes: 64 },
			),
		alternative: () =>
			new Request('https://example.com/import', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"id":"asset-1"}',
			}).json(),
	},
]);
