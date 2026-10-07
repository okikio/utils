/**
 * Preserve and index the complete pinned Hono test source without executing it.
 *
 * `capture <checkout>` copies test bytes and the MIT license. `write` derives
 * the AST index and coverage table; `check` verifies hashes, generated output,
 * and executable provenance links. Static registrations are source sites, not
 * expanded or passed tests. Neither callback code nor `each` tables are run.
 * @module
 */
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

/** This pin owns every provenance URL and prevents accidental version refreshes. */
const Upstream = Object.freeze({
	repository: 'https://github.com/honojs/hono',
	commit: '06880c4a2b04de9dd74217f26dd831209b9c01f1',
	version: '4.13.5',
});
const Root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const Corpus = join(Root, 'tests/fixtures/hono-upstream');

/** Preserve exact text together with source offsets and one-based lines. */
interface SpanType {
	readonly start: number;
	readonly end: number;
	readonly line: number;
	readonly endLine: number;
	readonly text: string;
}

/** A scope decision states an applicable target or the concrete missing API. */
interface ScopeType {
	readonly category: string;
	readonly target: string;
	readonly reason: string;
}

/** A manifest entry owns bytes independently of AST interpretation. */
interface SourceType {
	readonly path: string;
	readonly preserved: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly scope: ScopeType;
}

/** An executable mapping is a stated contract selection, not an execution receipt. */
interface LinkType extends Readonly<Record<string, unknown>> {
	readonly upstreamPath: string;
	readonly registrationLine: number;
	readonly localFile: string;
	readonly behavior: string;
	readonly disposition: string;
}

/** Reviewed applicability decisions retain source provenance without pretending to be executable links. */
interface ReviewType extends Readonly<Record<string, unknown>> {
	readonly upstreamPath: string;
	readonly registrationLine: number;
	readonly behavior: string;
	readonly disposition: string;
}

/** Counts describe syntax sites only; callbacks and tables can produce many runtime tests. */
interface RegistrationType {
	readonly id: string;
	readonly kind: 'suite' | 'test';
	readonly callee: string;
	readonly title: SpanType | null;
	readonly titleKind: 'literal' | 'computed' | 'missing';
	readonly site: SpanType;
	readonly body: SpanType | null;
	readonly ancestors: readonly string[];
	readonly dynamicContexts: readonly SpanType[];
	readonly each: readonly SpanType[];
	readonly assertions: readonly SpanType[];
	readonly inputs: readonly SpanType[];
}

