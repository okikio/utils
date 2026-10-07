/** Fault controls for source-documentation diagnostics across terminal policies. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { diagnostics } from './doc-diagnostics.ts';

describe('documentation diagnostic transport', () => {
	it('preserves stable source identity across wording and ANSI color changes', () => {
		const plain = 'error[missing-jsdoc]: Original explanation\n --> /fixture/public.ts:12:4\n';
		const colored =
			'\u001b[31merror[missing-jsdoc]\u001b[0m: A revised explanation\n \u001b[36m--> /fixture/public.ts:12:4\u001b[0m\n';
		for (const output of [plain, colored]) {
			const [value] = diagnostics(output);
			expect(value).toMatchObject({ code: 'missing-jsdoc', path: '/fixture/public.ts', line: 12, column: 4 });
		}
	});
	it('keeps new codes and malformed locations available for the gate to reject', () => {
		const parsed = diagnostics(
			'error[new-code]: explanation\n --> /fixture/private.ts:3:2\nerror[missing-jsdoc]: no location\n',
		);
		expect(parsed.map(({ code, path }) => ({ code, path }))).toEqual([
			{ code: 'new-code', path: '/fixture/private.ts' },
			{ code: 'missing-jsdoc', path: undefined },
		]);
	});
});
