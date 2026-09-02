import {
	parse as parseXmlDocument,
	parseXmlRecordsFromBytes,
	type XmlAttributeIterator,
	type XmlElement,
	type XmlNode,
	XmlSyntaxError,
} from '@std/xml';

/** Syntax policy for imperfect real-world sitemap inputs. */
export type SitemapParsePolicy = 'standards' | 'lenient';

/** One localized alternate declared beside a sitemap URL. */
export interface SitemapAlternate {
	readonly href: string;
	readonly hreflang: string;
}

/** Source format that produced a normalized sitemap record. */
export type SitemapFormat = 'xml' | 'rss' | 'atom' | 'text';

/** One page/resource URL declared by a sitemap source. */
export interface SitemapUrlRecord {
	readonly kind: 'url';
	readonly loc: string;
	readonly format: SitemapFormat;
	readonly lastModified?: string;
	readonly changeFrequency?: string;
	readonly priority?: number;
	readonly alternates: readonly SitemapAlternate[];
}

/** One child source declared by an XML sitemap index. */
export interface SitemapSourceRecord {
	readonly kind: 'sitemap';
	readonly loc: string;
	readonly format: 'xml';
	readonly lastModified?: string;
	readonly alternates: readonly SitemapAlternate[];
}

/** Format-neutral record produced by one sitemap resource. */
export type SitemapRecord = SitemapUrlRecord | SitemapSourceRecord;

/** Non-fatal or fatal parser evidence retained for the caller. */
export interface SitemapProblem {
	readonly code: 'doctype_not_allowed' | 'malformed_xml' | 'nonstandard_text_comment' | 'unexpected_sitemap_namespace';
	readonly message: string;
}

/** Result metadata from an incrementally parsed sitemap source. */
export interface SitemapStreamResult {
	readonly byteLength: number;
	readonly capped: boolean;
	readonly format?: SitemapFormat;
	readonly problems: readonly SitemapProblem[];
}

const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const XML_PREFIX_BYTES = 4 * 1024;
const XML_PARSER_CHUNK_BYTES = 64 * 1024;
const XML_MAX_DEPTH = 256;
const XML_MAX_ATTRIBUTES = 4_096;

/** Parse one complete decoded sitemap/feed/text string without network access. */
export function parse(input: {
	readonly text: string;
	readonly url: string;
	readonly contentType?: string;
	readonly policy?: SitemapParsePolicy;
}): readonly SitemapRecord[] {
	const contentType = input.contentType?.toLowerCase() ?? '';
	if (isTextSource(input.url, contentType)) return parseText(input.text, input.policy ?? 'lenient').records;
	if (!looksLikeXml(input.text, input.url, contentType)) return [];

	try {
		const document = parseXmlDocument(input.text, {
			xmlVersion: detectXmlVersion(input.text),
			disallowDoctype: true,
			maxDepth: XML_MAX_DEPTH,
			maxAttributes: XML_MAX_ATTRIBUTES,
			trackPosition: false,
		});
		const records: SitemapRecord[] = [];
		const collector = new SitemapXmlCollector(input.policy ?? 'lenient', (record) => records.push(record));
		walkXmlElement(document.root, collector);
		return deduplicateRecords(records);
	} catch {
		return [];
	}
}

/** Get only normalized locations from one complete sitemap resource. */
export function locations(input: {
	readonly text: string;
	readonly url: string;
	readonly contentType?: string;
	readonly policy?: SitemapParsePolicy;
}): readonly string[] {
	return parse(input).map((record) => record.loc);
}

/**
 * Incrementally parse one sitemap/feed/text byte stream.
 *
 * `@std/xml` owns XML tokenization and well-formedness. the application owns sitemap
 * semantics and explicitly resolves default XML namespaces because @std/xml
 * intentionally reports `uri = undefined` for unprefixed element callbacks.
 */
