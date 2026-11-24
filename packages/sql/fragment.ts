/**
 * The low-level form every statement compiles to: trusted text pieces, checked names, column references and
 * parameters.
 *
 * Only this package creates text pieces, from fixed keywords. Every name passes an identifier check, and every value a
 * caller supplies becomes a parameter, so no caller value is ever pasted into SQL. A {@link Dialect} decides how names
 * are quoted and how parameters are written. A {@link CompiledType} carries the result in two shapes: numbered text with
 * values for drivers, and template strings with values for clients whose `sql` tag takes a template, such as
 * Postgres.js, Drizzle and Kysely.
 *
 * @module
 */
import type { Dialect } from './dialect.ts';

/** One trusted SQL text piece, created only by this package. */
interface TextPart {
	readonly kind: 'text';
	readonly text: string;
}

/** A checked name: a schema, table, column, index, function or result name. The dialect quotes it. */
interface NamePart {
	readonly kind: 'name';
	readonly name: string;
}

/** One parameter value; `type` is the SQL type it is sent as. */
interface ParamPart {
	readonly kind: 'param';
	readonly value: unknown;
	readonly type: string;
}

/** A column reference. A statement writes it with its owner; DDL writes the bare column name. */
interface ColumnPart {
	readonly kind: 'column';
	/** Schema and table, or a single alias. */
	readonly owner: readonly string[];
	readonly name: string;
}

type Part = TextPart | NamePart | ParamPart | ColumnPart;

/** A piece of SQL. Fragments nest by concatenation and never hold caller text. */
export type Fragment = readonly Part[];

/** A compiled statement in both forms a client may need. */
export interface CompiledType {
	/** SQL with numbered placeholders. */
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

/** A parameter sent as `type`, for example `text` or `double precision`. */
export function param(value: unknown, type: string): Fragment {
	return [{ kind: 'param', value, type }];
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

/**
 * Plain identifiers: lowercase ASCII letters, digits and `_`, not starting with a digit, at most 63 bytes. Every common
 * dialect accepts these names quoted or not, so a schema keeps one spelling across dialects.
 */
const identifierPattern = /^[a-z_][a-z0-9_]{0,62}$/u;

/** Check a schema, table, column, index or function name. */
export function identifier(name: string): Fragment {
	if (!identifierPattern.test(name)) throw new TypeError(`Invalid SQL identifier: ${JSON.stringify(name)}.`);
	return [{ kind: 'name', name }];
}

/** Result names may use mixed case, because they are always quoted. */
const aliasPattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;

/** Check a result column name, which may be camelCase. */
export function alias(name: string): Fragment {
	if (!aliasPattern.test(name)) throw new TypeError(`Invalid SQL result name: ${JSON.stringify(name)}.`);
	return [{ kind: 'name', name }];
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

/** How {@link compile} writes a fragment. */
export interface CompileOptions {
	/** Write values as literals and columns without their table, for DDL. */
	readonly ddl?: boolean;
	/**
	 * Write values as literals but keep each column's owner, for a function body or trigger condition, where `new` and
	 * `old` name the changed row.
	 */
	readonly routine?: boolean;
}

/** Turn a fragment into text, values and template pieces with a dialect's rules. */
export function compile(fragment: Fragment, dialect: Dialect, options: CompileOptions = {}): CompiledType {
	const strings: string[] = [''];
	const values: unknown[] = [];
	const mode = options.routine ? 'routine' : options.ddl ? 'ddl' : undefined;
	let text = '';
	for (const part of fragment) {
		if (part.kind === 'param' && mode === undefined) {
			values.push(part.value);
			const placeholder = dialect.placeholder(values.length, part.type);
			text += placeholder.text;
			strings.push(placeholder.suffix);
			continue;
		}
		const piece = part.kind === 'text'
			? part.text
			: part.kind === 'name'
			? dialect.quote(part.name)
			: part.kind === 'column'
			? (mode === 'ddl' ? [part.name] : [...part.owner, part.name]).map((name) => dialect.quote(name)).join('.')
			: dialect.literal(part.value, part.type, mode!);
		strings[strings.length - 1] += piece;
		text += piece;
	}
	const template = Object.freeze(Object.assign([...strings], { raw: Object.freeze([...strings]) }));
	return Object.freeze({ text, values: Object.freeze(values), strings: template as TemplateStringsArray });
}
