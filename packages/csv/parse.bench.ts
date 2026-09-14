import { parse as parseRows } from '@std/csv/parse'
import { bench, do_not_optimize, group, run } from 'mitata'

import * as csv from './mod.ts'

const encoder = new TextEncoder()
const smallText = 'Company,Website\nNorthstar,https://northstar.example\n'
const smallBytes = encoder.encode(smallText)
const representativeText = [
	'Company,Domain,Website,Email,Employees',
	...Array.from({ length: 10_000 }, (_, index) =>
		`Company ${index},company-${index}.example,https://company-${index}.example,hello@company-${index}.example,${index % 500}`
	),
].join('\n')
const representativeBytes = encoder.encode(representativeText)

/** Present benchmark bytes as deterministic chunks so streaming measurements include chunk-split handling. */
function chunks(bytes: Uint8Array, size = 64 * 1024): ReadableStream<Uint8Array> {
	let offset = 0
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.byteLength) {
				controller.close()
				return
			}
			const end = Math.min(offset + size, bytes.byteLength)
			controller.enqueue(bytes.subarray(offset, end))
			offset = end
		},
	})
}

/** Consume the one-shot stream fixture outside the timer and retain only its semantic row count. */
async function streamRows(): Promise<number> {
	await using document = await csv.parseStream(chunks(representativeBytes))
	return (await Array.fromAsync(document.rows)).length
}

const small = csv.parseBytes(smallBytes)
const representative = csv.parseBytes(representativeBytes)
const baseline = parseRows(representativeText, { fieldsPerRecord: -1 })
const streamed = await streamRows()
if (small.rows.length !== 1 || representative.rows.length !== 10_000 || baseline.length !== 10_001 || streamed !== 10_000) {
	throw new Error('CSV benchmark fixtures did not preserve their documented row counts.')
}

group('CSV collecting', () => {
	bench('csv.parseBytes: 2-row startup', () => {
		do_not_optimize(csv.parseBytes(smallBytes))
	})

	bench('csv.parseBytes: 10k rows × 5 columns', () => {
		do_not_optimize(csv.parseBytes(representativeBytes))
	})

	bench('@std/csv parse baseline: 10k rows × 5 columns', () => {
		do_not_optimize(parseRows(representativeText, { fieldsPerRecord: -1 }))
	})
})

group('CSV streaming', () => {
	bench('csv.parseStream: 10k rows × 5 columns, 64 KiB chunks', async () => {
		await using document = await csv.parseStream(chunks(representativeBytes))
		do_not_optimize(await Array.fromAsync(document.rows))
	})
})

await run()
