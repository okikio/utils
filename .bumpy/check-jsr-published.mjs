#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Return the JSR package metadata URL for a scoped package name. */
export function metadataUrl(name) {
  const match = /^@([^/]+)\/([^/]+)$/.exec(name);
  if (!match) throw new Error(`Expected a scoped JSR package name, received ${name}`);
  return `https://jsr.io/@${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/meta.json`;
}

/** Check whether an exact immutable JSR version already exists. */
export async function isPublished(name, version, fetcher = fetch) {
  const response = await fetcher(metadataUrl(name), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`JSR metadata request failed with HTTP ${response.status}`);
  const metadata = await response.json();
  return Object.prototype.hasOwnProperty.call(metadata?.versions ?? {}, version);
}

async function main() {
  const packagePath = path.resolve(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (await isPublished(pkg.name, pkg.version)) {
    // Bumpy compares stdout to package.json's exact version.
    process.stdout.write(`${pkg.version}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
