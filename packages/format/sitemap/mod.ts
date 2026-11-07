import * as readers from '@okikio/streams/reader';
import type { CleanupOutcome, Reader } from '@okikio/streams/reader';
/**
 * Read sitemap, feed, and plain-text sources through one record model. Preserve
 * whether a location names a page or another sitemap, along with alternate links
 * and malformed-document evidence.
 *
 * Use locations() for URL strings, inspect() for records and bounded diagnostics,
 * and parseStream() for incremental ingestion. Choose a standards or lenient
 * policy for imperfect sources. The application fetches nested indexes and sets
 * network, input-byte, and source-count budgets; parsing does not choose crawl priority.
 *
 * @example
 * ```ts
 * import * as sitemap from '@okikio/format/sitemap';
 * const text = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/guide</loc></url></urlset>';
 * console.log(JSON.stringify(sitemap.locations({ url: 'https://example.com/sitemap.xml', contentType: 'application/xml', text })));
 * ```
 *
 * @module
 */
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
	/** URL associated with this parsed resource reference. */
	readonly href: string;
	/** Language tag declared for this alternate source location. */
	readonly hreflang: string;
}

/** Source format that produced a normalized sitemap record. */
export type SitemapFormat = 'xml' | 'rss' | 'atom' | 'text';

/** One page/resource URL declared by a sitemap source. */
export interface SitemapUrlRecord {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'url';
	/** Location declared by the source document. */
	readonly loc: string;
	/** Selected external representation format. */
	readonly format: SitemapFormat;
	/** Optional source modification instant reported by the external document. */
	readonly lastModified?: string;
	/** Optional change-frequency hint declared by the sitemap source. */
	readonly changeFrequency?: string;
	/** Optional sitemap priority hint; it does not establish crawl order or source authority. */
	readonly priority?: number;
	/** Alternate language locations declared by the source. */
	readonly alternates: readonly SitemapAlternate[];
}

/** One child source declared by an XML sitemap index. */
export interface SitemapSourceRecord {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'sitemap';
	/** Location declared by the source document. */
	readonly loc: string;
	/** Selected external representation format. */
	readonly format: 'xml';
	/** Optional source modification instant reported by the external document. */
	readonly lastModified?: string;
	/** Alternate language locations declared by the source. */
	readonly alternates: readonly SitemapAlternate[];
}

/** Format-neutral record produced by one sitemap resource. */
export type SitemapRecord = SitemapUrlRecord | SitemapSourceRecord;

/** Non-fatal or fatal parser evidence retained for the caller. */
export interface SitemapProblem {
	/** Stable machine-readable reason that callers can inspect without matching message text. */
	readonly code:
		| 'doctype_not_allowed'
		| 'malformed_xml'
		| 'nonstandard_text_comment'
		| 'unexpected_sitemap_namespace'
		| 'input_limit'
		| 'record_limit'
		| 'url_limit'
		| 'unsupported_format';
	/** Human-readable explanation; use the stable code or discriminant for program decisions. */
	readonly message: string;
}

/** Result metadata from an incrementally parsed sitemap source. */
export interface SitemapStreamResult {
	/** Number of encoded bytes represented by this value. */
	readonly byteLength: number;
	/** Whether the reported result was limited by a configured bound. */
	readonly capped: boolean;
	/** Selected external representation format. */
	readonly format?: SitemapFormat;
	/** Parser and format observations associated with the inspected sitemap. */
	readonly problems: readonly SitemapProblem[];
}

const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const XML_PREFIX_BYTES = 4 * 1024;
const XML_PARSER_CHUNK_BYTES = 64 * 1024;
const XML_MAX_DEPTH = 256;
const XML_MAX_ATTRIBUTES = 4_096;

/** Complete supplied source. The application owns fetching, decompression and the input string. */
export interface SitemapInputType {
	readonly text: string;
	readonly url: string;
	readonly contentType?: string;
	readonly policy?: SitemapParsePolicy;
}

