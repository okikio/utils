/**
 * Structural TypeScript duplicate audit backed by the Oxc parser.
 *
 * The report is intentionally evidence, not an automated refactor. A shared
 * name or AST shape can describe an intentional protocol boundary, so callers
 * must trace ownership and behavior before moving code between packages.
 *
 * @module
 */
import { parseSync } from 'npm:oxc-parser';

/** One function-like declaration observed in a parsed source file. */
export interface FunctionType {
	/** Repository-relative source path. */
	readonly file: string;
	/** Focused package that owns the source file, or `root` for repository tooling. */
	readonly package: string;
	/** Declared identifier when the function has one. */
	readonly name?: string;
	/** Whether this declaration is exported from its source module. */
	readonly exported: boolean;
	/** One-based declaration line. */
	readonly line: number;
	/** Source length used to exclude trivial helpers from structural groups. */
	readonly size: number;
	/** Identifier-insensitive AST shape fingerprint. */
	readonly shape: string;
	/** Lifecycle operations observed inside the function body. */
	readonly markers: readonly MarkerType[];
	/** Whether this function references one binding imported from `@okikio/context`. */
	readonly usesContext: boolean;
}

/** Lifecycle behavior that makes a function relevant to duplicate ownership review. */
export type MarkerType =
	| 'abort-cleanup'
	| 'abort-listener'
	| 'abort-controller'
	| 'clock-wait'
	| 'promise-race'
	| 'signal-any'
	| 'signal-check'
	| 'timer';

/** One candidate group that needs an ownership review. */
export interface DuplicateType {
	/** Reason this group was selected for review. */
	readonly kind: 'shape' | 'name';
	/** Shared AST shape or helper name. */
	readonly key: string;
	/** Functions belonging to the candidate group. */
	readonly functions: readonly FunctionType[];
}

/** A behavior-based finding that needs an explicit package ownership decision. */
export interface FindingType {
	/** Why the function or group needs review. */
	readonly kind: 'owner-bypass' | 'private-lifecycle';
	/** Evidence strength. The tool never treats a finding as an automatic refactor. */
	readonly confidence: 'high' | 'review';
	/** Concrete behavior that caused the finding. */
	readonly reason: string;
	/** Functions that form the candidate. */
	readonly functions: readonly FunctionType[];
}

/** Parse and candidate-count summary for one root directory. */
export interface AuditType {
	/** Absolute root passed to the audit. */
	readonly root: string;
	/** TypeScript source files parsed successfully. */
	readonly files: number;
	/** Function-like declarations inspected across the parsed source files. */
	readonly functions: number;
	/** Syntax failures that prevented a source file from participating. */
	readonly errors: readonly Readonly<{ readonly file: string; readonly message: string }>[];
	/** Exact identifier-insensitive function body matches. */
	readonly shapes: readonly DuplicateType[];
	/** Repeated private helper names, including non-identical implementations. */
	readonly names: readonly DuplicateType[];
	/** Context-aware timer bypasses and matching private lifecycle implementations. */
	readonly findings: readonly FindingType[];
}

/** Oxc AST nodes retain a type discriminant and source offsets. */
interface NodeType {
	readonly type: string;
	readonly start: number;
	readonly end: number;
	readonly [key: string]: unknown;
}

/** Parse every production TypeScript file below one root and report candidate duplication. */
export async function audit(root: string): Promise<AuditType> {
	const absoluteRoot = await Deno.realPath(root);
	const files: FunctionType[] = [];
	const errors: Array<Readonly<{ readonly file: string; readonly message: string }>> = [];
	let parsedFiles = 0;
	for await (const entry of walk(absoluteRoot)) {
		const source = await Deno.readTextFile(entry.absolute);
		const result = parseSync(entry.absolute, source);
		if (result.errors.length > 0) {
			errors.push(Object.freeze({ file: entry.relative, message: result.errors.map((error) => error.message).join('\n') }));
			continue;
		}
		parsedFiles += 1;
		const program = result.program as NodeType;
		files.push(...functions(program, source, entry.relative, packageOf(absoluteRoot, entry.relative), exportsOf(program), contextBindings(program)));
	}

	return Object.freeze({
		root: absoluteRoot,
		files: parsedFiles,
		functions: files.length,
		errors: Object.freeze(errors),
		shapes: groups(files, (value) => value.size >= 80 ? value.shape : undefined, 'shape'),
		names: groups(files, (value) => value.name, 'name'),
		findings: findings(files),
	} satisfies AuditType);
}

