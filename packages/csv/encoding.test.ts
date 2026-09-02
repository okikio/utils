import { describe, it } from 'node:test'
import { expect } from '@std/expect'

import * as encoding from './encoding.ts'

describe('CSV encoding', () => {
	it('preserves UTF-8 BOM and line-ending metadata', () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('name\r\nAda\r\n')])
		const decoded = encoding.decodeBytes(bytes)
		expect(decoded.encoding).toEqual('utf-8-bom')
		expect(decoded.lineEnding).toEqual('crlf')
		expect(decoded.text).toEqual('name\r\nAda\r\n')
	})

	it('reports the explicit Windows-1252 fallback', () => {
		const decoded = encoding.decodeBytes(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))
		expect(decoded.encoding).toEqual('windows-1252')
		expect(decoded.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['legacy-encoding'])
	})
})
