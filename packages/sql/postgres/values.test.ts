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
		expect(types.timestamptz.decode('1700000000.123456').toString()).toBe('2023-11-14T22:13:20.123456Z');
		expect(types.timestamptz.decode('-62135596800.5').toString()).toBe('0000-12-31T23:59:59.5Z');
		for (const raw of ['Infinity', '-Infinity', '2026-01-01T00:00:00Z', 1700000000]) {
			expect(() => types.timestamptz.decode(raw)).toThrow(TypeError);
		}
	});

	it('keeps numeric exact and casts an enum to its own type', () => {
		expect(sent(types.numeric as never, '12345678901234567890.000000001').values).toEqual([
			'12345678901234567890.000000001',
		]);
		expect(() => sent(types.numeric as never, '1e5')).toThrow(TypeError);
		const mood = types.enumerated(['My App', 'Mood'], ['sad', 'ok']);
		expect(sent(mood as never, 'ok').text).toBe('select (($1::text)::"My App"."Mood")::text as "v"');
		expect(() => sent(mood as never, 'happy')).toThrow(TypeError);
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
