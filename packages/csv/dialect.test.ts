import { describe, it } from 'node:test'
import { expect } from '@std/expect'

import * as dialect from './dialect.ts'

describe('CSV dialect detection', () => {
	it('ranks comma, semicolon, and tab delimiters from a bounded quote-aware sample', () => {
		expect(dialect.rank('a,b\n1,2\n')[0]).toEqual(',')
		expect(dialect.rank('a;b\n1;2\n')[0]).toEqual(';')
		expect(dialect.rank('a\tb\n1\t2\n')[0]).toEqual('\t')
	})

	it('does not count delimiters inside quoted fields as structural separators', () => {
		expect(dialect.rank('name;notes\nAda;"one,two,three"\n')[0]).toEqual(';')
	})
})
