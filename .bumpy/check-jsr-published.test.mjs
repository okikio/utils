import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPublished, metadataUrl } from './check-jsr-published.mjs';

test('builds the canonical JSR registry metadata URL', () => {
  assert.equal(metadataUrl('@okikio/queue'), 'https://jsr.io/@okikio/queue/meta.json');
});

test('detects an exact published version from JSR metadata', async () => {
  const fetcher = async () => new Response(JSON.stringify({ versions: { '0.1.0': {}, '0.1.1': { yanked: true } } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(await isPublished('@okikio/queue', '0.1.0', fetcher), true);
  // Yanked versions are still immutable and therefore count as already published.
  assert.equal(await isPublished('@okikio/queue', '0.1.1', fetcher), true);
  assert.equal(await isPublished('@okikio/queue', '0.2.0', fetcher), false);
});

test('treats a missing JSR package as unpublished', async () => {
  const fetcher = async () => new Response('', { status: 404 });
  assert.equal(await isPublished('@okikio/new-package', '0.1.0', fetcher), false);
});
