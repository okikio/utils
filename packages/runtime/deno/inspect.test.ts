import { it } from 'node:test';
import { expect } from '@std/expect';
import { inspect } from './inspect.ts';
it('queries exact scopes without acquiring them and retains no private descriptor', async () => {
	const descriptor = { name: 'read', path: '/private/inspection-evidence' } as const;
	const expected = await Deno.permissions.query(descriptor);
	const report = await inspect([descriptor], { maximumQueries: 1 });
	expect(report.permissions).toEqual([{ index: 0, state: expected.state }]);
	expect(JSON.stringify(report)).not.toContain(descriptor.path);
	await expect(inspect([descriptor], { maximumQueries: 0 })).rejects.toThrow(RangeError);
	expect((await inspect([], { maximumQueries: 0 })).permissions).toEqual([]);
});

it('distinguishes denied from prompt in a real restricted fresh process', async () => {
	const result = await new Deno.Command(Deno.execPath(), {
		args: [
			'run',
			'--no-prompt',
			'--deny-read',
			'--deny-net',
			new URL('./fixtures/inspect.ts', import.meta.url).pathname,
		],
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	expect(result.success).toBe(true);
	expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual(['denied', 'denied', 'prompt']);
});
