/**
 * Extract stylesheet dependencies and feature evidence through a CSS parser. A regular expression cannot reliably distinguish a URL token from a quoted string, a comment or a nested rule.
 *
 * Extract URL references first, then collect custom properties, media features and pseudo classes from the same parsed stylesheet. References retain source positions for diagnostics. Resolve relative URLs against the stylesheet URL in your application. Parsing performs no network fetch and does not tell you whether a feature is supported by a particular browser.
 *
 * @example
 * ```ts
 * import * as css from '@okikio/css';
 * const source = '@import "theme.css"; .hero { background: url("hero.webp"); --accent: blue; }';
 * const parsed = css.parse(source);
 * console.log(JSON.stringify(css.resources(parsed).map((item) => item.url)));
 * console.log(JSON.stringify(css.customProperties(parsed)));
 * ```
 *
 * @module
 */
import {
	type Atrule,
	type CssLocation,
	type CssNode,
	generate,
	parse as parseCss,
	type SyntaxParseError,
	walk,
} from 'css-tree';

/** CSS source context accepted by CSSTree. */
export type ParseContext =
	| 'stylesheet'
	| 'atrule'
	| 'atrulePrelude'
	| 'mediaQueryList'
	| 'mediaQuery'
	| 'condition'
	| 'rule'
	| 'selectorList'
	| 'selector'
	| 'block'
	| 'declarationList'
	| 'declaration'
	| 'value';

/** One recoverable CSS parser problem. */
export interface ParseProblem {
	/** Human-readable explanation; use the stable code or discriminant for program decisions. */
	readonly message: string;
	/** Position retained by the source or selected window contract. */
	readonly offset: number;
	/** Source line reported for this observation. */
	readonly line: number;
	/** Source column associated with this observation. */
	readonly column: number;
}

/** Parsed CSS AST plus non-fatal parser problems. */
export interface ParsedStylesheet {
	/** Parsed syntax tree retained for source-aware interpretation. */
	readonly ast: CssNode;
	/** Parser observations retained alongside the CSS syntax tree. */
	readonly problems: readonly ParseProblem[];
}

/** Kind of external resource referenced by a CSS construct. */
export type ResourceKind = 'font' | 'image' | 'import' | 'other';

/** One external URL referenced by CSS and the syntax context that owns it. */
export interface ResourceReference {
	/** Source or resource URL associated with this observation. */
	readonly url: string;
	/** Stable discriminant that selects the documented variant. */
	readonly kind: ResourceKind;
	/** CSS property associated with this resource reference. */
	readonly property?: string;
	/** CSS at-rule associated with this resource reference. */
	readonly atRule?: string;
	/** Source or parse-tree location associated with the observation. */
	readonly location?: CssLocation;
}

/**
 * Parse CSS into a detailed CSSTree AST.
 *
 * Parse errors are retained as data because browser CSS frequently contains a
 * recoverable invalid declaration or vendor syntax that should not discard the
 * rest of the stylesheet.
 *
 * @example
 * ```ts
 * import * as css from '@okikio/css';
 *
 * const parsed = css.parse('@font-face { src: url(font.woff2) } .hero { background: url(hero.webp) }');
 * console.log(css.resources(parsed));
 * ```
 */
export function parse(
	source: string,
	options: { readonly context?: ParseContext; readonly filename?: string } = {},
): ParsedStylesheet {
	const problems: ParseProblem[] = [];
	const ast = parseCss(source, {
		...(options.context && options.context !== 'stylesheet' ? { context: options.context } : {}),
		...(options.filename ? { filename: options.filename } : {}),
		positions: true,
		parseCustomProperty: true,
		onParseError(error) {
			problems.push(parseProblem(error));
		},
	});
	return { ast, problems };
}

