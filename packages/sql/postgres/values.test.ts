import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { temporal } from '@okikio/duration/temporal';
import * as sql from './mod.ts';
import { trigger, types } from './mod.ts';

const app = sql.schema('app');
const wide = app.table('wide', { a: sql.column(types.integer), b: sql.column(types.integer) });
const sent = (type: types.SqlType<never>, value: unknown) =>
	sql.toQuery(sql.select({ v: sql.value(value as never, type) }));

describe('values every client can send unchanged', () => {
	it('sends numbers as text, so a client that writes values into the SQL cannot change their meaning', () => {
		const query = sent(types.integer as never, -2147483648);
		expect(query.text).toBe('select (($1::text)::integer)::integer as "v"');
		expect(query.values).toEqual(['-2147483648']);
		expect(sent(types.double as never, -0).values).toEqual(['-0']);
		expect(sent(types.double as never, Number.NaN).values).toEqual(['NaN']);
		expect(sent(types.double as never, Number.NEGATIVE_INFINITY).values).toEqual(['-Infinity']);
		for (const [raw, value] of [['-0', -0], ['NaN', Number.NaN], ['Infinity', Infinity], ['5e-324', 5e-324]] as const) {
			expect(Object.is(types.double.decode(raw), value)).toBe(true);
		}
		expect(() => types.double.decode(0.5)).toThrow(TypeError);
	});

	it('refuses text that PostgreSQL would reject or every client would silently change', () => {
		for (const value of ['a\u0000b', 'x\uD800y', 'x\uDC00']) {
			expect(() => sent(types.text() as never, value)).toThrow('NUL or a lone UTF-16 surrogate');
		}
		expect(() => sent(types.jsonb() as never, { s: 'a\u0000b' })).toThrow('NUL or a lone UTF-16 surrogate');
		expect(() => sent(types.jsonb() as never, ['x\uD800'])).toThrow('NUL or a lone UTF-16 surrogate');
		// The same letters as plain text, and a well-formed pair, are fine.
		expect(sent(types.jsonb() as never, { s: '\\u0000 \\ud800 🙂' }).values).toEqual([
			'{"s":"\\\\u0000 \\\\ud800 🙂"}',
		]);
		expect(sent(types.text() as never, '🙂').values).toEqual(['🙂']);
	});

	it('writes timestamps for every year PostgreSQL holds and reads them as exact epoch seconds', () => {
		const at = (iso: string) => sent(types.timestamptz as never, temporal.Instant.from(iso)).values[0];
		expect(at('2026-01-02T03:04:05.123456Z')).toBe('2026-01-02T03:04:05.123456Z');
		expect(at('+010000-01-01T00:00:00Z')).toBe('10000-01-01T00:00:00Z');
		expect(at('0000-06-01T00:00:00Z')).toBe('0001-06-01T00:00:00Z BC');
		expect(at('-000001-06-01T00:00:00Z')).toBe('0002-06-01T00:00:00Z BC');
		expect(sent(types.timestamp as never, temporal.Instant.from('2026-01-02T03:04:05Z')).values).toEqual([
			'2026-01-02T03:04:05',
		]);
		// Compared as epoch nanoseconds, which need no time zone rules on any runtime.
		expect(types.timestamptz.decode('1700000000.123456').epochNanoseconds).toBe(1_700_000_000_123_456_000n);
		expect(types.timestamptz.decode('-62135596800.5').epochNanoseconds).toBe(-62_135_596_800_500_000_000n);
		for (const raw of ['Infinity', '-Infinity', '2026-01-01T00:00:00Z', 1700000000]) {
			expect(() => types.timestamptz.decode(raw)).toThrow(TypeError);
		}
	});

	it('keeps numeric exact and casts an enum to its own type', () => {
		expect(sent(types.numeric as never, '12345678901234567890.000000001').values).toEqual([
			'12345678901234567890.000000001',
		]);
		expect(() => sent(types.numeric as never, '1e5')).toThrow(TypeError);
		// CockroachDB writes some decimals in scientific notation; they come back as the same plain digits.
		for (
			const [raw, plain] of [
				['-1E-9', '-0.000000001'],
				['1.5E+20', '150000000000000000000'],
				['1.2345678901234567890123456789E+19', '12345678901234567890.123456789'],
				['1.50E+1', '15.0'],
			] as const
		) {
			expect(types.numeric.decode(raw)).toBe(plain);
		}
		const mood = types.enumerated(['My App', 'Mood'], ['sad', 'ok']);
		expect(sent(mood as never, 'ok').text).toBe('select (($1::text)::"My App"."Mood")::text as "v"');
		expect(() => sent(mood as never, 'happy')).toThrow(TypeError);
	});
});

