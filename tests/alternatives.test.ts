/** Qualification of comparable operations, rejection boundaries and deliberate differences. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import pLimit from 'p-limit';
import { pooledMap } from '@std/async';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { mapPooledOrdered } from '@okikio/concurrency';
import { parse as parseSchema, SchemaValidationError } from '@okikio/schema';
import { decode, encode } from '@okikio/codec';
import { CsvParseError, parse as parseCsv } from '@okikio/csv';
import { EnvironmentError, record as environmentRecord } from '@okikio/env/zod';
import { fail, match, ok as resultOk } from '@okikio/result';
import type { Result } from '@okikio/result';
import { snapshot } from '@okikio/record';
import { semanticVersionScheme } from '@okikio/version';
import { tryParse } from '@std/semver';
import { parseJson, readBody, RequestTransportError } from '@okikio/http/request';
import {
	alternatives,
	cssTree,
	cssUtility,
	csvNpm,
	csvStd,
	Environment,
	EnvironmentSchema,
	PortSchema,
	sitemapSaxes,
	sitemapUtility,
	TimestampCodec,
	ZodTimestampCodec,
} from './fixtures/alternatives.ts';

describe('established alternatives on explicit overlapping contracts', () => {
	for (const candidate of alternatives) {
		it(`${candidate.id} preserves the independently known ${candidate.family} result`, async () => {
			expect(await candidate.utils()).toEqual(candidate.expected);
			expect(await candidate.alternative()).toEqual(candidate.expected);
		});
	}

	it('rejects invalid schema and environment input without equating diagnostic formats', async () => {
		for (const input of ['0', '65536', 'not-a-port', Number.NaN]) {
			await expect(parseSchema(PortSchema, input)).rejects.toBeInstanceOf(SchemaValidationError);
			expect(() => PortSchema.parse(input)).toThrow(z.ZodError);
		}
		const input = { PORT: '0', MODE: 'test' };
		expect(() => Environment.parseSync(environmentRecord(input))).toThrow(EnvironmentError);
		expect(() => EnvironmentSchema.parse(input)).toThrow(z.ZodError);
	});

	it('both directional codecs reject malformed wire input and invalid application dates', async () => {
		await expect(decode(TimestampCodec, 'not-an-instant')).rejects.toBeInstanceOf(SchemaValidationError);
		expect(() => z.decode(ZodTimestampCodec, 'not-an-instant')).toThrow(z.ZodError);
		await expect(encode(TimestampCodec, new Date(Number.NaN))).rejects.toBeInstanceOf(SchemaValidationError);
		expect(() => z.encode(ZodTimestampCodec, new Date(Number.NaN))).toThrow(z.ZodError);
	});

	it('CSV parsers reject an unterminated quoted cell without normalizing their errors', () => {
		const input = 'Company,Note,Value\n"unterminated,record,1';
		expect(() => parseCsv(input, { headerRow: 1 })).toThrow(CsvParseError);
		expect(() => csvNpm(input)).toThrow(Error);
		expect(() => csvStd(input)).toThrow(Error);
	});

	it('Result callbacks propagate unexpected faults and keep mutable payload ownership with the caller', () => {
		const fault = new Error('unexpected-provider-fault');
		const payload = { id: 'asset-1' };
		const own = resultOk(payload), other = ok(payload);
		payload.id = 'asset-2';
		expect(match(own, { ok: (value) => value.id, failure: () => '' })).toBe('asset-2');
		expect(other.match((value) => value.id, () => '')).toBe('asset-2');
		expect(Object.isFrozen(own)).toBe(true);
		expect(() =>
			match(fail('missing') as Result<string, string>, {
				ok: () => '',
				failure: () => {
					throw fault;
				},
			})
		).toThrow(fault);
		expect(() =>
			err('missing').match(() => '', () => {
				throw fault;
			})
		).toThrow(fault);
	});

	for (const name of ['utils', 'p-limit', 'std'] as const) {
		it(`${name} caps active calls and preserves ordered finite output without timer synchronization`, async () => {
			const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
			let active = 0, peak = 0, started = 0;
			const values = [0, 1, 2, 3, 4, 5];
			const mapper = async (value: number) => {
				active++;
				started++;
				peak = Math.max(peak, active);
				if (started === 2) entered.resolve();
				try {
					await release.promise;
					return value * 2;
				} finally {
					active--;
				}
			};
			const limiter = pLimit(2);
			const completion = name === 'utils'
				? Array.fromAsync(mapPooledOrdered({ items: values, concurrency: 2, map: mapper }))
				: name === 'p-limit'
				? Promise.all(values.map((value) => limiter(() => mapper(value))))
				: Array.fromAsync(pooledMap(2, values, mapper));
			try {
				await entered.promise;
				expect(active).toBe(2);
				expect(peak).toBe(2);
			} finally {
				release.resolve();
			}
			expect(await completion).toEqual([0, 2, 4, 6, 8, 10]);
			expect(peak).toBe(2);
			expect(active).toBe(0);
		});
	}

	it('coarse version evidence is a deliberate extension of exact SemVer parsing', () => {
		expect(semanticVersionScheme.parse('2.4')?.release).toEqual([2, 4]);
		expect(tryParse('2.4')).toBeUndefined();
		for (const value of ['01.2.3', '2.x.3', '2.4.6.8']) {
			expect(semanticVersionScheme.parse(value)).toBeUndefined();
			expect(tryParse(value)).toBeUndefined();
		}
	});

	it('CSS resource metadata and string-valued imports exceed a raw URL-token walk', () => {
		const source = '@import "theme.css"; .hero {background:url("hero.webp")}';
		expect(cssUtility(source)).toEqual(['theme.css', 'hero.webp']);
		expect(cssTree(source)).toEqual(['hero.webp']);
	});

	it('Sitemap safety policy rejects DOCTYPE while a general XML parser can still read its loc', () => {
		const source =
			'<!DOCTYPE urlset><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/guide</loc></url></urlset>';
		expect(sitemapUtility(source)).toEqual([]);
		expect(sitemapSaxes(source)).toEqual(['https://example.com/guide']);
	});

	it('bounded HTTP parsing rejects excess bytes and wrong media type that native JSON consumption accepts', async () => {
		const make = (type: string) =>
			new Request('https://example.com/import', {
				method: 'POST',
				headers: { 'content-type': type },
				body: '{"id":1}',
			});
		await expect(readBody(make('application/json'), { maximumBodyBytes: 3 })).rejects.toBeInstanceOf(
			RequestTransportError,
		);
		await expect(parseJson(make('text/plain'))).rejects.toBeInstanceOf(RequestTransportError);
		expect(await make('text/plain').json()).toEqual({ id: 1 });
	});

	it('a guarded record snapshot rejects accessors that a native object spread executes', () => {
		let reads = 0;
		const input = Object.defineProperty({}, 'secret', {
			enumerable: true,
			get() {
				reads++;
				return 'visible';
			},
		});
		expect(() => snapshot(input)).toThrow(TypeError);
		expect(reads).toBe(0);
		expect({ ...input }).toEqual({ secret: 'visible' });
		expect(reads).toBe(1);
	});
});
