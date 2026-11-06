import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as result from './mod.ts';

describe('result', () => {
	it('narrows success and failure variants', () => {
		const success: result.Result<number, Error> = result.ok(4);
		expect(result.isOk(success) && success.value).toBe(4);
		const failure: result.Result<number, Error> = result.fail(new Error('nope'));
		expect(result.isFailure(failure) && failure.failure.message).toBe('nope');
	});

	it('matches both variants and unwraps success', () => {
		expect(result.match(result.ok(2), { ok: (value) => value * 2, failure: () => 0 })).toBe(4);
		expect(result.unwrap(result.ok('ready'))).toBe('ready');
	});

	it('keeps function values distinct from lazy fallback factories', () => {
		const stored = () => 'stored';
		const fallback = () => 'fallback';

		const success: result.Result<() => string, Error> = result.ok(stored);
		const failure: result.Result<() => string, Error> = result.fail(new Error('missing'));

		expect(result.getOr(success, fallback)).toBe(stored);
		expect(result.getOr(failure, fallback)).toBe(fallback);
		expect(result.getOrElse(failure, () => fallback)).toBe(fallback);
	});

	it('throws the exact failure occurrence when unwrapping a failed result', () => {
		const failure = new Error('failed');
		expect(() => result.unwrap(result.fail(failure))).toThrow(failure);
	});
});

describe('result composition', () => {
	it('maps only the selected branch and preserves untouched wrappers', () => {
		const rejected = result.fail('missing');
		expect(result.map(rejected, () => {
			throw new Error('unexpected');
		})).toBe(rejected);
		expect(result.map(result.ok(3), (value) => value * 2)).toEqual(result.ok(6));
		const accepted = result.ok(3);
		expect(result.mapFailure(accepted, () => {
			throw new Error('unexpected');
		})).toBe(accepted);
		expect(result.mapFailure(rejected, (reason) => reason.length)).toEqual(result.fail(7));
		expect(result.flatMap(accepted, () => result.fail('new reason'))).toEqual(result.fail('new reason'));
	});

	it('captures synchronous throws and asynchronous rejections distinctly', async () => {
		const fault = new Error('failure');
		expect(result.capture(() => {
			throw fault;
		})).toEqual(result.fail(fault));
		expect(
			await result.captureAsync(async () => {
				throw fault;
			}),
		).toEqual(result.fail(fault));
		expect(
			await result.captureAsync(() => {
				throw fault;
			}),
		).toEqual(result.fail(fault));
		expect(await result.captureAsync(() => 2)).toEqual(result.ok(2));
	});
});
