import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import * as fc from 'fast-check'

import * as csv from './mod.ts'

describe('CSV headers', () => {
	it('normalizes Unicode, punctuation, case, and whitespace deterministically', () => {
		expect(csv.normalizeHeader('\ufeff Company:Website_URL ')).toEqual('company website url')
		expect(csv.normalizeHeader('Person—Email (Work)')).toEqual('person-email work')
	})

	it('is idempotent for arbitrary strings', () => {
		fc.assert(fc.property(fc.string(), (value) => {
			expect(csv.normalizeHeader(csv.normalizeHeader(value))).toEqual(csv.normalizeHeader(value))
		}), { numRuns: 500 })
	})

	it('rejects non-string values instead of coercing them', () => {
		expect(() => csv.normalizeHeader({ toString: () => 'header' } as never)).toThrow(TypeError)
	})
})
