import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import { create } from '@okikio/runtime/deno/process';
import { start } from '@okikio/worker/process';

describe('restricted system-kill group host', () => {
	it('stops a real owned POSIX group through the explicit host', { skip: Deno.build.os === 'windows' }, async () => {
		await using ctx = context.create({ id: 'system-kill' });
		await using child = await start(ctx, create({ groupHost: 'system-kill' }), {
			command: '/bin/sh',
			arguments: ['-c', 'exec sleep 30'],
			tree: 'posix-process-group',
			stdout: { type: 'discard' },
			stderr: { type: 'discard' },
			shutdown: { graceMs: 1000, forceMs: 1000 },
		});
		await child.stop();
		expect((await child.wait()).success).toBe(false);
	});
});
