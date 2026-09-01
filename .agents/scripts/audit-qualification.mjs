import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const matrix = JSON.parse(await readFile(new URL('../../qualification/packages.json', import.meta.url), 'utf8'));
const packageRoot = fileURLToPath(new URL('../../packages/', import.meta.url));
const allowlist = JSON.parse(await readFile(new URL('../../qualification/fragile-allowlist.json', import.meta.url), 'utf8'));
const allowed = new Map(allowlist.entries.map((entry) => [`${entry.path}:${entry.pattern}`, entry.reason]));
const errors = [];
const dirs = (await readdir(packageRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const expected = dirs.map((name) => `@okikio/${name}`);
const declared = Object.keys(matrix.packages).map((name) => `@okikio/${name}`).sort();

if (JSON.stringify(expected) !== JSON.stringify(declared)) {
  errors.push(`qualification package inventory differs from workspace: expected ${expected.length}, declared ${declared.length}`);
}

const fragilePatterns = [
  { name: 'wall-clock setTimeout', pattern: /\bsetTimeout\s*\(/ },
  { name: 'Date.now timing', pattern: /\bDate\.now\s*\(/ },
  { name: 'performance.now timing', pattern: /\bperformance\.now\s*\(/ },
  { name: 'snapshot matcher', pattern: /\btoMatch(?:Inline)?Snapshot\s*\(/ },
];

async function files(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}

for (const [packageName, entry] of Object.entries(matrix.packages)) {
  const name = `@okikio/${packageName}`;
  if (!entry.capability || !Array.isArray(entry.scenarios) || entry.scenarios.length === 0) {
    errors.push(`${name} requires a concrete capability and scenario group`);
  }
  const packageFiles = await files(join(packageRoot, packageName));
  const tests = packageFiles.filter((value) => /(?:_test|\.test)\.ts$/.test(value));
  if (tests.length === 0) errors.push(`${name} has no public test source`);
  const runtimes = { ...matrix.defaults.runtimes, ...(entry.runtimes ?? {}) };
  if (runtimes.deno !== 'required') errors.push(`${name} must retain the Deno-first source contract`);
  if (!entry.performance?.status) errors.push(`${name} requires a performance ownership status`);
  for (const benchmark of entry.performance?.files ?? []) {
    try { await stat(fileURLToPath(new URL(`../../${benchmark}`, import.meta.url))); }
    catch { errors.push(`${name} registers missing benchmark ${benchmark}`); }
  }
}

for (const packageName of dirs) {
  const packageFiles = await files(fileURLToPath(new URL(`../../packages/${packageName}/`, import.meta.url)));
  for (const path of packageFiles.filter((value) => /(?:_test|\.test)\.ts$/.test(value))) {
    const source = await readFile(path, 'utf8');
    const lines = source.split('\n');
    for (const check of fragilePatterns) {
      for (let index = 0; index < lines.length; index += 1) {
        if (!check.pattern.test(lines[index])) continue;
        const relative = path.slice(fileURLToPath(new URL('../../', import.meta.url)).length);
        const key = `${relative}:${check.pattern.source.includes('setTimeout') ? 'setTimeout' : check.name}`;
        const allowance = lines.slice(Math.max(0, index - 2), index + 1).join('\n');
        if (allowance.includes('qualification-allow-timing:') || allowed.has(key)) continue;
        errors.push(`${relative}:${index + 1}: ${check.name} requires explicit synchronization or a reviewed timing exception`);
      }
    }
  }
}

for (const entry of allowlist.entries) {
  if (!entry.reason || entry.reason.length < 24) errors.push(`${entry.path}: fragile-test allowance requires a concrete reason`);
}

if (errors.length > 0) {
  console.error(`qualification audit failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`qualification audit passed: ${Object.keys(matrix.packages).length} packages, no unreviewed fragile-test patterns`);
}
