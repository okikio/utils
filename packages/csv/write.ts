import { stringify } from 'csv-stringify/sync';

/** Encode one complete scalar with the maintained CSV writer, without buffering its surrounding record. */
export function cell(value: string): string {
	return stringify([[value]], { eof: false, record_delimiter: '\r\n', quoted_match: /[\r\n]/u });
}

/** Record framing stays separate so arbitrarily wide records need only one complete cell in memory. */
export const comma = ',';
/** CRLF record terminator for separately framed CSV output. */
export const recordEnd = '\r\n';