export async function parseStream(input: {
	readonly stream: ReadableStream<Uint8Array<ArrayBufferLike>>;
	readonly url: string;
	readonly contentType?: string;
	readonly policy?: SitemapParsePolicy;
	readonly maxBytes?: number;
	readonly signal?: AbortSignal;
	readonly onRecord: (record: SitemapRecord) => void | Promise<void>;
}): Promise<SitemapStreamResult> {
	const source = new SitemapByteSource(input.stream, input.maxBytes, input.signal);
	await source.prepare();
	const contentType = input.contentType?.toLowerCase() ?? '';
	const prefix = source.prefixText();
	const mode = isTextSource(input.url, contentType)
		? 'text'
		: isXmlSource(input.url, contentType)
		? 'xml'
		: prefix.trimStart().startsWith('<')
		? 'xml'
		: 'text';
	const problems: SitemapProblem[] = [];
	let format: SitemapFormat | undefined = mode === 'text' ? 'text' : undefined;

	try {
		if (mode === 'text') {
			await parseTextStream(source.iterate(), input.policy ?? 'lenient', problems, input.onRecord);
		} else {
			const collector = new SitemapXmlCollector(input.policy ?? 'lenient', () => undefined);
			const records = parseXmlRecordsFromBytes<SitemapRecord>(
				source.iterate(),
				(emit: (record: SitemapRecord) => void) => collector.callbacks(emit),
				{
					xmlVersion: detectXmlVersion(prefix),
					disallowDoctype: true,
					maxDepth: XML_MAX_DEPTH,
					maxAttributes: XML_MAX_ATTRIBUTES,
					trackPosition: false,
					ignoreComments: true,
					ignoreProcessingInstructions: true,
				},
			);
			for await (const record of records) await input.onRecord(record);
			format = collector.format();
			const namespaceProblem = collector.namespaceProblem();
			if (namespaceProblem) problems.push(namespaceProblem);
		}
	} catch (error) {
		if (error instanceof SitemapByteLimitReached) {
			// Deliberate Crawl policy truncation is reported through `capped`.
		} else if (input.signal?.aborted) {
			throw input.signal.reason ?? error;
		} else if (error instanceof XmlSyntaxError) {
			problems.push(xmlProblem(error));
		} else {
			throw error;
		}
	} finally {
		await source.close();
	}

	return {
		byteLength: source.byteLength,
		capped: source.capped,
		...(format ? { format } : {}),
		problems,
	};
}

interface CapturedXmlText {
	readonly tagName: 'loc' | 'link' | 'lastmod' | 'changefreq' | 'priority';
	text: string;
}

interface MutableXmlRecord {
	readonly kind: 'url' | 'sitemap';
	url?: string;
	lastModified?: string;
	changeFrequency?: string;
	priority?: number;
	alternates: SitemapAlternate[];
}

interface XmlStart {
	readonly rawName: string;
	readonly uri?: string;
	readonly attributes: Readonly<Record<string, string>>;
}

/** Sitemap semantic reducer shared by complete-tree and streaming @std/xml APIs. */
class SitemapXmlCollector {
	readonly #defaultNamespaces: (string | undefined)[] = [];
	readonly #policy: SitemapParsePolicy;
	readonly #fallbackEmit: (record: SitemapRecord) => void;
	#capture: CapturedXmlText | undefined;
	#current: MutableXmlRecord | undefined;
	#format: SitemapFormat | undefined;
	#namespaceProblem: SitemapProblem | undefined;

	constructor(policy: SitemapParsePolicy, emit: (record: SitemapRecord) => void) {
		this.#policy = policy;
		this.#fallbackEmit = emit;
	}

	format(): SitemapFormat | undefined {
		return this.#format;
	}

	namespaceProblem(): SitemapProblem | undefined {
		return this.#namespaceProblem;
	}

	callbacks(emit: (record: SitemapRecord) => void) {
		return {
			onStartElement: (
				name: string,
				_colonIndex: number,
				uri: string | undefined,
				attributes: XmlAttributeIterator,
			) => this.start({ rawName: name, ...(uri ? { uri } : {}), attributes: attributesToRecord(attributes) }, emit),
			onText: (text: string) => this.text(text),
			onCData: (text: string) => this.text(text),
			onEndElement: (name: string, _colonIndex: number, uri: string | undefined) => this.end(name, uri, emit),
		};
	}

