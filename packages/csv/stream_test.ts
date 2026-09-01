import { describe, it } from 'node:test'
import { expect } from '@std/expect'

import * as csv from './mod.ts'

const encoder = new TextEncoder()

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
	const encoded = chunks.map((chunk) => encoder.encode(chunk))
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of encoded) controller.enqueue(chunk)
			controller.close()
		},
	})
}

describe('CSV streaming parser', () => {
	it('streams quoted records across arbitrary byte chunks', async () => {
		await using document = await csv.parseStream(stream(
			'Company,Notes,Email\nNorthstar,"line one\n',
			'line two",hello@northstar.example\n',
		))

		expect(document.columns.map((column) => column.normalizedName)).toEqual(['company', 'notes', 'email'])
		expect(await Array.fromAsync(document.rows)).toEqual([{
			row: 2,
			values: ['Northstar', 'line one\nline two', 'hello@northstar.example'],
			diagnostics: [],
		}])
	})

	it('accepts a one-column domain import', async () => {
		await using document = await csv.parseStream(stream('Domain\nexample.com\nopenai.com\n'))

		expect(document.columns.map((column) => column.key)).toEqual(['domain'])
		expect((await Array.fromAsync(document.rows)).map((row) => row.values)).toEqual([['example.com'], ['openai.com']])
	})

	it('enforces row, column, and cell limits while rows are consumed', async () => {
		await using rowLimited = await csv.parseStream(
			stream('Company,Domain\nOne,one.example\nTwo,two.example\n'),
			{ maximumRows: 1 },
		)
		await expect(Array.fromAsync(rowLimited.rows)).rejects.toThrow(csv.CsvParseError)

		await using columnLimited = await csv.parseStream(
			stream('Company,Domain\nOne,one.example,unexpected\n'),
			{ maximumColumns: 2 },
		)
		await expect(Array.fromAsync(columnLimited.rows)).rejects.toThrow(csv.CsvParseError)

		await using cellLimited = await csv.parseStream(
			stream('Company,Domain\nNorthstar,northstar.example\n'),
			{ maximumCellCharacters: 5 },
		)
		await expect(Array.fromAsync(cellLimited.rows)).rejects.toThrow(csv.CsvParseError)
	})

	it('attaches recoverable observations to the exact streamed row', async () => {
		await using document = await csv.parseStream(stream('Company,Domain\n=WEBSERVICE("x"),example.com,extra\n'))
		const rows = await Array.fromAsync(document.rows)
		expect(rows[0]?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
			'row-width-mismatch',
			'spreadsheet-formula',
		])
	})

	it('is one-shot and supports explicit disposal before exhaustion', async () => {
		const document = await csv.parseStream(stream('Company,Domain\nOne,one.example\nTwo,two.example\n'))
		const iterator = document.rows[Symbol.asyncIterator]()
		expect((await iterator.next()).value?.row).toEqual(2)
		await document[Symbol.asyncDispose]()
		await expect(Array.fromAsync(document.rows)).rejects.toThrow(TypeError)
	})

	it('does not apply the automatic header scan limit to an explicit header row', async () => {
		const preamble = Array.from({ length: 30 }, (_, index) => `note ${index + 1}`)
		const source = [...preamble, 'Company,Domain', 'Northstar,northstar.example'].join('\n')

		await using document = await csv.parseStream(stream(source), { headerRow: 31, headerScanRows: 5 })
		expect(document.headerRow).toBe(31)
		expect((await Array.fromAsync(document.rows))[0]?.values).toEqual(['Northstar', 'northstar.example'])
	})

	it('snapshots options before the first asynchronous source read', async () => {
		const options: csv.CsvStreamOptions = { maximumRows: 1 }
		const pending = csv.parseStream(stream('Name\nOne\nTwo\n'), options)
		options.maximumRows = 10
		await using document = await pending
		await expect(Array.fromAsync(document.rows)).rejects.toThrow(csv.CsvParseError)
	})
})
