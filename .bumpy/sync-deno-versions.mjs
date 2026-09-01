#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(root, 'packages');
const check = process.argv.includes('--check');
const VERSION_RE = /(\"version\"\s*:\s*\")[^\"]+(\"\s*,)/;

/** Synchronize the JSR manifest version with Bumpy's package.json authority. */
export function synchronizePackage(dir, options = {}) {
  const packagePath = path.join(dir, 'package.json');
  const denoPath = fs.existsSync(path.join(dir, 'deno.json')) ? path.join(dir, 'deno.json') : path.join(dir, 'deno.jsonc');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const text = fs.readFileSync(denoPath, 'utf8');
  const match = text.match(VERSION_RE);
  if (!match) throw new Error(`${path.relative(root, denoPath)} has no top-level version field`);
  const current = match[0].slice(match[1].length, match[0].length - match[2].length);
  if (current === pkg.version) return { changed: false, name: pkg.name, version: pkg.version, denoPath };
  if (options.check) {
    throw new Error(`${pkg.name}: package.json is ${pkg.version}, but ${path.basename(denoPath)} is ${current}`);
  }
  const updated = text.replace(VERSION_RE, `$1${pkg.version}$2`);
  fs.writeFileSync(denoPath, updated);
  return { changed: true, name: pkg.name, version: pkg.version, denoPath };
}

/** Synchronize every workspace package. */
export function synchronizeWorkspace(options = {}) {
  const results = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    results.push(synchronizePackage(path.join(packagesDir, entry.name), options));
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const results = synchronizeWorkspace({ check });
    const changed = results.filter((result) => result.changed);
    if (check) console.log(`Version manifests aligned for ${results.length} packages.`);
    else console.log(`Synchronized ${changed.length} of ${results.length} JSR manifest versions.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