/** Run the audit from a CLI only after preserving imports as a testable library surface. */
if (import.meta.main) {
	const root = Deno.args[0] ?? Deno.cwd();
	console.log(JSON.stringify(await audit(root), null, 2));
}

/** Walk production TypeScript source while excluding generated and test-only paths. */
async function* walk(root: string, base: string = root): AsyncGenerator<Readonly<{ readonly absolute: string; readonly relative: string }>> {
	const entries = [];
	for await (const entry of Deno.readDir(root)) entries.push(entry);
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		if (excluded(entry.name)) continue;
		const absolute = `${root}/${entry.name}`;
		if (entry.isDirectory) {
			yield* walk(absolute, base);
			continue;
		}
		if (!entry.isFile || !sourceFile(entry.name) || testFile(entry.name)) continue;
		yield Object.freeze({ absolute, relative: absolute.slice(base.length + 1) });
	}
}

/** Return whether a file extension uses one TypeScript syntax family Oxc can parse. */
function sourceFile(name: string): boolean {
	if (name.endsWith('.d.ts') || name.endsWith('.d.mts') || name.endsWith('.d.cts')) return false;
	return name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.mts') || name.endsWith('.cts');
}

/** Exclude source trees that exercise, package, or cache code rather than own reusable mechanics. */
function excluded(name: string): boolean {
	return name === '.git' || name === '.agents' || name === '.cache' || name === 'build' || name === 'coverage' ||
		name === 'dist' || name === 'examples' || name === 'fixtures' || name === 'node_modules' || name === 'test' ||
		name === 'tests' || name === 'vendor';
}

/** Exclude behavioral fixtures because this audit finds reusable production mechanics. */
function testFile(name: string): boolean {
	return name.includes('.bench.') || name.includes('_bench.') || name.includes('.spec.') || name.includes('.test.') ||
		name.includes('_test.');
}

/** Collect declared and variable-bound function-like expressions from one source tree. */
function functions(
	program: NodeType,
	source: string,
	file: string,
	packageName: string,
	exportedNames: ReadonlySet<string>,
	contextNames: ReadonlySet<string>,
): readonly FunctionType[] {
	const values: FunctionType[] = [];
	visit(program, undefined, (node, parent) => {
		if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression' && node.type !== 'ArrowFunctionExpression') return;
		const body = node.type === 'ArrowFunctionExpression' && node.expression === true ? node : node.body;
		if (!nodeType(body)) return;
		const name = nameOf(node, parent);
		const names = identifiers(node);
		values.push(Object.freeze({
			file,
			package: packageName,
			...(name === undefined ? {} : { name }),
			exported: name !== undefined && exportedNames.has(name),
			line: line(source, node.start),
			size: body.end - body.start,
			shape: hash(shape(body)),
			markers: Object.freeze([...markers(body)].sort()),
			usesContext: [...contextNames].some((value) => names.has(value)),
		} satisfies FunctionType));
	});
	return Object.freeze(values);
}

/** Return the focused package that owns a repository-relative source path. */
function packageOf(root: string, file: string): string {
	const parts = file.split('/');
	const index = parts.indexOf('packages');
	if (index !== -1) return parts[index + 1] ?? 'root';
	const rootParts = root.split('/');
	const name = rootParts[rootParts.length - 1] ?? 'root';
	return rootParts[rootParts.length - 2] === 'packages' ? name : name === 'packages' ? parts[0] ?? 'root' : 'root';
}

/** Collect local bindings that a module exposes as its own public declarations. */
function exportsOf(program: NodeType): ReadonlySet<string> {
	const names = new Set<string>();
	const body = program.body;
	if (!Array.isArray(body)) return names;
	for (const statement of body) {
		if (!nodeType(statement) || statement.type !== 'ExportNamedDeclaration') continue;
		const declaration = statement.declaration;
		if (nodeType(declaration)) declaredNames(declaration, names);
		const specifiers = statement.specifiers;
		if (!Array.isArray(specifiers)) continue;
		for (const specifier of specifiers) {
			if (!nodeType(specifier)) continue;
			const local = identifierName(specifier.local);
			if (local !== undefined) names.add(local);
		}
	}
	return names;
}