/** Lexical indexing deliberately avoids executing test registration expressions. */
export function indexSource(path: string, text: string): readonly RegistrationType[] {
	const source = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true,
		path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const registrations: RegistrationType[] = [];
	const span = (node: ts.Node, includeText = true): SpanType => ({
		start: node.getStart(source),
		end: node.getEnd(),
		line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
		endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
		text: includeText ? node.getText(source) : '',
	});
	const visit = (node: ts.Node, ancestors: readonly string[], dynamic: readonly SpanType[]): void => {
		const registration = ts.isCallExpression(node) ? registrationCall(node) : undefined;
		if (ts.isCallExpression(node) && registration !== undefined) {
			const id = `${path}:${span(node).line}:${
				source.getLineAndCharacterOfPosition(node.getStart(source)).character + 1
			}`;
			const title = node.arguments[0];
			const callback = node.arguments.find((argument) =>
				ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
			);
			const body = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
				? callback.body
				: undefined;
			const assertions: SpanType[] = [];
			const inputs: SpanType[] = [];
			const inspect = (child: ts.Node): void => {
				if (ts.isCallExpression(child) && registrationCall(child) !== undefined) return;
				if (ts.isCallExpression(child)) {
					const name = callName(child.expression);
					if (assertion(child)) assertions.push(span(child));
					if (
						/\.(request|fetch|match|add|parseBody|json|text|formData|arrayBuffer|query|queries|param|header|cookie)$/
							.test(name)
					) {
						inputs.push(span(child));
					}
				}
				if (
					ts.isNewExpression(child) &&
					['Request', 'Response', 'Headers', 'FormData', 'URL', 'ReadableStream'].includes(callName(child.expression))
				) {
					inputs.push(span(child));
				}
				ts.forEachChild(child, inspect);
			};
			if (body) inspect(body);
			const entry: RegistrationType = {
				id,
				kind: registration.root === 'describe' ? 'suite' : 'test',
				callee: node.expression.getText(source),
				title: title ? span(title) : null,
				titleKind: title === undefined
					? 'missing'
					: ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)
					? 'literal'
					: 'computed',
				site: span(node, false),
				body: body ? span(body, registration.root !== 'describe') : null,
				ancestors,
				dynamicContexts: dynamic,
				each: registration.each.map((node) => span(node)),
				assertions,
				inputs,
			};
			registrations.push(entry);
			const nested = entry.kind === 'suite' ? [...ancestors, id] : ancestors;
			// Do not count each(...) factories as additional registrations.
			for (const argument of node.arguments) visit(argument, nested, dynamic);
			return;
		}
		const looping = ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) ||
			ts.isWhileStatement(node) || ts.isDoStatement(node) ||
			(ts.isCallExpression(node) && /\.(forEach|map)$/.test(callName(node.expression)));
		const conditional = ts.isIfStatement(node) || ts.isConditionalExpression(node);
		const contexts = looping || conditional ? [...dynamic, span(node, false)] : dynamic;
		ts.forEachChild(node, (child) => visit(child, ancestors, contexts));
	};
	visit(source, [], []);
	return registrations;
}

/** Unwrap each factories and tagged tables without evaluating or expanding them. */
function registrationCall(call: ts.CallExpression): Readonly<{ root: string; each: readonly ts.Node[] }> | undefined {
	let expression: ts.Expression = call.expression;
	const each: ts.Node[] = [];
	while (ts.isCallExpression(expression) || ts.isTaggedTemplateExpression(expression)) {
		if (ts.isCallExpression(expression)) {
			if (/\.each$/.test(callName(expression.expression))) each.push(...expression.arguments);
			expression = expression.expression;
		} else {
			if (/\.each$/.test(callName(expression.tag))) each.push(expression.template);
			expression = expression.tag;
		}
	}
	const name = callName(expression);
	const root = /^(describe|it|test)(?:\.|$)/.exec(name)?.[1] ?? (name === 'Deno.test' ? 'test' : undefined);
	if (root === undefined || /\.(each|extend)$/.test(name) && each.length === 0) return undefined;
	// Root test calls need a title or callback. Generic type-oriented helpers are not registrations.
	return { root, each };
}

/** Name chains are syntax labels, never a claim that the referenced binding was executed. */
function callName(expression: ts.Expression): string {
	if (ts.isIdentifier(expression)) return expression.text;
	if (ts.isPropertyAccessExpression(expression)) return `${callName(expression.expression)}.${expression.name.text}`;
	if (ts.isCallExpression(expression)) return callName(expression.expression);
	if (ts.isElementAccessExpression(expression)) return `${callName(expression.expression)}.[computed]`;
	return '';
}

/** Match terminal expect matchers and explicit assertions, not the expect factory itself. */
function assertion(call: ts.CallExpression): boolean {
	const name = callName(call.expression);
	return /^(expect|expectTypeOf)\./.test(name) && !/\.(extend|assertions|hasAssertions)$/.test(name) ||
		/^(assert|assert[A-Z]\w*)$/.test(name);
}

