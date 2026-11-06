/**
 * Comparable public operations with independently authored expected values.
 *
 * Fixtures return fresh values and own every response/stream they consume. Shared
 * parser engines test adapter behavior, not independent parser correctness.
 * Benchmark callers may reuse these functions; assertions stay in the test/preflight.
 */
import { z } from 'zod';
import pLimit from 'p-limit';
import { err, ok } from 'neverthrow';
import { pooledMap } from '@std/async';
import { parse as parseCsv } from '@std/csv/parse';
import { parse as parseNpmCsv } from 'csv-parse/sync';
import { SaxesParser } from 'saxes';
import { Hono } from 'hono';
import { decode as decodeCodec, encode as encodeCodec } from '@okikio/schema/codec';
import * as schema from '@okikio/schema';
import { DateSchema } from '@okikio/schema/time';
import { mapPooledOrdered } from '@okikio/scheduler/concurrency';
import { parse as parseCsvUtility } from '@okikio/format/csv';
import { define as defineEnvironment, record as environmentRecord, variable } from '@okikio/env';
import { parseJson } from '@okikio/http/request';
import { fail, getOr, match, ok as resultOk } from '@okikio/result';
import type { Result } from '@okikio/result';
import { parse as parseSchema } from '@okikio/schema';
import { create as createServer, route } from '@okikio/server/http';
import { locations } from '@okikio/format/sitemap';
import { lines } from '@okikio/streams';

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
export const OwnedPortSchema = schema.coerce.number({ integer: true, minimum: 1, maximum: 65535 });
export const Environment = defineEnvironment({
	PORT: variable(OwnedPortSchema, { description: 'TCP listener port.' }),
	MODE: variable(schema.oneOf(['development', 'production']), { description: 'Application mode.' }),
});
export const EnvironmentSchema = z.object({ PORT: PortSchema, MODE: ModeSchema });
export const rawEnvironment = Object.freeze({ PORT: '8787', MODE: 'production' });
export const timestamp = '2026-01-01T00:00:00.000Z';
export const TimestampCodec = DateSchema;
export const ZodTimestampCodec = z.codec(z.iso.datetime(), z.date(), {
	decode: (value) => new Date(value),
	encode: (value) => value.toISOString(),
});
export const csvSource = 'Company,Note,Value\r\n"Northstar, Inc.","line 1\nline 2",001\r\n雪,"a ""quote""",0\r\n';
export const csvExpected = Object.freeze([
	Object.freeze(['Northstar, Inc.', 'line 1\nline 2', '001']),
	Object.freeze(['雪', 'a "quote"', '0']),
]);
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

/** Literal independent expected results precede both candidates; normalized projections do not equate error formats. */
export const alternatives: readonly AlternativeCase[] = Object.freeze([
	{
		id: 'schema-port',
		family: 'schema',
		scope: 'shared-output',
		expected: 8787,
		utils: () => parseSchema(OwnedPortSchema, '8787'),
		alternative: () => PortSchema.parse('8787'),
	},
	{
		id: 'environment-record',
		family: 'env',
		scope: 'shared-output',
		expected: { PORT: 8787, MODE: 'production' },
		utils: () => Environment.parseSync(environmentRecord(rawEnvironment)),
		alternative: () => EnvironmentSchema.parse(rawEnvironment),
	},
	{
		id: 'timestamp-codec',
		family: 'codec',
		scope: 'shared-output',
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
