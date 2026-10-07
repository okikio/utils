/** Pinned Hono composition behavior through public HTTP applications and literal oracles. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { discard } from '@okikio/http/response';
import { catchErrors, create, route } from '@okikio/server/http';
import { Hono } from 'hono';
import { fixture, nested, promiseContinuations, snapshot } from './fixtures/hono-compose/implementations.ts';
import type { Layer } from './fixtures/hono-compose/implementations.ts';

const request = () => new Request('http://localhost/');
const pass: Layer = (_scope, next) => next();
const onion: readonly Layer[] = [1, 2, 3].map((before) => async (scope, next) => {
	scope.called.push(true);
	scope.arr.push(before);
	const response = await next();
	scope.arr.push(7 - before);
	return response;
});
class ExpectedError extends Error {}

/** Consume every finite response before checking its independent expected wire outcome. */
async function response(value: Response, status = 200, text = 'Hello'): Promise<void> {
	const actual = await value.text();
	expect(value.status).toBe(status);
	expect(actual).toBe(text);
}

for (const candidate of ['hono', 'utils'] as const) {
	describe(`pinned Hono compose public HTTP: ${candidate}`, () => {
		it('Request and Response retain upstream state and header values', async () => {
			const api = fixture(candidate, [
				async (scope, next) => {
					scope.log = 'log';
					return await next();
				},
				async (_scope, next) => {
					const result = await next();
					result.headers.set('x-custom-header', 'custom-header');
					return result;
				},
				async (scope, next) => {
					scope.xxx = 'yyy';
					const result = await next();
					scope.zzz = 'xxx';
					return result;
				},
			], (scope) => {
				scope.log = `${scope.log} message`;
				return Response.json({ message: 'new response' });
			});
			const input = request();
			const result = await api.fetch(input);
			expect(await result.json()).toEqual({ message: 'new response' });
			expect(result.headers.get('x-custom-header')).toBe('custom-header');
			expect(api.scope(input).log).toBe('log message');
			expect(api.scope(input).xxx).toBe('yyy');
			expect(api.scope(input).zzz).toBe('xxx');
		});

		it('non-async handler returns an owned promise', { timeout: 15_000 }, async () => {
			const gate = Promise.withResolvers<Response>();
			const api = fixture(candidate, [], () => gate.promise);
			const pending = api.fetch(request());
			const expected = Response.json({ message: 'new response' });
			try {
				gate.resolve(expected);
				expect(await (await pending).json()).toEqual({ message: 'new response' });
			} finally {
				gate.resolve(expected);
				await pending.then((value) => discard(value), () => undefined);
				await discard(expected);
			}
		});

		it('request and response header middleware preserve foo and bar', async () => {
			const api = fixture(candidate, [
				async (scope, next) => {
					scope.request.headers.append('x-header-foo', 'foo');
					return await next();
				},
				async (_scope, next) => {
					const value = await next();
					value.headers.set('x-header-bar', 'bar');
					return value;
				},
			], (scope) => new Response(scope.request.headers.get('x-header-foo') ?? ''));
			const value = await api.fetch(request());
			await response(value, 200, 'foo');
			expect(value.headers.get('x-header-bar')).toBe('bar');
		});

		it('early response skips later middleware', async () => {
			const api = fixture(candidate, [() => new Response('Hello'), (scope, next) => {
				scope.called.push(true);
				return next();
			}]);
			const input = request();
			await response(await api.fetch(input));
			expect(api.scope(input).called).toEqual([]);
			expect(api.scope(input).terminalCalls).toBe(0);
		});

		for (const asynchronous of [false, true]) {
			it(`not found callback: ${asynchronous ? 'async' : 'sync'}`, async () => {
				const body = asynchronous ? 'onNotFoundAsync' : 'onNotFound';
				const terminal = () => new Response(body, { status: 404 });
				if (candidate === 'hono') {
					const app = new Hono();
					app.use('*', async (_context, next) => {
						await next();
					});
					app.notFound(asynchronous ? async () => terminal() : terminal);
					await response(await app.fetch(request()), 404, body);
				} else {
					const app = create({
						middleware: [async (input, next) => await next(input)],
						notFound: asynchronous ? async () => terminal() : terminal,
					});
					await response(await app.fetch(request()), 404, body);
				}
			});
		}

		it('middleware replaces Hello with Not authorized and owns discarded body', async () => {
			const api = fixture(candidate, [async (_scope, next) => {
				await discard(await next());
				return new Response('Not authorized', { status: 401 });
			}]);
			await response(await api.fetch(request()), 401, 'Not authorized');
		});

		it('next sees request header written before dispatch', async () => {
			const api = fixture(candidate, [async (scope, next) => {
				scope.request.headers.append('x-custom', 'foo');
				return await next();
			}], (scope) => new Response(scope.request.headers.get('x-custom') ?? 'blank'));
			await response(await api.fetch(request()), 200, 'foo');
		});

		for (const asynchronous of [false, true]) {
			it(`onError callback: ${asynchronous ? 'async' : 'sync'}`, async () => {
				const handler = () => {
					throw new Error();
				};
				const mapped = () => new Response('onError', { status: 500 });
				if (candidate === 'hono') {
					const app = new Hono();
					app.use('*', async (_context, next) => {
						await next();
					});
					app.onError(asynchronous ? async () => mapped() : mapped);
					app.get('/', handler);
					await response(await app.fetch(request()), 500, 'onError');
				} else {
					const app = create({
						routes: [route('GET', '/', handler)],
						middleware: [
							catchErrors({
								map: asynchronous ? async () => mapped() : mapped,
							}),
							async (input, next) => await next(input),
						],
					});
					await response(await app.fetch(request()), 500, 'onError');
				}
			});
		}

		it('all middleware enters in authored order', async () => {
			const api = fixture(
				candidate,
				[0, 1, 2].map((index) => (scope, next) => {
					scope.arr.push(index);
					return next();
				}),
			);
			const input = request();
			await response(await api.fetch(input));
			expect(api.scope(input).arr).toEqual([0, 1, 2]);
		});

		for (const twoLayers of [true, false]) {
			it(`repeated next rejects once: ${twoLayers ? 'nested' : 'single'}`, async () => {
				const repeated: Layer = async (_scope, next) => {
					await discard(await next());
					return await next();
				};
				const api = fixture(candidate, twoLayers ? [pass, repeated] : [repeated]);
				const input = request();
				const failure: unknown = await api.fetch(input).then(async (value) => {
					await discard(value);
					throw new Error('Repeated continuation unexpectedly completed.');
				}, (error: unknown) => error);
				expect(failure).toBeInstanceOf(candidate === 'hono' ? Error : TypeError);
				if (!(failure instanceof Error)) throw new Error('Continuation failed without an Error.');
				// Retain Hono's upstream assertion. Utils promises the error type and
				// exactly one terminal call, rather than the wording of diagnostics.
				if (candidate === 'hono') expect(failure.message).toBe('next() called multiple times');
				expect(api.scope(input).terminalCalls).toBe(1);
			});
		}

		it('onion order matches all six literal steps', async () => {
			const api = fixture(candidate, onion);
			const input = request();
			await response(await api.fetch(input));
			expect(api.scope(input).called).toEqual([true, true, true]);
			expect(api.scope(input).arr).toEqual([1, 2, 3, 4, 5, 6]);
		});

		it('lack next short-circuits with an owned 401 response', async () => {
			const api = fixture(candidate, [onion[0]!, (scope) => {
				scope.called.push(true);
				scope.arr.push(2);
				return new Response('Not authorized', { status: 401 });
			}, onion[2]!]);
			const input = request();
			await response(await api.fetch(input), 401, 'Not authorized');
			expect(api.scope(input).called).toEqual([true, true]);
			expect(api.scope(input).arr).toEqual([1, 2, 6]);
			expect(api.scope(input).terminalCalls).toBe(0);
		});

		it('reuse keeps separate request state and resets continuation ownership', async () => {
			const api = fixture(candidate, onion);
			const first = request();
			const second = request();
			await response(await api.fetch(first));
			await response(await api.fetch(second));
			expect(api.scope(first).arr).toEqual([1, 2, 3, 4, 5, 6]);
			expect(api.scope(second).arr).toEqual([1, 2, 3, 4, 5, 6]);
			expect(api.scope(first).arr).not.toBe(api.scope(second).arr);
		});

		it('plain middleware can return and await all five continuation promises', async () => {
			const api = promiseContinuations(candidate);
			await response(await api.fetch(request()));
			expect(api.promises).toHaveLength(5);
			for (const pending of api.promises) expect(pending).toBeInstanceOf(Promise);
			await Promise.all(api.promises);
		});

		it('empty middleware reaches terminal response', async () => {
			const api = fixture(candidate, []);
			await response(await api.fetch(request()));
		});

		it('yielding end of stack resumes the awaiting middleware', async () => {
			const api = fixture(candidate, [async (scope, next) => {
				const value = await next();
				scope.called.push(true);
				return value;
			}]);
			const input = request();
			await response(await api.fetch(input));
			expect(api.scope(input).called).toEqual([true]);
		});

		for (const kind of ['sync', 'async', 'wrapped'] as const) {
			it(`middleware propagates ExpectedError: ${kind}`, async () => {
				const error = new ExpectedError();
				const throwing: Layer = kind === 'async'
					? async () => {
						throw error;
					}
					: function () {
						throw error;
					};
				const api = fixture(candidate, kind === 'wrapped' ? [pass, throwing] : [throwing]);
				const failure: unknown = await api.fetch(request()).then(async (value) => {
					await discard(value);
					throw new Error('Throwing middleware unexpectedly completed.');
				}, (reason: unknown) => reason);
				expect(failure).toBe(error);
			});
		}

		it('all layers retain the same per-request identity', async () => {
			const api = fixture(candidate, Array.from({ length: 3 }, (): Layer => async (_scope, next) => await next()));
			const input = request();
			await response(await api.fetch(input));
			expect(api.scope(input).identities).toHaveLength(4);
			for (const identity of api.scope(input).identities) expect(identity).toBe(api.scope(input).identity);
		});

		for (const asynchronous of [true, false]) {
			it(`upstream catches downstream thrown error: ${asynchronous ? 'async' : 'sync'}`, async () => {
				const downstream: Layer = asynchronous
					? async (scope) => {
						scope.arr.push(4);
						throw new Error();
					}
					: (scope) => {
						scope.arr.push(4);
						throw new Error();
					};
				const api = fixture(candidate, [async (scope, next) => {
					scope.arr.push(1);
					try {
						scope.arr.push(6);
						await discard(await next());
						scope.arr.push(7);
					} catch {
						scope.arr.push(2);
					}
					scope.arr.push(3);
					return new Response('Hello');
				}, downstream]);
				const input = request();
				await response(await api.fetch(input));
				expect(api.scope(input).arr).toEqual([1, 6, 4, 2, 3]);
			});
		}

		it('empty composition invokes caller terminal', async () => {
			let called = false;
			const api = fixture(candidate, [], () => {
				called = true;
				return new Response('Hello');
			});
			await response(await api.fetch(request()));
			expect(called).toBe(true);
		});

		it('nested public composition preserves all three middleware calls', async () => {
			const api = nested(candidate);
			const input = request();
			await response(await api.fetch(input));
			expect(api.scope(input).arr).toEqual([1, 2, 3]);
			expect(api.scope(input).arr.length).toBe(3);
		});

		it('last outer state update follows both inner value observations', async () => {
			const api = fixture(candidate, [async (scope, next) => {
				const value = await next();
				scope.arr.push(scope.val);
				scope.val = 1;
				return value;
			}, async (scope, next) => {
				scope.val = 2;
				const value = await next();
				scope.arr.push(scope.val);
				return value;
			}]);
			const input = request();
			await response(await api.fetch(input));
			expect(api.scope(input).arr).toEqual([2, 2]);
			expect(api.scope(input).val).toBe(1);
		});

		it('registration leaves caller array unchanged and snapshots its middleware', async () => {
			const api = snapshot(candidate);
			await response(await api.fetch(request()));
			expect(api.unchanged).toBe(true);
			expect(api.calls).toEqual([1]);
		});

		it('passed terminal stalls then resumes exactly once', { timeout: 15_000 }, async (test) => {
			const gate = Promise.withResolvers<void>();
			const entered = Promise.withResolvers<void>();
			const stop = () => {
				gate.resolve();
				entered.resolve();
			};
			test.signal.addEventListener('abort', stop, { once: true });
			let settled = false;
			let terminalEntered = false;
			const api = fixture(candidate, [(scope, next) => {
				scope.arr.push(1);
				return next();
			}], async (scope) => {
				scope.val += 1;
				terminalEntered = true;
				entered.resolve();
				await gate.promise;
				return new Response('Hello');
			});
			const input = request();
			const pending = api.fetch(input);
			const completion = pending.then(() => {
				settled = true;
			}, () => {
				settled = true;
			});
			const entryOutcome = pending.then(() => {
				if (!terminalEntered) throw new Error('Terminal was never entered.');
			});
			try {
				await Promise.race([entered.promise, entryOutcome]);
				expect(settled).toBe(false);
				gate.resolve();
				await response(await pending);
				expect(api.scope(input).arr).toEqual([1]);
				expect(api.scope(input).val).toBe(1);
				expect(api.scope(input).terminalCalls).toBe(1);
			} finally {
				gate.resolve();
				entered.resolve();
				await pending.then((value) => discard(value), () => undefined);
				await completion;
				await entryOutcome.catch(() => undefined);
				test.signal.removeEventListener('abort', stop);
			}
		});
	});
}
