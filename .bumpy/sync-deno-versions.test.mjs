import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { synchronizePackage } from './sync-deno-versions.mjs';

function fixture(denoText, packageVersion = '1.2.3') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okikio-version-sync-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@okikio/test', version: packageVersion }, null, 2));
  fs.writeFileSync(path.join(dir, 'deno.jsonc'), denoText);
  return dir;
}

test('synchronizes a JSONC version without removing comments', () => {
  const dir = fixture('{\n  // package identity\n  "name": "@okikio/test",\n  "version": "1.2.2",\n  "exports": "./mod.ts"\n}\n');
  try {
    const result = synchronizePackage(dir);
    assert.equal(result.changed, true);
    const updated = fs.readFileSync(path.join(dir, 'deno.jsonc'), 'utf8');
    assert.match(updated, /\/\/ package identity/);
    assert.match(updated, /"version": "1\.2\.3"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check mode reports version drift without mutating the manifest', () => {
  const original = '{\n  "name": "@okikio/test",\n  "version": "1.0.0",\n  "exports": "./mod.ts"\n}\n';
  const dir = fixture(original, '2.0.0');
  try {
    assert.throws(() => synchronizePackage(dir, { check: true }), /package\.json is 2\.0\.0/);
    assert.equal(fs.readFileSync(path.join(dir, 'deno.jsonc'), 'utf8'), original);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
