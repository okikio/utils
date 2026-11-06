/** Protocol plans measure policy above native/STD cost references; no body or retry execution is included. */
import { bench, do_not_optimize, group } from 'mitata';
import { ifMatch } from '@std/http/etag';
import { preconditions } from '@okikio/http/response/http';
import { planRetryAfter } from '@okikio/http/retry';
import * as cookie from '@okikio/http/cookie';
import * as schema from '@okikio/schema';
import { run } from './fixtures/bench.ts';
const now = Date.parse('2026-11-04T00:00:00Z');
for (const count of [1, 100, 1000]) {
	const tags = Array.from({ length: count }, (_, index) => `"tag-${index}"`).join(', ');
	const etag = `"tag-${count - 1}"`;
	const request = new Request('https://test.invalid', { headers: { 'if-match': tags } });
	if (!ifMatch(tags, etag) || preconditions(request, { exists: true, etag, now }).kind !== 'continue') {
		throw new Error('Tag-list oracle failed.');
	}
	group(`matching last of ${count} ordinary tags`, () => {
		bench(
			'precondition plan, header lookup and precedence',
			() => do_not_optimize(preconditions(request, { exists: true, etag, now })),
		);
		bench('STD scalar comparison only', () => do_not_optimize(ifMatch(tags, etag)));
	});
}
const advice = 'Wed, 04 Nov 2026 00:00:01 GMT';
const plan = planRetryAfter(advice, { now, maximumDelay: 5000, maximumCodeUnits: 128 });
if (plan.kind !== 'delay' || plan.milliseconds !== 1000) throw new Error('Retry advice oracle failed.');
group('Retry-After date advice', () => {
	bench(
		'bounded complete plan',
		() => do_not_optimize(planRetryAfter(advice, { now, maximumDelay: 5000, maximumCodeUnits: 128 })),
	);
	bench('native permissive date parse only', () => do_not_optimize(Date.parse(advice)));
});
const Session = cookie.define({
	id: 'bench.session',
	name: '__Host-session',
	description: 'Cookie identity benchmark.',
	value: schema.string(),
	attributes: { path: '/', secure: true, sameSite: 'none' },
});
/** Each cycle owns its Headers; retained occurrences cannot grow across iterations. */
function cookies(): number {
	const headers = new Headers();
	for (let index = 0; index < 100; index++) {
		cookie.set(headers, Session, 'value');
		cookie.remove(headers, Session);
	}
	return headers.getSetCookie().length;
}
if (cookies() !== 200) throw new Error('Repeated cookie occurrence oracle failed.');
bench('100 cookie set/remove pairs, authored identity', () => do_not_optimize(cookies()));
await run();
