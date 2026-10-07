/**
 * Reject known fragile test patterns without inspecting strings or comments as code.
 *
 * This audit uses the existing Oxc parser. It is a guard for concrete mistakes,
 * not a substitute for reviewing a test's oracle, ownership, or synchronization.
 * Reviewed exceptions match a rule, file, function, and operation with an exact
 * occurrence count. Moving or multiplying an exception requires another review.
 * @module
 */
import { parseSync } from 'oxc-parser';

/** One prohibited test pattern found in executable syntax. */
export interface FindingType {
	readonly file: string;
	readonly line: number;
	readonly rule: string;
	readonly function: string;
	readonly operation: string;
}

/** One narrow exception whose reason documents the observable contract. */
export interface ExceptionType {
	readonly file: string;
	readonly rule: string;
	readonly function: string;
	readonly operation: string;
	readonly count: number;
	readonly reason: string;
}

/** Findings and parse errors remain distinct from reviewed exceptions. */
export interface AuditType {
	readonly files: number;
	readonly findings: readonly FindingType[];
	readonly exceptions: readonly FindingType[];
	readonly errors: readonly string[];
}

/** Read-only structural view of the parser's discriminated AST. */
interface NodeType {
	readonly type: string;
	readonly start: number;
	readonly end: number;
	readonly [key: string]: unknown;
}

/** Inspect one test source; fixture strings and comments do not become test code. */
export function inspect(source: string, file = 'fixture.test.ts'): readonly FindingType[] {
	const parsed = parseSync(file, source);
	if (parsed.errors.length > 0) throw new SyntaxError(parsed.errors.map((error) => error.message).join('\n'));
	const findings: FindingType[] = [];
	const bindings = new Map<string, string>();
	visit(parsed.program, [], (node) => {
		if (node.type !== 'ImportDeclaration' || !isNode(node.source)) return;
		const from = node.source.value;
		for (const item of nodes(node.specifiers)) {
			if (!isNode(item.local) || typeof item.local.name !== 'string') continue;
			const imported = isNode(item.imported) ? item.imported.name : undefined;
			if ((from === '@std/async' || from === '@std/async/delay') && imported === 'delay') {
				bindings.set(item.local.name, 'delay');
			}
			if ((from === 'node:timers/promises' || from === 'node:timers') && imported === 'setTimeout') {
				bindings.set(item.local.name, 'setTimeout');
			}
			if (from === 'node:timers' && imported === 'setInterval') bindings.set(item.local.name, 'setInterval');
			if (from === 'fast-check' && item.type !== 'ImportSpecifier') bindings.set(item.local.name, 'fast-check');
		}
	});
	visit(parsed.program, [], (node, ancestors) => {
		const operation = node.type === 'CallExpression' ? name(node.callee) : node.type;
		let rule: string | undefined;
		if (node.type === 'CallExpression') {
			const effective = bindings.get(operation) ?? operation;
			if (
				['setTimeout', 'setInterval', 'delay', 'globalThis.setTimeout', 'globalThis.setInterval'].includes(effective)
			) {
				rule = 'wall-clock-timer';
			} else if (['Date.now', 'performance.now', 'new Date'].includes(operation)) {
				rule = 'wall-clock-now';
			} else if (operation === 'Math.random') {
				rule = 'unseeded-random';
			} else if (/\.(?:toMatchSnapshot|toMatchInlineSnapshot)$/.test(operation)) {
				rule = 'snapshot';
			} else if (
				operation.endsWith('.toThrow') && nodes(node.arguments).some((argument) => argument.regex !== undefined)
			) {
				rule = 'diagnostic-regex';
			} else if (operation.endsWith('.catch') && nodes(node.arguments).some(emptyCallback)) {
				rule = 'swallowed-rejection';
			} else if (
				operation.endsWith('.assert') && isNode(node.callee) && isNode(node.callee.object) &&
				bindings.get(String(node.callee.object.name)) === 'fast-check'
			) {
				const options = nodes(node.arguments).at(1);
				if (
					!options || options.type !== 'ObjectExpression' ||
					!nodes(options.properties).some((property) => name(property.key) === 'seed')
				) rule = 'unseeded-property';
			} else if (
				(operation === 'assert.rejects' || operation.includes('.rejects.') || operation.includes('.resolves.')) &&
				ancestors.at(-1)?.type === 'ExpressionStatement'
			) {
				rule = 'unawaited-assertion';
			}
		} else if (node.type === 'NewExpression' && name(node.callee) === 'Date' && nodes(node.arguments).length === 0) {
			rule = 'wall-clock-now';
		} else if (node.type === 'CatchClause' && isNode(node.body) && nodes(node.body.body).length === 0) {
			rule = 'empty-catch';
		}
		if (rule !== undefined) {
			findings.push({
				file,
				line: source.slice(0, node.start).split('\n').length,
				rule,
				function: owner(ancestors),
				operation,
			});
		}
	});
	return findings;
}