/** Add the direct names declared by one exported declaration. */
function declaredNames(node: NodeType, names: Set<string>): void {
	const direct = identifierName(node.id);
	if (direct !== undefined) names.add(direct);
	if (node.type !== 'VariableDeclaration') return;
	const declarations = node.declarations;
	if (!Array.isArray(declarations)) return;
	for (const declaration of declarations) {
		if (!nodeType(declaration)) continue;
		const name = identifierName(declaration.id);
		if (name !== undefined) names.add(name);
	}
}

/** Collect locally named imports from `@okikio/context`. */
function contextBindings(program: NodeType): ReadonlySet<string> {
	const names = new Set<string>();
	const body = program.body;
	if (!Array.isArray(body)) return names;
	for (const statement of body) {
		if (!nodeType(statement) || statement.type !== 'ImportDeclaration' || stringValue(statement.source) !== '@okikio/context') continue;
		const specifiers = statement.specifiers;
		if (!Array.isArray(specifiers)) continue;
		for (const specifier of specifiers) {
			if (!nodeType(specifier)) continue;
			const name = identifierName(specifier.local);
			if (name !== undefined) names.add(name);
		}
	}
	return names;
}

/** Collect every identifier used or declared in one function tree. */
function identifiers(root: NodeType): ReadonlySet<string> {
	const names = new Set<string>();
	visit(root, undefined, (node) => {
		const name = identifierName(node);
		if (name !== undefined) names.add(name);
	});
	return names;
}

/** Identify lifecycle operations while preserving the surrounding package's own semantics. */
function markers(root: NodeType): ReadonlySet<MarkerType> {
	const values = new Set<MarkerType>();
	visit(root, undefined, (node) => {
		if (node.type === 'NewExpression' && identifierName(node.callee) === 'AbortController') values.add('abort-controller');
		if (node.type !== 'CallExpression') return;
		if (identifierName(node.callee) === 'setTimeout') values.add('timer');
		if (memberCall(node.callee, 'Promise', 'race')) values.add('promise-race');
		if (memberCall(node.callee, 'AbortSignal', 'any')) values.add('signal-any');
		if (memberProperty(node.callee) === 'sleep') values.add('clock-wait');
		if (memberProperty(node.callee) === 'throwIfAborted') values.add('signal-check');
		if (memberProperty(node.callee) === 'addEventListener' && firstString(node.arguments) === 'abort') values.add('abort-listener');
		if (memberProperty(node.callee) === 'removeEventListener' && firstString(node.arguments) === 'abort') values.add('abort-cleanup');
	});
	return values;
}

/** Return one direct identifier name without interpreting a member expression as a binding. */
function identifierName(value: unknown): string | undefined {
	return nodeType(value) && value.type === 'Identifier' && typeof value.name === 'string' ? value.name : undefined;
}

/** Return the literal string value from one parser node. */
function stringValue(value: unknown): string | undefined {
	return nodeType(value) && typeof value.value === 'string' ? value.value : undefined;
}

/** Return the property name for a static member call. */
function memberProperty(value: unknown): string | undefined {
	if (!nodeType(value)) return undefined;
	return identifierName(value.property);
}

/** Return whether a call targets one static object property. */
function memberCall(value: unknown, object: string, property: string): boolean {
	if (!nodeType(value) || memberProperty(value) !== property) return false;
	return identifierName(value.object) === object;
}

/** Return the first string argument supplied to one call. */
function firstString(value: unknown): string | undefined {
	if (!Array.isArray(value)) return undefined;
	return stringValue(value[0]);
}

/** Visit child AST nodes without depending on an unstable generated node union. */
function visit(node: NodeType, parent: NodeType | undefined, accept: (node: NodeType, parent: NodeType | undefined) => void): void {
	accept(node, parent);
	for (const value of Object.values(node)) {
		if (nodeType(value)) visit(value, node, accept);
		else if (Array.isArray(value)) for (const entry of value) if (nodeType(entry)) visit(entry, node, accept);
	}
}

