/**
 * The low-level form every statement compiles to: a list of trusted text pieces and parameters.
 *
 * Only this package creates text pieces, from fixed keywords and validated identifiers. Every value a caller supplies
 * becomes a parameter with an explicit cast, so no caller value is ever pasted into SQL. A {@link CompiledType} carries
 * the result in two shapes: `$1` text with values for drivers, and template strings with values for clients whose
 * `sql` tag takes a template, such as Postgres.js, Drizzle and Kysely.
 *
 * @module
 */

/** One trusted SQL text piece, created only by this package. */
interface TextPart {
	readonly kind: 'text';
	readonly text: string;
}

/** One parameter value; `cast` is the SQL type it is sent as. */
interface ParamPart {
	readonly kind: 'param';
	readonly value: unknown;
	readonly cast: string;
}

/** A column reference. DML writes it qualified by its table; DDL writes the bare column name. */
interface ColumnPart {
	readonly kind: 'column';
	/** Schema and table, or a single alias. */
	readonly owner: readonly string[];
	readonly name: string;
}

type Part = TextPart | ParamPart | ColumnPart;

/** A piece of SQL. Fragments nest by concatenation and never hold caller text. */
export type Fragment = readonly Part[];

/** A statement ready for any client. */
export interface CompiledType {
	/** SQL with `$1`, `$2`, … placeholders. */
	readonly text: string;
	/** Parameter values, in placeholder order. */
	readonly values: readonly unknown[];
	/** The same statement as template pieces: there is one more piece than there are values. */
	readonly strings: TemplateStringsArray;
}

/** A fixed piece of SQL. Only call this with constant keywords from this package, never with caller input. */
export function keyword(text: string): Fragment {
	return [{ kind: 'text', text }];
}

/** A parameter sent as `cast`, for example `text` or `double precision`. */
export function param(value: unknown, cast: string): Fragment {
	return [{ kind: 'param', value, cast }];
}

/** Concatenate fragments, with an optional fixed separator between them. */
export function join(parts: readonly Fragment[], separator = ''): Fragment {
	const out: Part[] = [];
	parts.forEach((part, index) => {
		if (index > 0 && separator) out.push({ kind: 'text', text: separator });
		out.push(...part);
	});
	return out;
}

/** A fragment in parentheses. */
export function group(inner: Fragment): Fragment {
	return join([keyword('('), inner, keyword(')')]);
}

/** Unquoted identifiers: lowercase ASCII letters, digits and `_`, not starting with a digit, at most 63 bytes. */
const identifierPattern = /^[a-z_][a-z0-9_]{0,62}$/u;

/** Check an identifier and quote it. A schema, table, column, index or function name always passes through here. */
export function identifier(name: string): Fragment {
	if (!identifierPattern.test(name)) throw new TypeError(`Invalid SQL identifier: ${JSON.stringify(name)}.`);
	return keyword(`"${name}"`);
}

/** Result names may use mixed case, because they are always quoted. */
const aliasPattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;

/** Check and quote a result column name, which may be camelCase. */
export function alias(name: string): Fragment {
	if (!aliasPattern.test(name)) throw new TypeError(`Invalid SQL result name: ${JSON.stringify(name)}.`);
	return keyword(`"${name}"`);
}

/** A reference to a column of a table or alias. */
export function column(owner: readonly string[], name: string): Fragment {
	for (const part of [...owner, name]) identifier(part);
	return [{ kind: 'column', owner: Object.freeze([...owner]), name }];
}

/** Dotted identifiers, such as a schema and table. */
export function qualified(...names: readonly string[]): Fragment {
	return join(names.map(identifier), '.');
}

/**
 * A parameter value written as a SQL literal, for DDL, where PostgreSQL accepts no parameters. Only constants from table
 * definitions reach this, and only strings, safe integers, finite numbers, booleans and null are accepted. A string may
 * not hold a backslash or NUL, so its meaning does not depend on `standard_conforming_strings`.
 */
function literal(value: unknown, cast: string, routine: boolean): string {
	if (value === null) return `null::${cast}`;
	if (typeof value === 'boolean') return `${value}::${cast}`;
	if (typeof value === 'number' && Number.isFinite(value)) return `${value}::${cast}`;
	// Inside a function body, `$` could close the dollar quote around the body.
	const unsafe = routine ? /[\\\0$]/u : /[\\\0]/u;
	if (typeof value === 'string' && !unsafe.test(value)) return `'${value.replaceAll("'", "''")}'::${cast}`;
	throw new TypeError('A DDL constant must be a plain string, finite number, boolean or null.');
}

/** How {@link compile} writes parameters. */
export interface CompileOptions {
	/** Write values as literals instead of parameters, and columns without their table, for DDL. */
	readonly ddl?: boolean;
	/**
	 * Write values as literals but keep each column's table, for a function body or trigger condition, where `new` and
	 * `old` name the changed row. A string literal may not hold `$` there.
	 */
	readonly routine?: boolean;
}

/** Turn a fragment into text, values and template pieces. */
export function compile(fragment: Fragment, options: CompileOptions = {}): CompiledType {
	const strings: string[] = [''];
	const values: unknown[] = [];
	let text = '';
	for (const part of fragment) {
		const literals = options.ddl || options.routine;
		if (part.kind !== 'param' || literals) {
			const bare = options.ddl && !options.routine;
			const piece = part.kind === 'text'
				? part.text
				: part.kind === 'column'
				? (bare ? [part.name] : [...part.owner, part.name]).map((name) => `"${name}"`).join('.')
				: literal(part.value, part.cast, options.routine ?? false);
			strings[strings.length - 1] += piece;
			text += piece;
			continue;
		}
		values.push(part.value);
		text += `$${values.length}::${part.cast}`;
		// The template form carries the cast in its text, so every client sends the same parameter type.
		strings.push(`::${part.cast}`);
	}
	const template = Object.freeze(Object.assign([...strings], { raw: Object.freeze([...strings]) }));
	return Object.freeze({ text, values: Object.freeze(values), strings: template as TemplateStringsArray });
}
