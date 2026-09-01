import { describe, it } from 'node:test'
import { expect } from '@std/expect'

import * as options from './options.ts'

describe('CSV options', () => {
	it('rejects hidden, inherited, accessor-backed, and unknown configuration', () => {
		let reads = 0
		const accessor = Object.create(null) as Record<string, unknown>
		Object.defineProperty(accessor, 'maximumRows', {
			enumerable: true,
			get() {
				reads += 1
				return 10
			},
		})
		expect(() => options.parse(accessor)).toThrow(TypeError)
		expect(reads).toEqual(0)
		expect(() => options.parse(Object.create({ maximumRows: 1 }))).toThrow(TypeError)
		expect(() => options.parse({ unsupported: true } as never)).toThrow(TypeError)
	})

	it('resolves full-word limits and clamps peek bytes to the source bound', () => {
		expect(options.parse({ maximumRows: 12 }).maximumRows).toEqual(12)
		expect(options.stream({ maximumBytes: 8, maximumPeekBytes: 64 }).maximumPeekBytes).toEqual(8)
	})
})
