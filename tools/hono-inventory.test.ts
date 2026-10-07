import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { indexSource } from './hono-inventory.ts';

describe('Hono source inventory', () => {
	it('keeps callback inputs and matcher arguments at their exact upstream source sites', () => {
		const source = `describe('Fetch', () => {
  it('body', async () => {
    const request = new Request('https://example.test/', { method: 'POST', body: 'hello' });
    const response = await app.request(request);
    expect(await response.text()).toBe('hello');
  });
});`;
		const sites = indexSource('src/example.test.ts', source);
		const suite = sites.find((site) => site.kind === 'suite')!;
		const test = sites.find((site) => site.kind === 'test')!;
		expect(test.ancestors).toEqual([suite.id]);
		expect(test.body?.text).toContain("body: 'hello'");
		expect(test.assertions.map((assertion) => assertion.text)).toEqual(["expect(await response.text()).toBe('hello')"]);
		expect(suite.assertions).toEqual([]);
		expect(test.inputs.some((input) => input.text.startsWith('new Request('))).toBe(true);
		for (const span of [...test.assertions, ...test.inputs]) {
			expect(source.slice(span.start, span.end)).toBe(span.text);
		}
	});

	it('records each factories and computed loop titles without inventing expanded execution counts', () => {
		const source = `describe.each(Object.keys(routers))('%s', (name) => {
  for (const path of paths) {
    it.each(['/one', '/two'])(\`match \${name} \${path}\`, (value) => {
      expect(router.match(value)).toEqual([]);
    });
  }
});`;
		const sites = indexSource('src/router/example.test.ts', source);
		expect(sites.map((site) => site.kind)).toEqual(['suite', 'test']);
		const suite = sites[0]!;
		const test = sites[1]!;
		expect(suite.each.map((table) => table.text)).toEqual(['Object.keys(routers)']);
		expect(test.each.map((table) => table.text)).toEqual(["['/one', '/two']"]);
		expect(test.titleKind).toBe('computed');
		expect(test.dynamicContexts.some((context) => context.line === 2)).toBe(true);
		expect(test.assertions.map((assertion) => assertion.text)).toEqual(['expect(router.match(value)).toEqual([])']);
	});

	it('handles tagged tables, Deno assertions, and TSX without importing upstream production code', () => {
		const tagged = indexSource(
			'src/example.test.ts',
			"test.each`value\n${1}\n${2}`('case', (value) => expect(value).toBeTruthy());",
		);
		expect(tagged.map((site) => site.kind)).toEqual(['test']);
		expect(tagged[0]?.each[0]?.text.startsWith('`value')).toBe(true);
		const deno = indexSource(
			'runtime-tests/deno/example.test.ts',
			"Deno.test('response', () => { assertEquals(response.status, 200); });",
		);
		expect(deno[0]?.assertions[0]?.text).toBe('assertEquals(response.status, 200)');
		const jsx = indexSource('src/jsx/example.test.tsx', "it('view', () => { expect(<p>hello</p>).toBeDefined(); });");
		expect(jsx[0]?.assertions[0]?.text).toBe('expect(<p>hello</p>).toBeDefined()');
	});
});
