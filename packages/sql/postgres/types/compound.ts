/**
 * Arrays and composite values, built from their element or field types' text forms.
 *
 * Both travel as JSON: each element or field is written as its type's text form, which PostgreSQL casts back, and read
 * through the element or field type's own read form. So an array of timestamps is exact under every session setting,
 * like a single timestamp.
 *
 * @module
 */
import { compile, group, join, keyword, param, qualified } from '../../fragment.ts';
import { allowsNull, expect, type SqlType } from '../../type.ts';
import { dialect } from '../dialect.ts';
import { checkJson, isString, textual } from './shared.ts';

/** The text form of a type, or an error naming the type that has none. */
function encoder<T>(type: SqlType<T>, what: string): (value: T) => string {
	if (!type.encode) throw new TypeError(`Type ${type.name} has no text form, so it cannot be ${what}.`);
	return type.encode.bind(type);
}

/** Internal names for the rows an array read unnests; unlikely to shadow a caller's alias. */
const item = '"_okikio_item"';

/**
 * A one-dimensional array of an element type, such as `integer[]` or `text[]`. Elements may be NULL when the element
 * type is nullable. A multi-dimensional array is read flattened, so use it only for one-dimensional columns.
 *
 * @example
 * ```ts ignore
 * const tags = sql.column(types.array(types.text()));
 * const scores = sql.column(types.array(types.nullable(types.integer)));
 * ```
 */
export function array<T>(element: SqlType<T>): SqlType<readonly T[]> {
	const encode = encoder(element, 'an array element');
	const name = `${element.name}[]`;
	const sqlNull = allowsNull(element);
	const send = (values: readonly T[]): string => {
		expect(values, (v): v is readonly T[] => Array.isArray(v), name);
		// `null` is SQL NULL only for a nullable element; for `jsonb` it is the JSON value `null`.
		const items = values.map((value) => value === null && sqlNull ? null : encode(value));
		return checkJson(JSON.stringify(items), 'array');
	};
	const base = textual<readonly T[]>(
		name,
		send,
		(raw) => {
			const list = JSON.parse(expect(raw, isString, name)) as unknown[];
			return Object.freeze(list.map((value) => element.decode(value)));
		},
		(expression) => {
			const x = group(expression);
			return join([
				keyword('case when '),
				x,
				keyword(` is null then null else (select coalesce(json_agg(`),
				element.read(keyword(`${item}.v`)),
				keyword(` order by ${item}.i), '[]') from unnest(`),
				x,
				keyword(`) with ordinality as ${item}(v, i))::text end`),
			]);
		},
	);
	return Object.freeze({
		...base,
		// `array(select …)` turns the JSON list of text forms into the array, keeping order and NULLs.
		send: (values: readonly T[]) =>
			join([
				keyword(`array(select (${item}.v)::${element.name} from jsonb_array_elements_text((`),
				param(send(values), 'text'),
				keyword(`)::jsonb) with ordinality as ${item}(v, i) order by ${item}.i)`),
			]),
		encode: undefined,
	}) as SqlType<readonly T[]>;
}

/** The fields of a composite type: field name to type. */
// deno-lint-ignore no-explicit-any -- `SqlType` is invariant in its value, so only `any` accepts every field type.
export type FieldsType = Readonly<Record<string, SqlType<any>>>;

/** The JavaScript value of a composite type. */
export type FieldValuesType<F extends FieldsType> = {
	readonly [K in keyof F]: F[K] extends SqlType<infer T> ? T : never;
};

/**
 * A value of an existing composite type, as an object with one property per field. List every field of the type, in
 * any order; a field left out is written as NULL.
 *
 * @example
 * ```ts ignore
 * const point = types.composite(['app', 'point2'], { x: types.double, y: types.double });
 * ```
 */
export function composite<const F extends FieldsType>(
	name: readonly [schema: string, type: string],
	fields: F,
): SqlType<FieldValuesType<F>> {
	const label = compile(qualified(...name), dialect).text;
	const encoders = Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, encoder(type, 'a field')]));
	const send = (value: FieldValuesType<F>): string => {
		expect(value, (v): v is FieldValuesType<F> => typeof v === 'object' && v !== null, label);
		const record = value as Readonly<Record<string, unknown>>;
		const out = Object.fromEntries(
			Object.keys(fields).map((key) => {
				const value = record[key];
				return [
					key,
					value === undefined || (value === null && allowsNull(fields[key]!)) ? null : encoders[key]!(value),
				];
			}),
		);
		return checkJson(JSON.stringify(out), 'composite');
	};
	const base = textual<FieldValuesType<F>>(
		label,
		send,
		(raw) => {
			const record = JSON.parse(expect(raw, isString, label)) as Record<string, unknown>;
			return Object.freeze(
				Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, type.decode(record[key] ?? null)])),
			) as FieldValuesType<F>;
		},
		(expression) => {
			const x = group(expression);
			const members = Object.entries(fields).map(([key, type]) =>
				join([
					keyword(`'${key.replaceAll("'", "''")}', `),
					type.read(join([keyword('('), x, keyword(').'), keyword(compile(qualified(key), dialect).text)])),
				])
			);
			// A composite whose fields are all NULL is `is null` row-wise; its text form is NULL only when it is NULL.
			return join([
				keyword('case when ('),
				x,
				keyword(')::text is null then null else jsonb_build_object('),
				join(members, ', '),
				keyword(')::text end'),
			]);
		},
	);
	return Object.freeze({
		...base,
		send: (value: FieldValuesType<F>) =>
			join([keyword(`jsonb_populate_record(null::${label}, (`), param(send(value), 'text'), keyword(')::jsonb)')]),
		encode: undefined,
	}) as SqlType<FieldValuesType<F>>;
}