/** Build an identifier-insensitive sequence of node kinds and behavior operators. */
function shape(root: NodeType): string {
	const values: string[] = [];
	visit(root, undefined, (node) => {
		values.push(node.type);
		for (const key of ['operator', 'kind', 'async', 'generator']) {
			const value = node[key];
			if (typeof value === 'string' || typeof value === 'boolean') values.push(`${key}:${value}`);
		}
	});
	return values.join('|');
}

/** Resolve a direct declaration or variable binding name without guessing member ownership. */
function nameOf(node: NodeType, parent: NodeType | undefined): string | undefined {
	const direct = node.id;
	if (nodeType(direct) && direct.type === 'Identifier' && typeof direct.name === 'string') return direct.name;
	if (parent?.type !== 'VariableDeclarator') return undefined;
	const bound = parent.id;
	return nodeType(bound) && bound.type === 'Identifier' && typeof bound.name === 'string' ? bound.name : undefined;
}

/** Build candidate groups from one selected function field. */
function groups(
	functions: readonly FunctionType[],
	keyOf: (value: FunctionType) => string | undefined,
	kind: DuplicateType['kind'],
): readonly DuplicateType[] {
	const values = new Map<string, FunctionType[]>();
	for (const value of functions) {
		const key = keyOf(value);
		if (key === undefined) continue;
		const group = values.get(key) ?? [];
		group.push(value);
		values.set(key, group);
	}
	return Object.freeze([...values.entries()]
		.filter(([, value]) => value.length > 1)
		.map(([key, value]) => Object.freeze({ kind, key, functions: Object.freeze(value) } satisfies DuplicateType))
		.sort((left, right) => right.functions.length - left.functions.length || left.key.localeCompare(right.key)));
}

/** Rank context timer bypasses and exact private lifecycle clones for human ownership review. */
function findings(functions: readonly FunctionType[]): readonly FindingType[] {
	const values: FindingType[] = [];
	for (const value of functions) {
		if (value.exported || !value.usesContext || !value.markers.includes('timer')) continue;
		values.push(Object.freeze({
			kind: 'owner-bypass',
			confidence: 'high',
			reason: 'A private context-aware function starts a wall-clock timer instead of using an injected clock.',
			functions: Object.freeze([value]),
		} satisfies FindingType));
	}
	for (const duplicate of groups(functions.filter((value) => !value.exported && value.name !== undefined), (value) => value.size >= 80 ? value.shape : undefined, 'shape')) {
		if (!duplicate.functions.some((value) => lifecycle(value))) continue;
		if (new Set(duplicate.functions.map((value) => value.package)).size < 2) continue;
		values.push(Object.freeze({
			kind: 'private-lifecycle',
			confidence: 'review',
			reason: 'Private functions in separate packages have matching lifecycle control flow; confirm one owner before extracting code.',
			functions: duplicate.functions,
		} satisfies FindingType));
	}
	return Object.freeze(values.sort((left, right) => left.kind.localeCompare(right.kind) || left.reason.localeCompare(right.reason)));
}

/** Return whether a private helper contains lifecycle control flow worth reviewing across package boundaries. */
function lifecycle(value: FunctionType): boolean {
	return value.markers.includes('abort-listener') || value.markers.includes('clock-wait') || value.markers.includes('promise-race') ||
		value.markers.includes('timer');
}

/** Return whether an unknown value is one parse-tree node. */
function nodeType(value: unknown): value is NodeType {
	return typeof value === 'object' && value !== null && typeof (value as { readonly type?: unknown }).type === 'string';
}

/** Find a one-based source line from one UTF-16 parser offset. */
function line(source: string, offset: number): number {
	let result = 1;
	for (let index = 0; index < offset; index += 1) if (source[index] === '\n') result += 1;
	return result;
}

/** Produce a stable compact FNV-1a fingerprint for a structural token sequence. */
function hash(value: string): string {
	let result = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		result ^= value.charCodeAt(index);
		result = Math.imul(result, 16777619);
	}
	return (result >>> 0).toString(16).padStart(8, '0');
}
