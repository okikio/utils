import { is as matchesCss, selectAll as selectCssAll, selectOne as selectCssOne } from 'css-select';
import { isTag, type AnyNode, type Document, type Element } from 'domhandler';
import { textContent } from 'domutils';
import { parse as parseHtml, type ParserError, type Token } from 'parse5';
import { adapter, type Htmlparser2TreeAdapterMap } from 'parse5-htmlparser2-tree-adapter';

/** One HTML parser problem with source coordinates when parse5 provides them. */
export interface ParseProblem {
	readonly code: string;
	readonly startLine?: number;
	readonly startColumn?: number;
	readonly startOffset?: number;
	readonly endLine?: number;
	readonly endColumn?: number;
	readonly endOffset?: number;
}

/** WHATWG-parsed source HTML plus non-fatal parser problems. */
export interface ParsedDocument {
	readonly document: Document;
	readonly problems: readonly ParseProblem[];
}

/** Any parsed htmlparser2-compatible node. */
export type Node = AnyNode;
/** Parsed HTML document root. */
export type HtmlDocument = Document;
/** Parsed HTML element node. */
export type HtmlElement = Element;

type LocatedNode = AnyNode & {
	readonly sourceCodeLocation?: Token.Location | Token.ElementLocation | null;
};

/**
 * Parse source HTML with parse5's WHATWG parser and retain source locations.
 *
 * The returned document uses the htmlparser2 tree shape so CSS selectors can be
 * evaluated without reparsing the source through a second HTML parser.
 *
 * @example
 * ```ts
 * import * as html from '@okikio/html';
 *
 * const parsed = html.parse('<main><a href="/pricing">Pricing</a></main>');
 * const link = html.selectOne(parsed.document, 'a[href]');
 * if (link) console.log(html.attribute(link, 'href'));
 * ```
 */
export function parse(source: string): ParsedDocument {
	const problems: ParseProblem[] = [];
	const document = parseHtml<Htmlparser2TreeAdapterMap>(source, {
		treeAdapter: adapter,
		sourceCodeLocationInfo: true,
		onParseError(error) {
			problems.push(parseProblem(error));
		},
	});
	return { document, problems };
}

/** Return all descendants that match a CSS selector. */
export function selectAll(root: Node, selector: string): readonly HtmlElement[] {
	return selectCssAll(selector, root);
}

/** Return the first descendant that matches a CSS selector. */
export function selectOne(root: Node, selector: string): HtmlElement | null {
	return selectCssOne(selector, root);
}

/** Return whether an element matches a CSS selector. */
export function matches(element: HtmlElement, selector: string): boolean {
	return matchesCss(element, selector);
}

/** Get one attribute without exposing the parser's attribute storage shape. */
export function attribute(element: HtmlElement, name: string): string | null {
	return Object.hasOwn(element.attribs, name) ? element.attribs[name] ?? '' : null;
}

/** Return whether an element contains an attribute, including an empty attribute. */
export function hasAttribute(element: HtmlElement, name: string): boolean {
	return Object.hasOwn(element.attribs, name);
}

/** Return normalized descendant text according to the parsed source tree. */
export function text(node: Node): string {
	return textContent(node);
}

/** Return direct child elements, excluding text, comments, and directives. */
export function children(element: HtmlElement): readonly HtmlElement[] {
	return element.children.filter(isTag);
}

/** Return the nearest parent element, if one exists. */
export function parent(element: HtmlElement): HtmlElement | null {
	let current = element.parent;
	while (current) {
		if (isTag(current)) return current;
		current = current.parent;
	}
	return null;
}

/** Return the previous element sibling, ignoring text and comment nodes. */
export function previous(element: HtmlElement): HtmlElement | null {
	let current = element.prev;
	while (current) {
		if (isTag(current)) return current;
		current = current.prev;
	}
	return null;
}

/** Return the lower-case source tag name. */
export function tagName(element: HtmlElement): string {
	return element.name.toLowerCase();
}

/** Return parse5 source coordinates for a parsed node. */
export function location(node: Node): Token.Location | Token.ElementLocation | undefined {
	return (node as LocatedNode).sourceCodeLocation ?? undefined;
}

function parseProblem(error: ParserError): ParseProblem {
	return {
		code: error.code,
		...(error.startLine !== undefined ? { startLine: error.startLine } : {}),
		...(error.startCol !== undefined ? { startColumn: error.startCol } : {}),
		...(error.startOffset !== undefined ? { startOffset: error.startOffset } : {}),
		...(error.endLine !== undefined ? { endLine: error.endLine } : {}),
		...(error.endCol !== undefined ? { endColumn: error.endCol } : {}),
		...(error.endOffset !== undefined ? { endOffset: error.endOffset } : {}),
	};
}