/** Return external resource references from parsed CSS without conflating fonts and images. */
export function resources(parsed: ParsedStylesheet): readonly ResourceReference[] {
	const references: ResourceReference[] = [];
	const keys = new Set<string>();
	walk(parsed.ast, {
		visit: 'Url',
		enter(node) {
			addReference(references, keys, {
				url: node.value,
				kind: classifyUrl(this.declaration?.property, this.atrule),
				...(this.declaration ? { property: this.declaration.property } : {}),
				...(this.atrule ? { atRule: this.atrule.name } : {}),
				...(node.loc ? { location: node.loc } : {}),
			});
		},
	});

	walk(parsed.ast, {
		visit: 'Atrule',
		enter(node) {
			if (node.name.toLowerCase() !== 'import' || !node.prelude) return;
			walk(node.prelude, {
				enter(child: CssNode) {
					if (child.type !== 'String') return;
					addReference(references, keys, {
						url: child.value,
						kind: 'import',
						atRule: node.name,
						...(child.loc ? { location: child.loc } : {}),
					});
				},
			});
		},
	});
	return references.toSorted(
		(left, right) =>
			(left.location?.start.offset ?? Number.MAX_SAFE_INTEGER) -
			(right.location?.start.offset ?? Number.MAX_SAFE_INTEGER),
	);
}

/** Parse CSS and immediately return its external resource references. */
export function parseResources(
	source: string,
	options: { readonly context?: ParseContext; readonly filename?: string } = {},
): readonly ResourceReference[] {
	return resources(parse(source, options));
}

/** Return declared CSS custom property names in source order without duplicates. */
export function customProperties(parsed: ParsedStylesheet): readonly string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	walk(parsed.ast, {
		visit: 'Declaration',
		enter(node) {
			if (!node.property.startsWith('--') || seen.has(node.property)) return;
			seen.add(node.property);
			names.push(node.property);
		},
	});
	return names;
}

/** Return media feature names used by the stylesheet, such as `prefers-reduced-motion`. */
export function mediaFeatures(parsed: ParsedStylesheet): readonly string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	walk(parsed.ast, {
		visit: 'Feature',
		enter(node) {
			const name = node.name.toLowerCase();
			if (seen.has(name)) return;
			seen.add(name);
			names.push(name);
		},
	});
	return names;
}

/** Return pseudo-class names used by selectors, such as `focus-visible`. */
export function pseudoClasses(parsed: ParsedStylesheet): readonly string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	walk(parsed.ast, {
		visit: 'PseudoClassSelector',
		enter(node) {
			const name = node.name.toLowerCase();
			if (seen.has(name)) return;
			seen.add(name);
			names.push(name);
		},
	});
	return names;
}

/** Generate normalized CSS for a parsed node when a caller needs an inspectable representation. */
export function generateSource(node: CssNode): string {
	return generate(node);
}

function classifyUrl(propertyName: string | undefined, atRule: Atrule | null): ResourceKind {
	const atRuleName = atRule?.name.toLowerCase();
	if (atRuleName === 'import') return 'import';
	if (atRuleName === 'font-face') return 'font';

	const property = propertyName?.toLowerCase();
	if (!property) return 'other';
	if (IMAGE_PROPERTIES.has(property)) return 'image';
	return 'other';
}

function addReference(references: ResourceReference[], keys: Set<string>, reference: ResourceReference): void {
	const key = `${reference.kind}\u0000${reference.property ?? ''}\u0000${reference.atRule ?? ''}\u0000${reference.url}`;
	if (keys.has(key)) return;
	keys.add(key);
	references.push(reference);
}

function parseProblem(error: SyntaxParseError): ParseProblem {
	return { message: error.message, offset: error.offset, line: error.line, column: error.column };
}

const IMAGE_PROPERTIES = new Set([
	'background',
	'background-image',
	'border-image',
	'border-image-source',
	'content',
	'cursor',
	'list-style',
	'list-style-image',
	'mask',
	'mask-border-source',
	'mask-image',
]);
