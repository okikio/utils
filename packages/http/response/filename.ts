/**
 * Describe a download filename for Content-Disposition without trusting a source path.
 *
 * Only the last path component survives. Control characters are removed and
 * empty or dot-only names become `download`. Quoting protects ASCII names;
 * non-ASCII names add a UTF-8 extended value beside a safe ASCII fallback.
 * This formats an HTTP field, not a filesystem path or a file authorization rule.
 *
 * @example
 * ```ts
 * const headers = new Headers({
 *   'content-disposition': attachmentDisposition('reports/quarterly.csv'),
 * });
 * // attachment; filename="quarterly.csv"
 * ```
 */
export function attachmentDisposition(value: string): string {
	const name = value.toWellFormed().replaceAll(/\p{Cc}/gu, '').split(/[\\/]/u).at(-1) || 'download';
	const filename = /^\.+$/u.test(name) ? 'download' : name;
	const fallback = filename.replaceAll(/[^\x20-\x7e]/gu, '_').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
	const quoted = `attachment; filename="${fallback}"`;
	if (filename === filename.replaceAll(/[^\x20-\x7e]/gu, '_')) return quoted;
	const encoded = encodeURIComponent(filename).replaceAll(
		/['()*]/gu,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `${quoted}; filename*=UTF-8''${encoded}`;
}
