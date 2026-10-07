import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { audit, inspect } from './audit-fragile-tests.ts';
import type { ExceptionType } from './audit-fragile-tests.ts';

describe('fragile test audit', () => {
	it('rejects timers, current time, random properties, snapshots, and discarded failures in actual syntax', () => {
		const source = `
import fc from 'fast-check';
import { setTimeout as pause } from 'node:timers/promises';
import { setInterval as every } from 'node:timers';
import { delay as wait } from '@std/async/delay';
test('faulty fixture', async () => {
  await pause(1);
  await wait(1); every(() => {}, 1);
  setInterval(() => {}, 10);
  performance.now(); Date.now(); new Date(); Math.random();
  fc.assert(fc.property(fc.string(), () => true));
  expect(value).toMatchSnapshot();
  expect(action).toThrow(/internal prose/);
  expect(Promise.reject(value)).rejects.toBe(value);
  assert.rejects(Promise.reject(value));
  void work.catch(() => {});
  try { await work; } catch {}
});`;
		const findings = inspect(source);
		expect(new Set(findings.map((finding) => finding.rule))).toEqual(
			new Set([
				'wall-clock-timer',
				'wall-clock-now',
				'unseeded-random',
				'unseeded-property',
				'snapshot',
				'unawaited-assertion',
				'swallowed-rejection',
				'empty-catch',
				'diagnostic-regex',
			]),
		);
		expect(findings.every((finding) => finding.function === 'faulty fixture')).toBe(true);
	});

	it('accepts deterministic gates, seeded properties, fixed dates, and awaited or returned assertions', () => {
		const source = `
import * as fc from 'fast-check';
const documentaryFixture = "await setTimeout(1); Math.random(); catch {}";
// setTimeout and snapshots in prose are not executable patterns.
test('controlled fixture', async () => {
  const gate = Promise.withResolvers();
  gate.resolve(); await gate.promise;
  new Date('2000-01-01T00:00:00Z');
  fc.assert(fc.property(fc.integer(), value => value === value), { seed: 20261007 });
  await expect(work).rejects.toBe(reason);
  await assert.rejects(work);
  return expect(work).resolves.toBe(value);
});`;
		expect(inspect(source)).toEqual([]);
	});

	it('keeps exceptions narrow and rejects stale or duplicated exemptions', async (t) => {
		const root = await Deno.makeTempDir({ prefix: 'utils-fragile-audit-' });
		t.after(() => Deno.remove(root, { recursive: true }));
		await Deno.writeTextFile(`${root}/poll.test.ts`, 'function poll() { return performance.now(); }');
		const exception: ExceptionType = {
			file: 'poll.test.ts',
			rule: 'wall-clock-now',
			function: 'poll',
			operation: 'performance.now',
			count: 1,
			reason: 'Native descendant reaping is observed through the OS process table, without a latency assertion.',
		};
		expect((await audit(root)).findings).toHaveLength(1);
		const accepted = await audit(root, [exception]);
		expect(accepted.findings).toEqual([]);
		expect(accepted.exceptions).toHaveLength(1);
		expect(accepted.errors).toEqual([]);
		// Explanation quality is reviewed with the named operation; character
		// count cannot decide whether that native observation is necessary.
		const concise = await audit(root, [{ ...exception, reason: 'Native reaping.' }]);
		expect(concise.findings).toEqual([]);
		expect(concise.exceptions).toHaveLength(1);
		expect(concise.errors).toEqual([]);
		const unexplained = await audit(root, [{ ...exception, reason: ' \t' }]);
		expect(unexplained.findings).toHaveLength(1);
		expect(unexplained.exceptions).toEqual([]);
		expect(unexplained.errors.length).toBeGreaterThan(0);
		await Deno.writeTextFile(`${root}/poll.test.ts`, 'function poll() { performance.now(); performance.now(); }');
		expect((await audit(root, [exception])).errors).toHaveLength(1);
		expect((await audit(root, [exception, exception])).errors).toHaveLength(2);
	});

	it('reports syntax failure and excludes generated and investigation trees', async (t) => {
		const root = await Deno.makeTempDir({ prefix: 'utils-fragile-audit-' });
		t.after(() => Deno.remove(root, { recursive: true }));
		for (const directory of ['.agents', 'node_modules', 'dist']) {
			await Deno.mkdir(`${root}/${directory}`);
			await Deno.writeTextFile(`${root}/${directory}/ignored.test.ts`, 'setTimeout(() => {}, 1);');
		}
		await Deno.writeTextFile(`${root}/invalid.test.ts`, 'const value = ;');
		const result = await audit(root);
		expect(result.files).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.findings).toEqual([]);
	});
});