/** Required finite inspection policy; string limits count UTF-16 code units, not encoded bytes. */
export interface SitemapLimitsType {
	/** Reject before XML materialization when the supplied string exceeds this length. */
	readonly maximumCodeUnits: number;
	/** Maximum distinct retained records; repeated kind/location pairs merge within this bound. */
	readonly maximumRecords: number;
	/** Maximum location or alternate URL length. Oversized records are omitted and capped is true. */
	readonly maximumUrlLength: number;
	/** Maximum diagnostic records retained. Zero suppresses messages, not the capped flag. */
	readonly maximumProblems: number;
}

/** Complete-input result distinguishes valid empty input, syntax failure and deliberate truncation. */
export interface SitemapInspectionType {
	readonly records: readonly SitemapRecord[];
	readonly format?: SitemapFormat;
	/** A policy bound discarded input, records or diagnostic evidence. */
	readonly capped: boolean;
	readonly problems: readonly SitemapProblem[];
}

/**
 * Inspect supplied sitemap text with bounded retained records and diagnostic evidence.
 * XML syntax is owned by STD; only its syntax errors become problems. Unexpected defects still throw.
 * The input-length guard runs before the XML parser, whose tree is materialized for complete inspection.
 * Use parseStream for incremental ingestion. No fetching or nested source traversal occurs here.
 */
export function inspect(input: SitemapInputType, limits: SitemapLimitsType): SitemapInspectionType {
	for (const [key, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new TypeError(`Sitemap ${key} must be a non-negative safe integer.`);
		}
	}
	for (const key of ['maximumCodeUnits', 'maximumRecords', 'maximumUrlLength', 'maximumProblems'] as const) {
		if (!Number.isSafeInteger(limits[key])) throw new TypeError(`Sitemap ${key} is required.`);
	}
	const problems: SitemapProblem[] = [];
	const records: SitemapRecord[] = [];
	const indices = new Map<string, number>();
	let capped = false;
	let format: SitemapFormat | undefined;
	/** All evidence shares one budget, including repetitive text comments. */
	const problem = (value: SitemapProblem): void => {
		if (problems.length < limits.maximumProblems) problems.push(value);
		else capped = true;
	};
	/** Deduplicate only retained records; admission stops before another identity enters the index. */
	const accept = (record: SitemapRecord): void => {
		if (
			record.loc.length > limits.maximumUrlLength ||
			record.alternates.some((entry) => entry.href.length > limits.maximumUrlLength)
		) {
			capped = true;
			problem({ code: 'url_limit', message: 'Sitemap location exceeds maximumUrlLength.' });
			return;
		}
		const key = `${record.kind}\0${record.loc}`;
		if (!indices.has(key) && records.length >= limits.maximumRecords) {
			capped = true;
			problem({ code: 'record_limit', message: 'Sitemap records exceed maximumRecords.' });
			return;
		}
		pushRecord(records, indices, record);
	};
	if (input.text.length > limits.maximumCodeUnits) {
		capped = true;
		problem({ code: 'input_limit', message: 'Sitemap input exceeds maximumCodeUnits.' });
	} else {
		const contentType = input.contentType?.toLowerCase() ?? '';
		if (isTextSource(input.url, contentType)) {
			format = 'text';
			for (const line of input.text.split(/\r?\n/u)) {
				const value = line.replace(/^\uFEFF/u, '').trim();
				if (value.startsWith('#')) {
					if ((input.policy ?? 'lenient') === 'lenient') {
						problem({
							code: 'nonstandard_text_comment',
							message: 'Accepted a non-standard comment in a text sitemap.',
						});
					}
				} else if (isHttpUrl(value)) accept({ kind: 'url', loc: value, format: 'text', alternates: [] });
			}
		} else if (looksLikeXml(input.text, input.url, contentType)) {
			format = 'xml';
			try {
				const document = parseXmlDocument(input.text, {
					xmlVersion: detectXmlVersion(input.text),
					disallowDoctype: true,
					maxDepth: XML_MAX_DEPTH,
					maxAttributes: XML_MAX_ATTRIBUTES,
					trackPosition: false,
				});
				const collector = new SitemapXmlCollector(input.policy ?? 'lenient', accept);
				walkXmlElement(document.root, collector);
				format = collector.format() ?? format;
				const namespace = collector.namespaceProblem();
				if (namespace) problem(namespace);
			} catch (error) {
				if (!(error instanceof XmlSyntaxError)) throw error;
				problem(xmlProblem(error));
			}
		} else problem({ code: 'unsupported_format', message: 'Input is not a supported sitemap representation.' });
	}
	return Object.freeze({
		records: Object.freeze(records),
		...(format === undefined ? {} : { format }),
		capped,
		problems: Object.freeze(problems),
	});
}

