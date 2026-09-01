#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
}

const cwd = process.cwd();
const packageJsonPath = path.join(cwd, 'package.json');
const denoPath = fs.existsSync(path.join(cwd, 'deno.json')) ? path.join(cwd, 'deno.json') : path.join(cwd, 'deno.jsonc');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const denoText = fs.readFileSync(denoPath, 'utf8');
const denoVersion = denoText.match(/"version"\s*:\s*"([^"]+)"/)?.[1];

if (pkg.private !== true) throw new Error(`${pkg.name}: package.json must stay private to block npm publication`);
if (denoVersion !== pkg.version) throw new Error(`${pkg.name}: package.json ${pkg.version} != JSR manifest ${denoVersion ?? '(missing)'}`);

try {
  // Bumpy resolves workspace: protocols in package.json before custom publish
  // commands. JSR/Deno already understands this workspace, so restore the exact
  // committed package.json before publication and keep the tag reproducible.
  run('git', ['restore', '--source=HEAD', '--', 'package.json'], { cwd });
  run('deno', ['publish', '--check=all'], { cwd });
} finally {
  // Restore even when publication fails so the remaining release plan sees a
  // clean source tree and a retry starts from the tagged source representation.
  const restore = spawnSync('git', ['restore', '--source=HEAD', '--', 'package.json'], { cwd, stdio: 'inherit' });
  if (restore.error) console.error(restore.error);
}
