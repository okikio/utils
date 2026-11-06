import { CsvParseError } from './types.ts';

/** Reject common non-text formats before CSV decoding; filename and MIME are not byte evidence. */
export function assertTextSource(bytes: Uint8Array): void {
	if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
		throw new CsvParseError('invalid-csv', 'UTF-16 CSV is unsupported. Save this file as UTF-8 CSV.');
	}
	const starts = (...signature: number[]): boolean => signature.every((value, index) => bytes[index] === value);
	const label = (offset: number, value: string): boolean =>
		[...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
	if (
		starts(0x89, 0x50, 0x4e, 0x47) || starts(0xff, 0xd8, 0xff) || (label(0, 'GIF87a') || label(0, 'GIF89a')) ||
		(label(0, 'RIFF') && (label(8, 'WEBP') || label(8, 'AVI '))) ||
		(bytes[0] === 0 && bytes[1] === 0 && ((bytes[2] ?? 0) * 256 + (bytes[3] ?? 0)) >= 8 && label(4, 'ftyp')) ||
		starts(0x1a, 0x45, 0xdf, 0xa3) || starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06) ||
		starts(0x1f, 0x8b) || label(0, '%PDF-') || starts(0xd0, 0xcf, 0x11, 0xe0)
	) {
		throw new CsvParseError('invalid-csv', 'The source is a media, archive, or document file, not CSV text.');
	}
}

/** CSV allows tabs and line endings, but not binary control characters, anywhere in the decoded source. */
export function assertTextCharacters(text: string): void {
	// These control ranges are the explicit text-only policy, rather than accidental characters.
	if (/(?![\t\r\n])\p{Cc}/u.test(text)) {
		throw new CsvParseError('invalid-csv', 'The CSV source contains binary control characters.');
	}
}