/**
 * Parse complete text with the historical permissive array result. Malformed XML still returns [].
 * Use inspect with explicit limits when empty results must be distinguished from rejected evidence.
 */
export function parse(input: SitemapInputType): readonly SitemapRecord[] {
	return inspect(input, {
		maximumCodeUnits: input.text.length,
		maximumRecords: input.text.length,
		maximumUrlLength: input.text.length,
		maximumProblems: 0,
	}).records;
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
 * `@std/xml` owns XML tokenization and well-formedness. This module owns sitemap
 * semantics and explicitly resolves default XML namespaces because @std/xml
 * intentionally reports `uri = undefined` for unprefixed element callbacks.
 */
export async function parseStream(input: {
	readonly stream: ReadableStream<Uint8Array<ArrayBufferLike>>;
	readonly url: string;
	readonly contentType?: string;
	readonly policy?: SitemapParsePolicy;
	/** Maximum retained diagnostics; defaults to 128. Excess evidence sets capped and ingestion continues. */
	readonly maximumProblems?: number;
	/** Maximum consumed UTF-8 input bytes. Omitted keeps the legacy unbounded-input policy. */
	readonly maxBytes?: number;
	readonly signal?: AbortSignal;
	/** Retain cleanup when an early parse failure prevents a result from being returned. */
	readonly onCleanup?: (completion: Promise<CleanupOutcome>) => void;
	readonly onRecord: (record: SitemapRecord) => void | Promise<void>;
}): Promise<SitemapStreamResult> {
	const maximumProblems = input.maximumProblems ?? 128;
	if (!Number.isSafeInteger(maximumProblems) || maximumProblems < 0) {
		throw new RangeError('Sitemap maximumProblems must be a non-negative safe integer.');
	}
	const source = new SitemapByteSource(input.stream, input.maxBytes, input.signal, input.onCleanup);
	const problems: SitemapProblem[] = [];
	let evidenceCapped = false;
	/** One budget covers text comments and XML syntax/namespace evidence without retaining dropped messages. */
	const report = (problem: SitemapProblem): void => {
		if (problems.length < maximumProblems) problems.push(problem);
		else evidenceCapped = true;
	};
	let format: SitemapFormat | undefined;
	/** Check cancellation between records already buffered by either format parser. */
	const accept = async (record: SitemapRecord): Promise<void> => {
		input.signal?.throwIfAborted();
		await input.onRecord(record);
		input.signal?.throwIfAborted();
	};
	try {
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
		if (mode === 'text') format = 'text';
		if (mode === 'text') {
			await parseTextStream(source.iterate(), input.policy ?? 'lenient', report, accept);
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
			for await (const record of records) await accept(record);
			format = collector.format();
			const namespaceProblem = collector.namespaceProblem();
			if (namespaceProblem) report(namespaceProblem);
		}
	} catch (error) {
		if (error instanceof SitemapByteLimitReached) {
			// Deliberate Crawl policy truncation is reported through `capped`.
		} else if (input.signal?.aborted) {
			throw input.signal.reason ?? error;
		} else if (error instanceof XmlSyntaxError) {
			report(xmlProblem(error));
		} else {
			throw error;
		}
	} finally {
		source.close();
	}

	return {
		byteLength: source.byteLength,
		capped: source.capped || evidenceCapped,
		...(format ? { format } : {}),
		problems,
	};
}

/** A selected element can receive several text and CDATA events before it closes. */
interface CapturedXmlText {
	readonly tagName: 'loc' | 'link' | 'lastmod' | 'changefreq' | 'priority';
	text: string;
}

/** Accumulate fields for the active XML record before emitting its public projection. */
interface MutableXmlRecord {
	readonly kind: 'url' | 'sitemap';
	url?: string;
	lastModified?: string;
	changeFrequency?: string;
	priority?: number;
	alternates: SitemapAlternate[];
}

/** Normalize start events from tree traversal and incremental XML callbacks for the same reducer. */
interface XmlStart {
	readonly rawName: string;
	readonly uri?: string;
	readonly attributes: Readonly<Record<string, string>>;
}

/** Sitemap semantic reducer shared by complete-tree and streaming @std/xml APIs. */
class SitemapXmlCollector {
	/** One default namespace per open element; popping restores the parent's namespace after a local override. */
	readonly #defaultNamespaces: (string | undefined)[] = [];
	readonly #policy: SitemapParsePolicy;
	readonly #fallbackEmit: (record: SitemapRecord) => void;
	/** Only a selected text field is retained; unrelated parser text is ignored. */
	#capture: CapturedXmlText | undefined;
	/** Fields wait for record completion so optional metadata can follow its location. */
	#current: MutableXmlRecord | undefined;
	#format: SitemapFormat | undefined;
	/** Keep a semantic root-namespace rejection separate from XML syntax diagnostics. */
	#namespaceProblem: SitemapProblem | undefined;

	/** Share semantic state across complete-tree and streaming XML adapters without owning their source. */
	constructor(policy: SitemapParsePolicy, emit: (record: SitemapRecord) => void) {
		this.#policy = policy;
		this.#fallbackEmit = emit;
	}

	/** Return format evidence observed so far; an unfinished or unsupported source can remain unknown. */
	format(): SitemapFormat | undefined {
		return this.#format;
	}

	/** Return the root namespace mismatch separately from syntax errors owned by the XML parser. */
	namespaceProblem(): SitemapProblem | undefined {
		return this.#namespaceProblem;
	}

	/** Translate STD callbacks into the same reducer events as tree traversal, including CDATA text. */
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

	/** Push inherited default namespace and admit format-specific record/text capture at element entry. */
	start(input: XmlStart, emit = this.#fallbackEmit): void {
		const inheritedDefault = this.#defaultNamespaces.at(-1);
		const defaultNamespace = input.attributes.xmlns ?? inheritedDefault;
		this.#defaultNamespaces.push(defaultNamespace);
		const local = localName(input.rawName);
		const uri = resolvedElementNamespace(input.rawName, input.uri, defaultNamespace);
		if (!this.#format) {
			if (local === 'rss') this.#format = 'rss';
			else if (local === 'feed') this.#format = 'atom';
			else if (
				sitemapElement(local, uri, 'urlset', this.#policy) || sitemapElement(local, uri, 'sitemapindex', this.#policy)
			) {
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
		if (
			this.#current && ['lastmod', 'changefreq', 'priority'].includes(local) &&
			sitemapElement(local, uri, local, this.#policy)
		) {
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

	/** Append only selected field text; unrelated document text does not become a record location. */
	text(value: string): void {
		if (this.#capture) this.#capture.text += value;
	}

	/** Finalize the selected field or record before popping its element namespace. */
	end(rawName: string, callbackUri?: string, emit = this.#fallbackEmit): void {
		const defaultNamespace = this.#defaultNamespaces.at(-1);
		const local = localName(rawName);
		const uri = resolvedElementNamespace(rawName, callbackUri, defaultNamespace);
		if (
			this.#capture && local === this.#capture.tagName && (
				this.#capture.tagName === 'link' || sitemapElement(local, uri, this.#capture.tagName, this.#policy)
			)
		) {
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
		if (
			(sitemapElement(local, uri, 'url', this.#policy) || sitemapElement(local, uri, 'sitemap', this.#policy)) &&
			recordUrl
		) {
			const record = this.#current!;
			if (record.kind === 'sitemap') {
				emit({
					kind: 'sitemap',
					loc: recordUrl,
					format: 'xml',
					...(record.lastModified ? { lastModified: record.lastModified } : {}),
					alternates: record.alternates,
				});
			} else {
				emit({
					kind: 'url',
					loc: recordUrl,
					format: this.#format ?? 'xml',
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
	readonly #reader: Reader<Uint8Array<ArrayBufferLike>>;
	/** Completion of the original source cleanup, separate from local reader release. */
	readonly cleanup: Promise<CleanupOutcome>;
	readonly #maxBytes: number | undefined;
	readonly #signal: AbortSignal | undefined;
	/** Accepted chunks retained for format detection; iteration replays them without reading them again. */
	readonly #prefixChunks: Uint8Array<ArrayBufferLike>[] = [];
	/** Prefix discovery runs at most once, even if the caller inspects its text again. */
	#prepared = false;
	/** No more reads after EOF or a byte-limit stop. */
	#done = false;
	/** Count accepted uncompressed bytes once, including the replayed prefix. */
	byteLength = 0;
	/** True when the allowance stops input; a zero allowance stops before checking for EOF. */
	capped = false;

	constructor(
		stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
		maxBytes?: number,
		signal?: AbortSignal,
		onCleanup?: (completion: Promise<CleanupOutcome>) => void,
	) {
		if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
			throw new RangeError('Sitemap maxBytes must be a non-negative safe integer.');
		}
		this.#reader = readers.open(stream, { signal, onCleanup });
		this.cleanup = this.#reader.cleanup;
		this.#maxBytes = maxBytes;
		this.#signal = signal;
	}

	/** Retain initial chunks until format/XML-version evidence is available; replay them once in iterate. */
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

	/** Decode discovery evidence only; the XML parser later receives the original bytes and owns validity. */
	prefixText(): string {
		const decoder = new TextDecoder();
		let output = '';
		for (const chunk of this.#prefixChunks) output += decoder.decode(chunk, { stream: true });
		return output + decoder.decode();
	}

	/** Replay discovery before new reads and surface deliberate byte truncation after accepted bytes. */
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

	/** Request local reader release; eventual source cancellation remains available through cleanup. */
	close(): void {
		void this.#reader.close('Sitemap parsing ended.');
	}

	/** Charge accepted bytes once, retaining only a crossing prefix and cancelling further acquisition. */
	async #readAccepted(): Promise<Uint8Array<ArrayBufferLike> | undefined> {
		this.#signal?.throwIfAborted();
		if (this.#maxBytes === 0) {
			this.capped = true;
			this.#done = true;
			this.close();
			return undefined;
		}
		const next = await this.#reader.read();
		if (next.done) {
			this.#done = true;
			return undefined;
		}
		const remaining = this.#maxBytes === undefined ? next.value.byteLength : this.#maxBytes - this.byteLength;
		if (remaining <= 0) {
			this.capped = true;
			this.#done = true;
			void this.#reader.close('Sitemap byte limit reached.');
			return undefined;
		}
		if (next.value.byteLength > remaining) {
			this.capped = true;
			this.#done = true;
			this.byteLength += remaining;
			void this.#reader.close('Sitemap byte limit reached.');
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

/** Replay a complete tree through the streaming reducer with inherited default namespace evidence. */
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

/** Forward only elements and character data; comments cannot supply sitemap field values. */
function walkXmlNode(node: XmlNode, collector: SitemapXmlCollector, defaultNamespace?: string): void {
	if (node.type === 'element') {
		walkXmlElement(node, collector, defaultNamespace);
	} else if (node.type === 'text' || node.type === 'cdata') {
		collector.text(node.text);
	}
}

/** Copy ephemeral parser attributes while their callback scope is valid. */
function attributesToRecord(attributes: XmlAttributeIterator): Readonly<Record<string, string>> {
	const values: Record<string, string> = {};
	for (let index = 0; index < attributes.count; index += 1) {
		values[attributes.getName(index)] = attributes.getValue(index);
	}
	return values;
}

/** STD omits a URI for unprefixed elements; use the tracked default only for those names. */
function resolvedElementNamespace(
	rawName: string,
	callbackUri: string | undefined,
	defaultNamespace: string | undefined,
): string | undefined {
	return rawName.includes(':') ? callbackUri : defaultNamespace;
}

/** Standards requires the sitemap namespace; lenient additionally admits an absent namespace. */
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

/** Compare semantic tag names independently of the source's namespace prefix spelling. */
function localName(rawName: string): string {
	const separator = rawName.indexOf(':');
	return (separator < 0 ? rawName : rawName.slice(separator + 1)).toLowerCase();
}

/** Find a semantic attribute by local name without assuming one authored namespace prefix. */
function getAttribute(attributes: Readonly<Record<string, string>>, local: string): string | undefined {
	for (const [name, value] of Object.entries(attributes)) {
		if (localName(name) === local) return value;
	}
	return undefined;
}

/** Retain one unfinished line across decoded chunks and await each admitted record callback. */
async function parseTextStream(
	source: AsyncIterable<Uint8Array<ArrayBufferLike>>,
	policy: SitemapParsePolicy,
	report: (problem: SitemapProblem) => void,
	onRecord: (record: SitemapRecord) => void | Promise<void>,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = '';
	for await (const chunk of source) {
		buffer += decoder.decode(chunk, { stream: true });
		const lines = buffer.split(/\r?\n/u);
		buffer = lines.pop() ?? '';
		for (const line of lines) await consumeTextLine(line, policy, report, onRecord);
	}
	buffer += decoder.decode();
	await consumeTextLine(buffer, policy, report, onRecord);
}

/** Admit absolute HTTP(S) locations and record tolerated comments without treating them as URLs. */
async function consumeTextLine(
	line: string,
	policy: SitemapParsePolicy,
	report: (problem: SitemapProblem) => void,
	onRecord: (record: SitemapRecord) => void | Promise<void>,
): Promise<void> {
	const value = line.replace(/^\uFEFF/u, '').trim();
	if (!value) return;
	if (value.startsWith('#')) {
		if (policy === 'lenient') {
			report({
				code: 'nonstandard_text_comment',
				message: 'Accepted a non-standard comment in a text sitemap.',
			});
		}
		return;
	}
	if (isHttpUrl(value)) await onRecord({ kind: 'url', loc: value, format: 'text', alternates: [] });
}

/** Merge already-admitted identities; the complete-input code-unit guard bounds source alternate data. */
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

/** Classify known XML syntax failure while leaving unexpected implementation errors to propagate. */
function xmlProblem(error: XmlSyntaxError): SitemapProblem {
	const message = error.message;
	const doctype = message.toLowerCase().includes('doctype');
	return {
		code: doctype ? 'doctype_not_allowed' : 'malformed_xml',
		message: doctype ? 'DOCTYPE is not allowed in sitemap XML.' : message,
	};
}

/** Read the declared XML revision from discovery evidence; absent declarations use XML 1.0. */
function detectXmlVersion(text: string): '1.0' | '1.1' {
	const declaration = /^\s*<\?xml\s+[^?]*\bversion\s*=\s*(['"])(1\.[01])\1/iu.exec(text);
	return declaration?.[2] === '1.1' ? '1.1' : '1.0';
}

/** Give the XML parser owned bounded slices; this limits parser-call size, not the upstream chunk allocation. */
function* splitChunk(
	chunk: Uint8Array<ArrayBufferLike>,
	maximumBytes: number,
): Generator<Uint8Array<ArrayBufferLike>> {
	for (let offset = 0; offset < chunk.byteLength; offset += maximumBytes) {
		yield chunk.slice(offset, offset + maximumBytes);
	}
}

/** Validate supported absolute URL protocols; this is not network authorization or host allowlisting. */
function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/** Prefer an explicit plain-text media type or filename hint when selecting the parser. */
function isTextSource(url: string, contentType: string): boolean {
	return contentType.includes('text/plain') || /\.txt(?:\.gz)?(?:$|[?#])/iu.test(url);
}

/** Recognize XML/feed hints without claiming their bytes are well formed. */
function isXmlSource(url: string, contentType: string): boolean {
	if (contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom')) return true;
	return /\.(?:xml|rss|atom)(?:\.gz)?(?:$|[?#])/iu.test(url);
}

/** Use content sniffing only when metadata did not already identify an XML source. */
function looksLikeXml(text: string, url: string, contentType: string): boolean {
	return isXmlSource(url, contentType) || /^\s*</u.test(text);
}
