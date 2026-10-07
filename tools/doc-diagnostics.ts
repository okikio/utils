/** Parse Deno's stable diagnostic codes and locations independently of terminal formatting or explanation text. */
import { stripVTControlCharacters } from 'node:util';

/** One source-bearing CLI diagnostic; missing fields must fail the caller's gate. */
export interface DiagnosticType {
	/** Stable code selected by Deno, not its user-facing explanation. */
	readonly code: string | undefined;
	/** Source file path from the location marker. */
	readonly path: string | undefined;
	/** One-based source line, or undefined for malformed output. */
	readonly line: number | undefined;
	/** One-based source column, or undefined for malformed output. */
	readonly column: number | undefined;
	/** Uncolored original block retained when the CLI emits an unexpected diagnostic. */
	readonly block: string;
}

/** Keep colored and plain output equivalent while leaving unknown or location-free diagnostics visible. */
export function diagnostics(stderr: string): readonly DiagnosticType[] {
	const plain = stripVTControlCharacters(stderr);
	return plain.split(/(?=^error\[)/mu).filter((value) => value.startsWith('error[')).map((block) => {
		const code = /^error\[([a-z-]+)\]:/u.exec(block)?.[1];
		const location = /^\s*-->\s+(.+):(\d+):(\d+)\s*$/mu.exec(block);
		return {
			code,
			path: location?.[1],
			line: location === null ? undefined : Number(location[2]),
			column: location === null ? undefined : Number(location[3]),
			block,
		};
	});
}