/** Shared hooks and router factories affect many tests; retain their bodies without attributing one execution per call site. */
function sharedSource(
	path: string,
	text: string,
): Readonly<{ hooks: readonly SpanType[]; factories: readonly SpanType[] }> {
	const source = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true,
		path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const hooks: SpanType[] = [];
	const factories: SpanType[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const name = callName(node.expression);
			const destination = /^(beforeEach|afterEach|beforeAll|afterAll)$/.test(name)
				? hooks
				: name === 'runTest'
				? factories
				: undefined;
			if (destination) {
				destination.push({
					start: node.getStart(source),
					end: node.getEnd(),
					line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
					endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
					text: node.getText(source),
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return { hooks, factories };
}

/** Every preserved suite is explicitly assigned; unknown source topology stops capture. */
function scope(path: string): ScopeType {
	if (path.startsWith('build/')) {
		return {
			category: 'build-contract',
			target: 'tools/check-packaging.ts; tools/npm.ts',
			reason:
				'Hono build transforms and export validation use Hono manifests; review equivalent Utils artifact guarantees independently.',
		};
	}
	if (path.startsWith('runtime-tests/') || path.startsWith('src/adapter/')) {
		return {
			category: 'host-integration',
			target: 'packages/server; packages/deno; packages/process; packages/worker',
			reason:
				'Host bindings, connection metadata, websocket and streaming callbacks need the named host. Generic Fetch tests do not qualify these adapters.',
		};
	}
	if (path.startsWith('src/router/')) {
		return {
			category: 'router-contract',
			target: 'packages/server/http/router.ts',
			reason:
				'Public method/path/parameter and registration-order cases are applicable; private trie and compiled-regexp representations are Hono-specific. Common cases are instantiated by router wrappers.',
		};
	}
	if (path === 'src/helper/proxy/index.test.ts') {
		return {
			category: 'proxy-contract',
			target: 'packages/server/gateway',
			reason:
				'Forwarded request/response bodies, cookies, aborts and hop-by-hop headers are applicable; strict Gateway policy differences require named outcomes.',
		};
	}
	if (/^src\/(hono|request|context|compose|http-exception)\.test\.ts$/.test(path)) {
		return {
			category: 'core-fetch-contract',
			target: 'packages/server/http; packages/http/request; packages/http/response',
			reason:
				'Request inputs and observable Fetch outputs are applicable. Hono Context properties and composition API need explicit translation rather than a whole-suite compatibility claim.',
		};
	}
	if (path.endsWith('/types.test.ts') || path === 'src/types.test.ts') {
		return {
			category: 'type-contract',
			target: 'packages/server/service; packages/server/endpoint; packages/http/response',
			reason:
				'Compile-time input/output inference must be qualified against each public programming model; preserved expectTypeOf expressions are not runtime tests.',
		};
	}
	if (path.startsWith('src/jsx/') || path.startsWith('src/client/') || path.startsWith('src/preset/')) {
		return {
			category: 'framework-programming-model',
			target: 'no Hono-compatible JSX/client/preset API',
			reason:
				'These suites specify Hono JSX renderers, typed clients or bundled router presets. Utils has no equivalent named API; shared HTTP assertions can still be translated separately.',
		};
	}
	if (path.startsWith('src/middleware/') || path.startsWith('src/utils/') || path.startsWith('src/validator/')) {
		return {
			category: 'http-component',
			target: 'packages/http; packages/server; packages/query; packages/encoding; packages/markup',
			reason:
				'Inspect matching parsing, header, body, security and streaming components. Some auth, JWT, JWK, compression, logging or platform-cache behavior has no corresponding Utils middleware.',
		};
	}
	if (path.startsWith('src/helper/')) {
		return {
			category: 'helper-component',
			target: 'packages/http; packages/server; packages/resource; packages/markup',
			reason:
				'HTTP cookie, accepts, route, streaming and HTML outcomes may translate; Hono factory, dev, testing, SSG and websocket APIs require separate capability decisions.',
		};
	}
	throw new Error(`Unclassified Hono test source: ${path}`);
}

/** Sorting paths makes capture and checks independent of directory enumeration order. */
async function files(directory: string): Promise<readonly string[]> {
	const result: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === '.git' || entry.name === 'node_modules') continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...await files(path));
		else if (entry.isFile()) result.push(path);
	}
	return result.sort();
}

/** Hash original bytes, not normalized or formatted source. */
function hash(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Store plain JSON deterministically, with no wall-clock timestamps. */
async function json(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`);
}

/** Capture complete test sources, including TSX, while keeping automatic discovery inactive. */
async function capture(checkout: string): Promise<void> {
	const pkg = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')) as { version?: string };
	if (pkg.version !== Upstream.version) throw new Error(`Expected Hono ${Upstream.version}, received ${pkg.version}.`);
	const selected = (await files(checkout)).filter((path) => /\.test\.(ts|tsx|json)$/.test(path));
	const entries: SourceType[] = [];
	for (const file of selected) {
		const path = relative(checkout, file).replaceAll('\\', '/');
		const preserved = `source/${path.replace(/\.(ts|tsx|json)$/, '.txt')}`;
		const bytes = await readFile(file);
		await mkdir(dirname(join(Corpus, preserved)), { recursive: true });
		await writeFile(join(Corpus, preserved), bytes);
		entries.push({ path, preserved, bytes: bytes.length, sha256: hash(bytes), scope: scope(path) });
	}
	const license = await readFile(join(checkout, 'LICENSE'));
	await mkdir(Corpus, { recursive: true });
	await writeFile(join(Corpus, 'LICENSE'), license);
	await json(join(Corpus, 'manifest.json'), {
		schemaVersion: 1,
		upstream: Upstream,
		provenance:
			'Pinned checkout supplied for this review. Content hashes qualify retained bytes; they do not assert Git checkout execution.',
		license: { path: 'LICENSE', sha256: hash(license) },
		sources: entries,
	});
}

/** Validate executable links against actual registration sites and local executable source. */
async function links(
	registrations: ReadonlyMap<string, readonly RegistrationType[]>,
): Promise<Readonly<{ links: readonly LinkType[]; audit: readonly ReviewType[] }>> {
	const paths = [
		join(Root, 'tests/fixtures/hono-contracts/coverage.json'),
		join(Root, 'tests/fixtures/hono-proxy/coverage.json'),
		join(Root, 'tests/fixtures/hono-compose/coverage.json'),
	];
	const result: LinkType[] = [];
	const audit: ReviewType[] = [];
	for (const path of paths) {
		let text: string;
		try {
			text = await readFile(path, 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
			throw error;
		}
		const parsed: unknown = JSON.parse(text);
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const header = parsed as Record<string, unknown>;
			const pin = header.upstream !== null && typeof header.upstream === 'object' && !Array.isArray(header.upstream)
				? header.upstream as Record<string, unknown>
				: header;
			if (
				pin.commit !== undefined && pin.commit !== Upstream.commit ||
				pin.version !== undefined && pin.version !== Upstream.version ||
				pin.repository !== undefined && pin.repository !== Upstream.repository
			) {
				throw new Error(`Executable mapping uses a different Hono pin: ${path}`);
			}
		}
		const entries: unknown[] = Array.isArray(parsed)
			? parsed
			: parsed !== null && typeof parsed === 'object' && 'cases' in parsed && Array.isArray(parsed.cases)
			? parsed.cases
			: [];
		if (entries.length === 0) throw new Error(`Empty or unsupported provenance links: ${path}`);
		for (const entry of entries) {
			if (entry === null || typeof entry !== 'object') throw new Error(`Invalid provenance link in ${path}`);
			const link = entry as Record<string, unknown>;
			if (
				typeof link.upstreamPath !== 'string' || typeof link.registrationLine !== 'number' ||
				typeof link.localFile !== 'string' || typeof link.behavior !== 'string' || typeof link.disposition !== 'string'
			) {
				throw new Error(`Incomplete provenance link: ${JSON.stringify(link)}`);
			}
			const sites = registrations.get(link.upstreamPath)?.filter((site) =>
				site.kind === 'test' && site.site.line === link.registrationLine
			) ?? [];
			if (sites.length === 0) {
				throw new Error(`Missing upstream registration: ${link.upstreamPath}:${link.registrationLine}`);
			}
			if (sites.length !== 1) {
				throw new Error(`Ambiguous upstream registration line: ${link.upstreamPath}:${link.registrationLine}`);
			}
			if (
				!link.localFile.startsWith('tests/') || !link.localFile.endsWith('.test.ts') || link.localFile.includes('..')
			) {
				throw new Error(`Invalid local executable path: ${link.localFile}`);
			}
			const local = await readFile(join(Root, link.localFile), 'utf8');
			if (typeof link.localTestTitle === 'string' && !local.includes(link.localTestTitle)) {
				throw new Error(`Missing local test title: ${link.localTestTitle}`);
			}
			result.push({
				...link,
				upstreamPath: link.upstreamPath,
				registrationLine: link.registrationLine,
				localFile: link.localFile,
				behavior: link.behavior,
				disposition: link.disposition,
				coverageSource: relative(Root, path).replaceAll('\\', '/'),
			});
		}
		const reviews = parsed !== null && typeof parsed === 'object' && 'audit' in parsed && Array.isArray(parsed.audit)
			? parsed.audit
			: [];
		const reviewed = new Map<string, Set<number>>();
		for (const value of reviews) {
			if (value === null || typeof value !== 'object') throw new Error(`Invalid applicability review in ${path}`);
			const review = value as Record<string, unknown>;
			if (
				typeof review.upstreamPath !== 'string' || typeof review.registrationLine !== 'number' ||
				typeof review.behavior !== 'string' || typeof review.disposition !== 'string'
			) {
				throw new Error(`Incomplete applicability review: ${JSON.stringify(review)}`);
			}
			const sites = registrations.get(review.upstreamPath)?.filter((site) =>
				site.kind === 'test' && site.site.line === review.registrationLine
			) ?? [];
			if (sites.length !== 1) {
				throw new Error(`Invalid applicability source site: ${review.upstreamPath}:${review.registrationLine}`);
			}
			const lines = reviewed.get(review.upstreamPath) ?? new Set<number>();
			if (lines.has(review.registrationLine)) {
				throw new Error(`Duplicate applicability review: ${review.upstreamPath}:${review.registrationLine}`);
			}
			lines.add(review.registrationLine);
			reviewed.set(review.upstreamPath, lines);
			audit.push({
				...review,
				upstreamPath: review.upstreamPath,
				registrationLine: review.registrationLine,
				behavior: review.behavior,
				disposition: review.disposition,
				coverageSource: relative(Root, path).replaceAll('\\', '/'),
			});
		}
		if (path === join(Root, 'tests/fixtures/hono-compose/coverage.json') && !reviewed.has('src/compose.test.ts')) {
			throw new Error('The complete compose applicability audit is required.');
		}
		for (const [upstreamPath, lines] of reviewed) {
			const missing = registrations.get(upstreamPath)?.filter((site) =>
				site.kind === 'test' && !lines.has(site.site.line)
			) ?? [];
			if (missing.length > 0) {
				throw new Error(
					`Incomplete applicability audit for ${upstreamPath}: ${missing.map((site) => site.site.line).join(', ')}`,
				);
			}
		}
	}
	return { links: result, audit };
}

/** Classify unmapped registrations as review work; preserved suites never become excluded by default. */
function missingStatus(category: string): string {
	if (
		['core-fetch-contract', 'router-contract', 'proxy-contract', 'http-component', 'helper-component'].includes(
			category,
		)
	) {
		return 'unmapped-contract-candidate';
	}
	if (category === 'host-integration') return 'unmapped-host-contract';
	if (category === 'type-contract') return 'unmapped-type-contract';
	if (category === 'build-contract') return 'unmapped-build-contract';
	return 'unmapped-programming-model';
}

/** Keep the complete per-file ledger generated while hand-written interpretation stays editable. */
async function coverageTable(
	entries: readonly SourceType[],
	registrations: ReadonlyMap<string, readonly RegistrationType[]>,
	mapped: readonly LinkType[],
	check: boolean,
): Promise<void> {
	const table = [
		'| Upstream source | Scope | Static test sites | Linked sites | Unmapped contract candidates |',
		'| --- | --- | ---: | ---: | ---: |',
		...entries.map((entry) => {
			const tests = (registrations.get(entry.path) ?? []).filter((site) => site.kind === 'test');
			const linked = tests.filter((site) =>
				mapped.some((link) =>
					link.upstreamPath === entry.path && link.registrationLine === site.site.line
				)
			).length;
			const candidates = missingStatus(entry.scope.category) === 'unmapped-contract-candidate'
				? tests.length - linked
				: 0;
			return `| [${entry.path}](../tests/fixtures/hono-upstream/${entry.preserved}) | ${entry.scope.category} | ${tests.length} | ${linked} | ${candidates} |`;
		}),
	].join('\n');
	const path = join(Root, 'docs/hono-coverage.md');
	const text = await readFile(path, 'utf8');
	const start = '<!-- hono-inventory:start -->';
	const end = '<!-- hono-inventory:end -->';
	if (!text.includes(start) || !text.includes(end)) throw new Error('Hono coverage table markers are missing.');
	const before = text.slice(0, text.indexOf(start) + start.length);
	const after = text.slice(text.indexOf(end));
	const output = `${before}\n\n${table}\n\n${after}`;
	if (check) {
		const retained = text.slice(text.indexOf(start) + start.length, text.indexOf(end));
		// Markdown formatting may pad cells and separator widths without changing the ledger.
		const rows = (value: string) =>
			value.trim().split('\n').map((line) =>
				line.split('|').map((cell) => /^:?-+:?$/.test(cell.trim()) ? cell.trim().replace(/-+/g, '---') : cell.trim())
			);
		if (!isDeepStrictEqual(rows(retained), rows(table))) throw new Error('Hono coverage table is stale; run write.');
	} else await writeFile(path, output);
}

/** Recompute source hashes and derived evidence; check mode rejects drift without writing. */
async function generate(check: boolean): Promise<void> {
	const manifest = JSON.parse(await readFile(join(Corpus, 'manifest.json'), 'utf8')) as {
		upstream: typeof Upstream;
		license: { path: string; sha256: string };
		sources: SourceType[];
	};
	if (JSON.stringify(manifest.upstream) !== JSON.stringify(Upstream)) throw new Error('Hono pin changed.');
	if (hash(await readFile(join(Corpus, manifest.license.path))) !== manifest.license.sha256) {
		throw new Error('Hono license changed.');
	}
	const indexed: Array<
		SourceType & {
			upstreamUrl: string;
			registrations: readonly RegistrationType[];
			hooks: readonly SpanType[];
			factories: readonly SpanType[];
		}
	> = [];
	const registrations = new Map<string, readonly RegistrationType[]>();
	const seen = new Set<string>();
	for (const entry of manifest.sources) {
		if (seen.has(entry.path)) throw new Error(`Duplicate source: ${entry.path}`);
		seen.add(entry.path);
		if (entry.preserved.includes('..') || !entry.preserved.startsWith('source/')) {
			throw new Error('Invalid preserved source path.');
		}
		const bytes = await readFile(join(Corpus, entry.preserved));
		if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) {
			throw new Error(`Source hash mismatch: ${entry.path}`);
		}
		if (JSON.stringify(entry.scope) !== JSON.stringify(scope(entry.path))) {
			throw new Error(`Scope classification drift: ${entry.path}`);
		}
		const sites = /\.test\.tsx?$/.test(entry.path) ? indexSource(entry.path, bytes.toString('utf8')) : [];
		registrations.set(entry.path, sites);
		indexed.push({
			...entry,
			upstreamUrl: `${Upstream.repository}/blob/${Upstream.commit}/${entry.path}`,
			registrations: sites,
			...(/\.test\.tsx?$/.test(entry.path)
				? sharedSource(entry.path, bytes.toString('utf8'))
				: { hooks: [], factories: [] }),
		});
	}
	const preserved = (await files(join(Corpus, 'source'))).map((path) => relative(Corpus, path).replaceAll('\\', '/'));
	if (
		preserved.length !== manifest.sources.length ||
		preserved.some((path) => !manifest.sources.some((entry) => entry.preserved === path))
	) {
		throw new Error('Preserved source inventory has missing or unexpected files.');
	}
	const all = [...registrations.values()].flat();
	const categoryCounts = Object.fromEntries(
		[...new Set(manifest.sources.map((source) => source.scope.category))].sort().map((
			category,
		) => [category, manifest.sources.filter((source) => source.scope.category === category).length]),
	);
	const evidence = await links(registrations);
	const mapped = evidence.links;
	const coverage = indexed.map((entry) => ({
		...entry,
		registrations: entry.registrations.map((site) => ({
			...site,
			review: evidence.audit.filter((review) =>
				review.upstreamPath === entry.path && review.registrationLine === site.site.line
			),
			coverage: site.kind === 'suite' ? { status: 'suite-container', claims: [] } : (() => {
				const claims = mapped.filter((link) =>
					link.upstreamPath === entry.path && link.registrationLine === site.site.line
				);
				return {
					status: claims.length > 0 ? 'linked-contract-no-execution-receipt' : missingStatus(entry.scope.category),
					claims,
				};
			})(),
		})),
	}));
	const unmapped = coverage.flatMap((entry) =>
		entry.registrations.filter((site) => site.coverage.status.startsWith('unmapped-'))
	);
	const document = {
		schemaVersion: 1,
		upstream: Upstream,
		countMeaning:
			'Static lexical sites. each, loops, conditional registration and shared router factories are not expanded; no suite execution is implied.',
		totals: {
			sources: manifest.sources.length,
			suites: all.filter((entry) => entry.kind === 'suite').length,
			testSites: all.filter((entry) => entry.kind === 'test').length,
			computedTitles: all.filter((entry) => entry.titleKind === 'computed').length,
			eachSites: all.filter((entry) => entry.each.length > 0).length,
			dynamicSites: all.filter((entry) => entry.dynamicContexts.length > 0).length,
			linkedContracts: mapped.length,
			auditedTestSites: evidence.audit.length,
			linkedTestSites:
				coverage.flatMap((entry) => entry.registrations).filter((site) =>
					site.coverage.status === 'linked-contract-no-execution-receipt'
				).length,
			unmappedByStatus: Object.fromEntries(
				[...new Set(unmapped.map((site) => site.coverage.status))].sort().map((
					status,
				) => [status, unmapped.filter((site) => site.coverage.status === status).length]),
			),
			categoryCounts,
		},
		links: mapped,
		audit: evidence.audit,
		sources: coverage,
	};
	const output = `${JSON.stringify(document, null, '\t')}\n`;
	const path = join(Corpus, 'inventory.json');
	if (check) {
		if (!isDeepStrictEqual(JSON.parse(await readFile(path, 'utf8')), document)) {
			throw new Error('Hono AST inventory is stale; run write.');
		}
	} else await writeFile(path, output);
	await coverageTable(manifest.sources, registrations, mapped, check);
	console.log(JSON.stringify(document.totals));
}

if (import.meta.main) {
	const [mode = 'check', checkout] = Deno.args;
	if (mode === 'capture') {
		if (!checkout) throw new Error('capture requires a pinned checkout directory.');
		await capture(resolve(checkout));
		await generate(false);
	} else if (mode === 'write' || mode === 'check') await generate(mode === 'check');
	else throw new Error(`Unknown inventory operation: ${mode}`);
}
