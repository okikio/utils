import assert from 'node:assert/strict';
import { test } from 'node:test';

import createFormatter from './changelog.mjs';

const formatter = createFormatter({ umbrella: '@okikio/utils' });

function release(overrides = {}) {
  return {
    name: '@okikio/csv',
    type: 'patch',
    oldVersion: '0.1.0',
    newVersion: '0.1.1',
    bumpFiles: [],
    isDependencyBump: false,
    isCascadeBump: false,
    isGroupBump: false,
    bumpSources: [],
    ...overrides,
  };
}

function bump(id, releases, summary, extra = {}) {
  return { id, releases, summary, ...extra };
}

test('leaf changelogs contain only direct user-facing summaries', () => {
  const output = formatter({
    release: release({ bumpFiles: ['csv-header'] }),
    bumpFiles: [
      bump('csv-header', [{ name: '@okikio/csv', type: 'patch' }], 'Preserve explicit header rows beyond the scan window.'),
      bump('queue', [{ name: '@okikio/queue', type: 'patch' }], 'Fence stale queue claims.'),
    ],
    date: '2026-08-31',
    target: 'changelog',
  });
  assert.match(output, /Preserve explicit header rows/);
  assert.doesNotMatch(output, /Fence stale queue claims/);
});

test('umbrella changelog aggregates consumed leaf summaries even when Bumpy records only one equal-severity source', () => {
  const output = formatter({
    release: release({
      name: '@okikio/utils',
      type: 'minor',
      newVersion: '0.2.0',
      isCascadeBump: true,
      // Bumpy 1.18.1 can retain only the first source when later cascades have
      // the same severity. The formatter must not use this as a completeness list.
      bumpSources: [{ name: '@okikio/csv', newVersion: '0.2.0', bumpType: 'minor' }],
    }),
    bumpFiles: [
      bump('csv', [{ name: '@okikio/csv', type: 'minor' }], 'Add streaming dialect discovery.'),
      bump('http', [{ name: '@okikio/http', type: 'patch' }], 'Keep response cleanup failures from replacing the request failure.'),
      bump('worker', [{ name: '@okikio/worker', type: 'patch' }], 'Own worker protocol rejection.'),
    ],
    date: '2026-08-31',
    target: 'changelog',
  });
  assert.match(output, /@okikio\/csv/);
  assert.match(output, /streaming dialect discovery/);
  assert.match(output, /@okikio\/http/);
  assert.match(output, /response cleanup failures/);
  assert.match(output, /@okikio\/worker/);
  assert.match(output, /worker protocol rejection/);
  assert.match(output, /deno add jsr:@okikio\/utils@0\.2\.0/);
});

test('changelog suppression works at file and package scope', () => {
  const output = formatter({
    release: release({ bumpFiles: ['hidden-file', 'hidden-package', 'visible'] }),
    bumpFiles: [
      bump('hidden-file', [{ name: '@okikio/csv', type: 'patch' }], 'Internal rewrite.', { noChangelog: true }),
      bump('hidden-package', [{ name: '@okikio/csv', type: 'patch', noChangelog: true }], 'Internal parser move.'),
      bump('visible', [{ name: '@okikio/csv', type: 'patch' }], 'Reject sparse header rows.'),
    ],
    date: '2026-08-31',
    target: 'changelog',
  });
  assert.doesNotMatch(output, /Internal rewrite/);
  assert.doesNotMatch(output, /Internal parser move/);
  assert.match(output, /Reject sparse header rows/);
});

test('GitHub release rendering turns explicit PR metadata into a link', () => {
  const oldRepo = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = 'okikio/utils';
  try {
    const output = formatter({
      release: release({ bumpFiles: ['csv-pr'] }),
      bumpFiles: [
        bump('csv-pr', [{ name: '@okikio/csv', type: 'patch' }], 'pr: 42\n\nPreserve one-column CSV imports.'),
      ],
      date: '2026-08-31',
      target: 'github-release',
    });
    assert.match(output, /\[#42\]\(https:\/\/github\.com\/okikio\/utils\/pull\/42\)/);
    assert.doesNotMatch(output, /pr: 42/);
  } finally {
    if (oldRepo === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = oldRepo;
  }
});
