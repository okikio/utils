import * as csv from './mod.ts'

const document = csv.parse('name\nAda\n')
const name: string | undefined = document.columns[0]?.name
void name

const options: csv.CsvParseOptions = { maximumRows: 10 }
void csv.parse('name\nAda\n', options)

// @ts-expect-error option names use complete words and obsolete maxRows is unsupported.
void csv.parse('name\nAda\n', { maxRows: 10 })

// @ts-expect-error generic CSV columns do not carry product-owned semantic roles.
document.columns[0]?.role