	start(input: XmlStart, emit = this.#fallbackEmit): void {
		const inheritedDefault = this.#defaultNamespaces.at(-1);
		const defaultNamespace = input.attributes.xmlns ?? inheritedDefault;
		this.#defaultNamespaces.push(defaultNamespace);
		const local = localName(input.rawName);
		const uri = resolvedElementNamespace(input.rawName, input.uri, defaultNamespace);
		if (!this.#format) {
			if (local === 'rss') this.#format = 'rss';
			else if (local === 'feed') this.#format = 'atom';
			else if (sitemapElement(local, uri, 'urlset', this.#policy) || sitemapElement(local, uri, 'sitemapindex', this.#policy)) {
				this.#format = 'xml';
			} else if (this.#defaultNamespaces.length === 1 && (local === 'urlset' || local === 'sitemapindex')) {
				this.#namespaceProblem = {
					code: 'unexpected_sitemap_namespace',
					message: `Expected Sitemap namespace ${SITEMAP_NAMESPACE}, received ${uri ?? '(none)'}.`,
				};
			}
		}

		if (sitemapElement(local, uri, 'url', this.#policy)) this.#current = { kind: 'url', alternates: [] };
		else if (sitemapElement(local, uri, 'sitemap', this.#policy)) this.#current = { kind: 'sitemap', alternates: [] };

		if (this.#current && sitemapElement(local, uri, 'loc', this.#policy)) {
			this.#capture = { tagName: 'loc', text: '' };
			return;
		}
		if (this.#current && ['lastmod', 'changefreq', 'priority'].includes(local) && sitemapElement(local, uri, local, this.#policy)) {
			this.#capture = { tagName: local as CapturedXmlText['tagName'], text: '' };
			return;
		}
		if (local !== 'link') return;
		const href = getAttribute(input.attributes, 'href')?.trim();
		const rel = getAttribute(input.attributes, 'rel')?.trim().toLowerCase();
		const hreflang = getAttribute(input.attributes, 'hreflang')?.trim().toLowerCase();
		if (this.#current && href && isHttpUrl(href) && rel === 'alternate' && hreflang) {
			if (!this.#current.alternates.some((entry) => entry.href === href && entry.hreflang === hreflang)) {
				this.#current.alternates.push({ href, hreflang });
			}
			return;
		}
		const isAtomPageLink = this.#format === 'atom' && (rel === undefined || rel === '' || rel === 'alternate');
		if (href && isHttpUrl(href) && isAtomPageLink) {
			emit({ kind: 'url', loc: href, format: 'atom', alternates: [] });
		}
		if (!href && this.#format === 'rss' && !input.rawName.includes(':')) {
			this.#capture = { tagName: 'link', text: '' };
		}
	}

	text(value: string): void {
		if (this.#capture) this.#capture.text += value;
	}

	end(rawName: string, callbackUri?: string, emit = this.#fallbackEmit): void {
		const defaultNamespace = this.#defaultNamespaces.at(-1);
		const local = localName(rawName);
		const uri = resolvedElementNamespace(rawName, callbackUri, defaultNamespace);
		if (this.#capture && local === this.#capture.tagName && (
			this.#capture.tagName === 'link' || sitemapElement(local, uri, this.#capture.tagName, this.#policy)
		)) {
			const value = this.#capture.text.trim();
			if (this.#capture.tagName === 'loc' && isHttpUrl(value)) {
				if (this.#current) this.#current.url = value;
				else emit({ kind: 'url', loc: value, format: this.#format ?? 'xml', alternates: [] });
			} else if (this.#capture.tagName === 'lastmod' && this.#current && value) {
				this.#current.lastModified = value;
			} else if (this.#capture.tagName === 'changefreq' && this.#current && value) {
				this.#current.changeFrequency = value;
			} else if (this.#capture.tagName === 'priority' && this.#current && value) {
				const priority = Number(value);
				if (Number.isFinite(priority)) this.#current.priority = priority;
			} else if (this.#capture.tagName === 'link' && isHttpUrl(value)) {
				emit({ kind: 'url', loc: value, format: this.#format ?? 'rss', alternates: [] });
			}
			this.#capture = undefined;
		}

		const recordUrl = this.#current?.url;
		if ((sitemapElement(local, uri, 'url', this.#policy) || sitemapElement(local, uri, 'sitemap', this.#policy)) && recordUrl) {
			const record = this.#current!;
			if (record.kind === 'sitemap') {
				emit({
					kind: 'sitemap', loc: recordUrl, format: 'xml',
					...(record.lastModified ? { lastModified: record.lastModified } : {}),
					alternates: record.alternates,
				});
			} else {
				emit({
					kind: 'url', loc: recordUrl, format: this.#format ?? 'xml',
					...(record.lastModified ? { lastModified: record.lastModified } : {}),
					...(record.changeFrequency ? { changeFrequency: record.changeFrequency } : {}),
					...(record.priority !== undefined ? { priority: record.priority } : {}),
					alternates: record.alternates,
				});
			}
			this.#current = undefined;
		}
		this.#defaultNamespaces.pop();
	}
}

/** Incremental byte source that enforces the uncompressed sitemap byte limit. */
class SitemapByteSource {
	readonly #reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>;
	readonly #maxBytes: number | undefined;
	readonly #signal: AbortSignal | undefined;
	readonly #prefixChunks: Uint8Array<ArrayBufferLike>[] = [];
	#prepared = false;
	#done = false;
	byteLength = 0;
	capped = false;

	constructor(
		stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
		maxBytes?: number,
		signal?: AbortSignal,
	) {
		this.#reader = stream.getReader();
		this.#maxBytes = maxBytes;
		this.#signal = signal;
	}

	async prepare(): Promise<void> {
		if (this.#prepared) return;
		this.#prepared = true;
		let prefixBytes = 0;
		while (!this.#done && prefixBytes < XML_PREFIX_BYTES) {
			const chunk = await this.#readAccepted();
			if (!chunk) break;
			this.#prefixChunks.push(chunk);
			prefixBytes += chunk.byteLength;
			const text = this.prefixText();
			const trimmed = text.trimStart();
			if (!trimmed) continue;
			if (!trimmed.startsWith('<?xml')) break;
			if (trimmed.includes('?>')) break;
		}
	}

	prefixText(): string {
		const decoder = new TextDecoder();
		let output = '';
		for (const chunk of this.#prefixChunks) output += decoder.decode(chunk, { stream: true });
		return output + decoder.decode();
	}

	async *iterate(): AsyncGenerator<Uint8Array<ArrayBufferLike>> {
		for (const chunk of this.#prefixChunks) yield* splitChunk(chunk, XML_PARSER_CHUNK_BYTES);
		this.#prefixChunks.length = 0;
		while (!this.#done) {
			const chunk = await this.#readAccepted();
			if (!chunk) break;
			yield* splitChunk(chunk, XML_PARSER_CHUNK_BYTES);
		}
		if (this.capped) throw new SitemapByteLimitReached();
	}

	async close(): Promise<void> {
		await this.#reader.cancel().catch(() => undefined);
		this.#reader.releaseLock();
	}

	async #readAccepted(): Promise<Uint8Array<ArrayBufferLike> | undefined> {
		this.#signal?.throwIfAborted();
		const next = await this.#reader.read();
		if (next.done) {
			this.#done = true;
			return undefined;
		}
		const remaining = this.#maxBytes === undefined ? next.value.byteLength : this.#maxBytes - this.byteLength;
		if (remaining <= 0) {
			this.capped = true;
			this.#done = true;
			await this.#reader.cancel().catch(() => undefined);
			return undefined;
		}
		if (next.value.byteLength > remaining) {
			this.capped = true;
			this.#done = true;
			this.byteLength += remaining;
			await this.#reader.cancel().catch(() => undefined);
			return next.value.slice(0, remaining);
		}
		this.byteLength += next.value.byteLength;
		return next.value;
	}
}

class SitemapByteLimitReached extends Error {
	constructor() {
		super('Sitemap byte limit reached.');
		this.name = 'SitemapByteLimitReached';
	}
}

function walkXmlElement(
	element: XmlElement,
	collector: SitemapXmlCollector,
	inheritedDefaultNamespace?: string,
): void {
	const attributes = element.attributes;
	const defaultNamespace = attributes.xmlns ?? inheritedDefaultNamespace;
	const uri = element.name.uri ?? (element.name.prefix === undefined ? defaultNamespace : undefined);
	collector.start({ rawName: element.name.raw, ...(uri ? { uri } : {}), attributes });
	for (const child of element.children) walkXmlNode(child, collector, defaultNamespace);
	collector.end(element.name.raw, uri);
}

function walkXmlNode(node: XmlNode, collector: SitemapXmlCollector, defaultNamespace?: string): void {
	if (node.type === 'element') {
		walkXmlElement(node, collector, defaultNamespace);
	} else if (node.type === 'text' || node.type === 'cdata') {
		collector.text(node.text);
	}
}

function attributesToRecord(attributes: XmlAttributeIterator): Readonly<Record<string, string>> {
	const values: Record<string, string> = {};
	for (let index = 0; index < attributes.count; index += 1) {
		values[attributes.getName(index)] = attributes.getValue(index);
	}
	return values;
}

function resolvedElementNamespace(
	rawName: string,
	callbackUri: string | undefined,
	defaultNamespace: string | undefined,
): string | undefined {
	return rawName.includes(':') ? callbackUri : defaultNamespace;
}

function sitemapElement(
	local: string,
	uri: string | undefined,
	expectedLocal: string,
	policy: SitemapParsePolicy,
): boolean {
	if (local !== expectedLocal) return false;
	if (uri === SITEMAP_NAMESPACE) return true;
	return policy === 'lenient' && (uri === undefined || uri === '');
}

function localName(rawName: string): string {
	const separator = rawName.indexOf(':');
	return (separator < 0 ? rawName : rawName.slice(separator + 1)).toLowerCase();
}

function getAttribute(attributes: Readonly<Record<string, string>>, local: string): string | undefined {
	for (const [name, value] of Object.entries(attributes)) {
		if (localName(name) === local) return value;
	}
	return undefined;
}

async function parseTextStream(
	source: AsyncIterable<Uint8Array<ArrayBufferLike>>,
	policy: SitemapParsePolicy,
	problems: SitemapProblem[],
	onRecord: (record: SitemapRecord) => void | Promise<void>,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = '';
	for await (const chunk of source) {
		buffer += decoder.decode(chunk, { stream: true });
		const lines = buffer.split(/\r?\n/u);
		buffer = lines.pop() ?? '';
		for (const line of lines) await consumeTextLine(line, policy, problems, onRecord);
	}
	buffer += decoder.decode();
	await consumeTextLine(buffer, policy, problems, onRecord);
}

async function consumeTextLine(
	line: string,
	policy: SitemapParsePolicy,
	problems: SitemapProblem[],
	onRecord: (record: SitemapRecord) => void | Promise<void>,
): Promise<void> {
	const value = line.replace(/^\uFEFF/u, '').trim();
	if (!value) return;
	if (value.startsWith('#')) {
		if (policy === 'lenient') {
			problems.push({ code: 'nonstandard_text_comment', message: 'Accepted a non-standard comment in a text sitemap.' });
		}
		return;
	}
	if (isHttpUrl(value)) await onRecord({ kind: 'url', loc: value, format: 'text', alternates: [] });
}

function parseText(
	text: string,
	policy: SitemapParsePolicy,
): { readonly records: readonly SitemapRecord[]; readonly problems: readonly SitemapProblem[] } {
	const records: SitemapRecord[] = [];
	const problems: SitemapProblem[] = [];
	for (const line of text.split(/\r?\n/u)) {
		const value = line.replace(/^\uFEFF/u, '').trim();
		if (!value) continue;
		if (value.startsWith('#')) {
			if (policy === 'lenient') {
				problems.push({ code: 'nonstandard_text_comment', message: 'Accepted a non-standard comment in a text sitemap.' });
			}
			continue;
		}
		if (isHttpUrl(value)) records.push({ kind: 'url', loc: value, format: 'text', alternates: [] });
	}
	return { records: deduplicateRecords(records), problems };
}

function deduplicateRecords(records: readonly SitemapRecord[]): readonly SitemapRecord[] {
	const output: SitemapRecord[] = [];
	const indices = new Map<string, number>();
	for (const record of records) pushRecord(output, indices, record);
	return output;
}

function pushRecord(records: SitemapRecord[], indices: Map<string, number>, record: SitemapRecord): void {
	const key = `${record.kind}\0${record.loc}`;
	const existingIndex = indices.get(key);
	if (existingIndex === undefined) {
		indices.set(key, records.length);
		records.push(record);
		return;
	}
	const existing = records[existingIndex];
	if (!existing || existing.kind !== record.kind) return;
	const alternates = [...existing.alternates];
	for (const alternate of record.alternates) {
		if (!alternates.some((value) => value.href === alternate.href && value.hreflang === alternate.hreflang)) {
			alternates.push(alternate);
		}
	}
	records[existingIndex] = {
		...existing,
		...(!existing.lastModified && record.lastModified ? { lastModified: record.lastModified } : {}),
		alternates,
	} as SitemapRecord;
}

function xmlProblem(error: XmlSyntaxError): SitemapProblem {
	const message = error.message;
	const doctype = message.toLowerCase().includes('doctype');
	return {
		code: doctype ? 'doctype_not_allowed' : 'malformed_xml',
		message: doctype ? 'DOCTYPE is not allowed in sitemap XML.' : message,
	};
}

function detectXmlVersion(text: string): '1.0' | '1.1' {
	const declaration = /^\s*<\?xml\s+[^?]*\bversion\s*=\s*(['"])(1\.[01])\1/iu.exec(text);
	return declaration?.[2] === '1.1' ? '1.1' : '1.0';
}

function* splitChunk(
	chunk: Uint8Array<ArrayBufferLike>,
	maximumBytes: number,
): Generator<Uint8Array<ArrayBufferLike>> {
	for (let offset = 0; offset < chunk.byteLength; offset += maximumBytes) {
		yield chunk.slice(offset, offset + maximumBytes);
	}
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function isTextSource(url: string, contentType: string): boolean {
	return contentType.includes('text/plain') || /\.txt(?:\.gz)?(?:$|[?#])/iu.test(url);
}

function isXmlSource(url: string, contentType: string): boolean {
	if (contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom')) return true;
	return /\.(?:xml|rss|atom)(?:\.gz)?(?:$|[?#])/iu.test(url);
}

function looksLikeXml(text: string, url: string, contentType: string): boolean {
	return isXmlSource(url, contentType) || /^\s*</u.test(text);
}
