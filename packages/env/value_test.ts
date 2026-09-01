import { expect } from '@std/expect'
import { describe, it } from 'node:test'

import { blank } from './value.ts'

describe('blank', () => {
	it('treats whitespace-only strings as missing', () => {
		expect(blank('   ')).toBeUndefined()
	})

	it('trims configured string values without changing non-string values', () => {
		expect(blank('  production  ')).toBe('production')
		expect(blank(42)).toBe(42)
	})
})
