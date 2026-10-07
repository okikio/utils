import { parse as parseNpm } from '#csv-parse/sync';
import { run } from '../../bench/run.ts';
import { parse as parseRows } from '@std/csv/parse';
import { bench, do_not_optimize, group } from 'mitata';

import * as csv from './mod.ts';

const encoder = new TextEncoder();
const smallText = 'Company,Website\nNorthstar,https://northstar.example\n';
const smallBytes = encoder.encode(smallText);
const representativeText = [
	'Company,Domain,Website,Email,Employees',
	...Array.from(
		{ length: 10_000 },
		(_, index) =>
			`Company ${index},company-${index}.example,https://company-${index}.example,hello@company-${index}.example,${
				index % 500
			}`,
	),
].join('\n');
const representativeBytes = encoder.encode(representativeText);

/** Present benchmark bytes as deterministic chunks so streaming measurements include chunk-split handling. */
function chunks(bytes: Uint8Array, size = 64 * 1024): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.byteLength) {
				controller.close();
				return;
			}
			const end = Math.min(offset + size, bytes.byteLength);
			controller.enqueue(bytes.subarray(offset, end));
			offset = end;
		},
	});
}

/** Consume rows with bounded application retention; verify every source cell outside the timer. */
async function streamRows(verify = false): Promise<number> {
	await using document = await csv.parseStream(chunks(representativeBytes));
	let count = 0;
	for await (const row of document.rows) {
		if (verify) checkRow(row.values, count);
		count++;
	}
	return count;
}

/** An independent fixture formula detects loss, reordering and corrupt cells, not just a preserved row count. */
function checkRow(values: readonly string[], index: number): void {
	const expected = [
		`Company ${index}`,
		`company-${index}.example`,
		`https://company-${index}.example`,
		`hello@company-${index}.example`,
		String(index % 500),
	];
	if (values.length !== expected.length || !values.every((value, column) => value === expected[column])) {
		throw new Error(`CSV benchmark corrupted row ${index}.`);
	}
}

const small = csv.parseBytes(smallBytes);
const representative = csv.parseBytes(representativeBytes);
const baseline = parseRows(representativeText, { fieldsPerRecord: -1 });
const streamed = await streamRows(true);
const npmBaseline = parseNpm(representativeText) as string[][];
const expectedHeader = ['Company', 'Domain', 'Website', 'Email', 'Employees'];
for (const header of [baseline[0], npmBaseline[0]]) {
	if (header?.length !== expectedHeader.length || !header.every((cell, index) => cell === expectedHeader[index])) {
		throw new Error('CSV tokenizer baseline lost the header.');
	}
}
for (let index = 1; index < npmBaseline.length; index++) checkRow(npmBaseline[index]!, index - 1);
for (let index = 0; index < representative.rows.length; index++) checkRow(representative.rows[index]!.values, index);
for (let index = 1; index < baseline.length; index++) checkRow(baseline[index]!, index - 1);
if (small.rows[0]?.values.join('|') !== 'Northstar|https://northstar.example') {
	throw new Error('CSV startup fixture lost values.');
}
if (
	small.rows.length !== 1 || representative.rows.length !== 10_000 || baseline.length !== 10_001 ||
	npmBaseline.length !== 10_001 || streamed !== 10_000
) {
	throw new Error('CSV benchmark fixtures did not preserve their documented row counts.');
}

group('CSV collecting', () => {
	bench('csv.parseBytes: 2-row startup', () => {
		do_not_optimize(csv.parseBytes(smallBytes));
	});

	bench('csv.parseBytes: 10k rows × 5 columns', () => {
		do_not_optimize(csv.parseBytes(representativeBytes));
	});
});

group('CSV tokenizer cost reference: no header selection, diagnostics or document metadata', () => {
	bench('@std/csv raw records: 10001 rows including header', () => {
		do_not_optimize(parseRows(representativeText, { fieldsPerRecord: -1 }));
	});
});

group('CSV tokenizer cost reference: npm parser without document projection', () => {
	bench('csv-parse/sync raw records: 10001 rows including header', () => do_not_optimize(parseNpm(representativeText)));
});

group('CSV streaming', () => {
	bench('csv.parseStream: 10k rows × 5 columns, 64 KiB chunks', async () => {
		do_not_optimize(await streamRows());
	});
});

// Quoting, embedded newlines and Unicode stress decoder/tokenizer boundaries.
const quotedCells = Array.from({ length: 256 }, (_, index) => [`雪-${index}`, `a,"b"\n${index}`, 'x'.repeat(1024)]);
const quotedText = [
	'Name,Note,Payload',
	...quotedCells.map((cells) => cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')),
].join('\r\n');
const quotedBytes = encoder.encode(quotedText);
const quotedDocument = csv.parseBytes(quotedBytes);
if (
	quotedDocument.rows.length !== quotedCells.length ||
	!quotedDocument.rows.every((row, index) =>
		row.values.length === quotedCells[index]!.length &&
		row.values.every((cell, column) => cell === quotedCells[index]![column])
	)
) throw new Error('Quoted CSV corpus lost cells.');
/** Carry the same independently known cells through many decoder and quote boundaries. */
async function quotedStream(verify = false): Promise<number> {
	await using document = await csv.parseStream(chunks(quotedBytes, 31));
	let count = 0;
	for await (const row of document.rows) {
		if (
			verify &&
			(count >= quotedCells.length || row.values.length !== quotedCells[count]!.length ||
				!row.values.every((cell, column) => cell === quotedCells[count]![column]))
		) throw new Error('Chunked quoted CSV corpus lost cells.');
		count++;
	}
	return count;
}
if (await quotedStream(true) !== quotedCells.length) throw new Error('Chunked quoted CSV lost rows.');
group('CSV difficult decoder boundaries', () => {
	bench(
		'256 quoted Unicode/newline rows × 1 KiB payload, collecting',
		() => do_not_optimize(csv.parseBytes(quotedBytes)),
	);
	bench(
		'256 quoted Unicode/newline rows × 1 KiB payload, 31-byte chunks',
		async () => do_not_optimize(await quotedStream()),
	);
});
await run();
