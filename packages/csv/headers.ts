/** Normalize one source header into a stable matching/key form. */
export function normalizeHeader(header: string): string {
	if (typeof header !== 'string') throw new TypeError('header must be a string.')
	return header
		.replace(/^\ufeff/, '')
		.normalize('NFKC')
		.trim()
		.replace(/([a-z\d])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.replace(/[\u2010-\u2015]/g, '-')
		.replace(/[*:]/g, ' ')
		.replace(/[_./\\()[\]-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}
