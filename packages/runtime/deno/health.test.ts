import { it } from 'node:test';
import assert from 'node:assert/strict';
import { configuredPort } from './health.ts';

it('probe configuration is opt-in and refuses ambiguous or unusable listener ports', () => {
	assert.equal(configuredPort(undefined), undefined);
	assert.equal(configuredPort('8081'), 8081);
	assert.equal(configuredPort('65535'), 65535);
	for (const value of ['', '0', '65536', '-1', '1.5', '1e3', ' 8081', '8081 ', '08081', 'private-secret']) {
		assert.throws(() => configuredPort(value), (error: unknown) => {
			assert.ok(error instanceof RangeError);
			assert.equal(error.message, 'Process health port must be a decimal integer between 1 and 65535.');
			return true;
		});
	}
});

it('poll outcomes keep independent loops degraded until each owner recovers', async () => {
	const { open } = await import('./health.ts');
	await using listener = open({ signal: new AbortController().signal });
	const importing = listener.poller(), cleaning = listener.poller();
	const state = () => listener.status.state;
	assert.equal(state(), 'booting');
	importing(true);
	assert.equal(state(), 'booting');
	cleaning(true);
	assert.equal(state(), 'ready');
	importing(false);
	listener.ready(); // A boot callback cannot hide a failed registered loop.
	cleaning(true);
	assert.deepEqual(listener.status, { state: 'degraded', reason: 'dependency-unavailable' });
	importing(true);
	assert.equal(state(), 'ready');
	cleaning(false);
	importing(true);
	assert.equal(state(), 'degraded');
	cleaning(true);
	assert.equal(state(), 'ready');
	listener.stop();
	importing(true);
	cleaning(false);
	assert.equal(state(), 'stopping');
});