describe('compound and temporal types', () => {
	it('sends arrays and composites as the text forms of their parts', () => {
		const list = sent(types.array(types.nullable(types.integer)) as never, [1, null, -3]);
		expect(list.text).toBe(
			'select case when (array(select ("_okikio_item".v)::integer from jsonb_array_elements_text(($1::text)::jsonb)' +
				' with ordinality as "_okikio_item"(v, i) order by "_okikio_item".i)) is null then null else' +
				' (select coalesce(json_agg(("_okikio_item".v)::integer order by "_okikio_item".i), \'[]\')' +
				' from unnest((array(select ("_okikio_item".v)::integer from jsonb_array_elements_text(($2::text)::jsonb)' +
				' with ordinality as "_okikio_item"(v, i) order by "_okikio_item".i))) with ordinality as "_okikio_item"(v, i))::text end as "v"',
		);
		expect(list.values).toEqual(['["1",null,"-3"]', '["1",null,"-3"]']);
		// For jsonb, `null` is the JSON value, not SQL NULL.
		expect(sent(types.array(types.jsonb()) as never, [null, { a: 1 }]).values[0]).toBe('["null","{\\"a\\":1}"]');
		const point = types.composite(['app', 'point'], { x: types.double, label: types.nullable(types.text()) });
		expect(sent(point as never, { x: -0, label: null }).values[0]).toBe('{"x":"-0","label":null}');
	});

	it('writes bytes, dates, times and intervals as text PostgreSQL reads under every setting', () => {
		expect(types.bytea.encode!(new Uint8Array([0, 15, 255]))).toBe('\\x000fff');
		expect([...types.bytea.decode('000fff')]).toEqual([0, 15, 255]);
		expect(types.date.encode!(temporal.PlainDate.from('-000001-06-01'))).toBe('0002-06-01 BC');
		expect(types.date.decode('-719376').toString()).toBe('0000-06-01');
		expect(types.time.decode('47655.123456').toString()).toBe('13:14:15.123456');
		expect(() => types.time.decode('86400.000000')).toThrow(RangeError);
		expect(types.interval.encode!({ months: -1, days: 30, microseconds: -1n })).toBe(
			'-1 months 30 days -0.000001 seconds',
		);
		expect(types.interval.decode('["14", "-3", "14706.789012"]')).toEqual({
			months: 14,
			days: -3,
			microseconds: 14706789012n,
		});
		expect(() => types.smallint.encode!(40_000)).toThrow(RangeError);
	});
});

describe('limits', () => {
	it('builds a 5,000-row insert without overflowing the stack', () => {
		const rows = Array.from({ length: 5000 }, (_, i) => ({ a: i, b: i }));
		expect(sql.toQuery(sql.insert(wide, rows)).values.length).toBe(10_000);
	});

	it('refuses more parameters than the wire protocol counts', () => {
		const rows = Array.from({ length: 32_768 }, (_, i) => ({ a: i, b: i }));
		expect(() => sql.toQuery(sql.insert(wide, rows))).toThrow('at most 65535 parameters; this one sends 65536');
	});

	it('shapes template pieces like a real template object', () => {
		const { strings } = sql.toQuery(sql.select({ v: sql.value(1, types.integer) }));
		expect(Object.isFrozen(strings)).toBe(true);
		expect(Object.keys(strings)).toEqual(['0', '1']);
		expect([...strings.raw]).toEqual([...strings]);
	});

	it('writes negative DDL constants in parentheses and refuses a "$" in a function body name', () => {
		const t = app.table('signed', { v: sql.column(types.integer).default(-2147483648) });
		expect(sql.toDdlQuery(sql.createTable(t)).text).toContain("default ('-2147483648'::text)::integer");
		const odd = app.table('odd$name', { v: sql.column(types.integer) });
		const fresh = trigger.changed(odd, 'new').c;
		const body = trigger.routine('app', 'touch', [trigger.assign(fresh.v, 1), trigger.result('new')]);
		expect(() => sql.toDdlQuery(body.ddl)).not.toThrow();
		const reading = trigger.routine('app', 'copy', [
			trigger.run(sql.insert(odd, { v: fresh.v })),
			trigger.result('null'),
		]);
		expect(() => sql.toDdlQuery(reading.ddl)).toThrow('may not hold "$"');
	});
});