/** Audit all canonical test files and reject stale, duplicated, or overly broad exemptions. */
export async function audit(root: string, exceptions: readonly ExceptionType[] = []): Promise<AuditType> {
	const findings: FindingType[] = [];
	const errors: string[] = [];
	let files = 0;
	for await (const file of testFiles(root)) {
		files += 1;
		try {
			findings.push(...inspect(await Deno.readTextFile(`${root}/${file}`), file));
		} catch (error) {
			errors.push(`${file}: ${String(error)}`);
		}
	}
	const accepted = new Set<FindingType>();
	const keys = new Set<string>();
	for (const exception of exceptions) {
		const key = JSON.stringify([exception.file, exception.rule, exception.function, exception.operation]);
		if (
			keys.has(key) || !Number.isSafeInteger(exception.count) || exception.count < 1 ||
			exception.reason.trim().length === 0
		) {
			errors.push(`Invalid or duplicate exception: ${key}`);
			continue;
		}
		keys.add(key);
		const matches = findings.filter((finding) =>
			finding.file === exception.file && finding.rule === exception.rule &&
			finding.function === exception.function && finding.operation === exception.operation
		);
		if (matches.length !== exception.count) {
			errors.push(`Exception count changed for ${key}: ${matches.length} != ${exception.count}`);
		}
		for (const match of matches) accepted.add(match);
	}
	return { files, findings: findings.filter((finding) => !accepted.has(finding)), exceptions: [...accepted], errors };
}

/** Discover source tests without following caches, generated packages, or host investigation trees. */
export async function* testFiles(root: string, prefix = ''): AsyncGenerator<string> {
	const entries = await Array.fromAsync(Deno.readDir(`${root}/${prefix}`));
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage', 'vendor'].includes(entry.name)) continue;
		const relative = `${prefix}${entry.name}`;
		if (entry.isDirectory) yield* testFiles(root, `${relative}/`);
		else if (entry.isFile && /(?:\.test|_test)\.ts$/.test(entry.name)) yield relative;
	}
}

/** Visit AST nodes with their parents, excluding scalar strings and parser metadata. */
function visit(
	value: unknown,
	ancestors: readonly NodeType[],
	callback: (node: NodeType, ancestors: readonly NodeType[]) => void,
): void {
	if (!isNode(value)) return;
	callback(value, ancestors);
	for (const [key, child] of Object.entries(value)) {
		if (['comments', 'tokens', 'loc', 'range', 'parent'].includes(key)) continue;
		if (Array.isArray(child)) { for (const item of child) visit(item, [...ancestors, value], callback); }
		else visit(child, [...ancestors, value], callback);
	}
}

/** Adapt unknown parser values without weakening the rest of the audit's types. */
function isNode(value: unknown): value is NodeType {
	return typeof value === 'object' && value !== null && typeof (value as { readonly type?: unknown }).type === 'string';
}

/** Select AST children from a parser-owned array. */
function nodes(value: unknown): readonly NodeType[] {
	return Array.isArray(value) ? value.filter(isNode) : [];
}

/** Name an operation structurally so formatting and comments never affect an exemption. */
function name(value: unknown): string {
	if (!isNode(value)) return '';
	if (value.type === 'Identifier') return String(value.name);
	if (value.type === 'MemberExpression') return `${name(value.object)}.${name(value.property)}`;
	if (value.type === 'CallExpression') return `${name(value.callee)}()`;
	if (value.type === 'Literal' && typeof value.value === 'string') return value.value;
	return '';
}

/** Return the named helper or test callback that owns an operation. */
function owner(ancestors: readonly NodeType[]): string {
	for (let index = ancestors.length - 1; index >= 0; index -= 1) {
		const node = ancestors[index]!;
		if (node.type === 'FunctionDeclaration' && isNode(node.id)) return name(node.id);
		if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') continue;
		const parent = ancestors[index - 1];
		if (parent?.type === 'CallExpression') {
			const label = nodes(parent.arguments).at(0);
			if (label?.type === 'Literal' && typeof label.value === 'string') return label.value;
		}
		if (parent?.type === 'VariableDeclarator') return name(parent.id);
	}
	return '<module>';
}

/** Catch callbacks that discard a rejection without returning or observing it. */
function emptyCallback(node: NodeType): boolean {
	return ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type) && isNode(node.body) &&
		node.body.type === 'BlockStatement' && nodes(node.body.body).length === 0;
}

if (import.meta.main) {
	const root = Deno.cwd();
	const exceptions = JSON.parse(await Deno.readTextFile(`${root}/docs/fragile-exceptions.json`)) as ExceptionType[];
	const result = await audit(root, exceptions);
	console.log(JSON.stringify(result, null, 2));
	if (result.findings.length > 0 || result.errors.length > 0) Deno.exit(1);
}
