# `@okikio/http/cookie`

A browser sends a saved display preference as cookie text. Your settings code needs to read the named theme, reject an
unsupported choice, and update it without erasing other cookie writes. This package keeps the cookie's name, value rule and security
attributes together in one definition. A definition is a reusable description; it does not store a session.

A **cookie** is a named value a browser retains for later HTTP requests. The server sends `Set-Cookie`; the browser
later sends `Cookie`. Those are different headers with different formats. A cookie can hold a preference or an opaque
session ID, but reading a session ID still requires your application to validate its corresponding account session.
`HttpOnly` prevents JavaScript access in the browser; it does not encrypt the value or authenticate it.

```text
Browser sends Cookie -> get/safeGet -> checked token -> application checks session
Application rotates token -> set -> independent Set-Cookie field -> browser
```

The first line reads the incoming token. The second writes instructions for the browser to update it. The application
still decides whether the token identifies a valid session. `secure`, `httpOnly` and `sameSite` describe browser
behavior; they do not replace authentication or access checks.

## Remember a display preference and reject unsupported values

Read the current theme, write the changed preference, and check an unsupported value against the allowed choices. The
application supplies the policy; the cookie definition keeps its name, value rules, and attributes together.

These examples use the current experimental source checkout, not an assumed registry release. From the `utils`
repository root, review `mise.toml`, run `mise trust`, then `mise install` and `mise run prepare -- --kind deps`.
Save the following module as `example.ts` and run `mise exec -- deno run example.ts`.
[Checkout prerequisites](../../../README.md#work-on-the-repository) explain installing Mise.

```ts runnable
import * as cookie from '@okikio/http/cookie';
import * as schema from '@okikio/schema';
const Theme = cookie.define({
	id: 'display.theme',
	name: 'theme',
	description: 'Preferred display theme.',
	value: schema.oneOf(['light', 'dark']),
	attributes: { path: '/', sameSite: 'lax' },
});
const incoming = new Request('https://service.invalid/settings', { headers: { cookie: 'theme=light' } });
console.log(await cookie.get(incoming, Theme));
const output = new Headers();
// Keep each Set-Cookie value separate; setting the theme must preserve the existing notice cookie.
output.append('Set-Cookie', 'notice=seen; Path=/');
cookie.set(output, Theme, 'dark');
const outgoing = new Response('Preference saved', { headers: output });
console.log(outgoing.headers.getSetCookie().length);
console.log((await cookie.safeGet(new Headers({ cookie: 'theme=blue' }), Theme)).success);
```

Expected output:

```text output
light
2
false
```

The definition accepts only `light` or `dark`. Reading returns the current `light` preference. Writing `dark` adds a
second outgoing cookie without erasing the existing notice cookie, which the count `2` confirms. Reading unsupported
`blue` returns an ordinary unsuccessful result from `safeGet()`. A missing cookie returns `undefined`; `get()` throws
for an invalid value. The outgoing Response carries both cookies for the browser; no session or authentication is
created by changing a display preference.

## Send the preference from a Fetch handler

This complete local handler returns the cookie-bearing Response a server would send. Calling it directly does not
update your browser; a listener must deliver the Response to an actual browser request.

```ts runnable=theme-handler.ts
import * as cookie from '@okikio/http/cookie';
import * as schema from '@okikio/schema';
const Theme = cookie.define({
	id: 'display.theme',
	name: 'theme',
	description: 'Display theme.',
	value: schema.oneOf(['light', 'dark']),
	attributes: { path: '/', sameSite: 'lax' },
});
function saveTheme(): Response {
	const headers = new Headers();
	cookie.set(headers, Theme, 'dark');
	return new Response('Theme saved', { headers });
}
const response = saveTheme();
console.log(await response.text(), response.headers.getSetCookie()[0]?.startsWith('theme=dark'));
```

```text output
Theme saved true
```

Read an invalid incoming theme with `safeGet()` before using it. A successful serialization does not establish that a
browser accepted a cookie; browser policy, HTTPS, origin and attributes govern that boundary.

## Expiration interoperability

`set()` accepts a Temporal instant or an existing Date for `expires`; `maxAge` is a non-negative whole number of
seconds. The adapter delegates HTTP cookie spelling to `@std/http/cookie` and passes Date values only at that serializer
interface. The Temporal conversion also preserves epoch zero: the pinned standard serializer treats a numeric zero as an
absent expiry, while a Date at zero emits the required `Expires` field. Cookie deletion retains that epoch Date and
`Max-Age=0` together. This is protocol serialization, with no calendar parser or elapsed timer in Cookie.

## Choose adjacent capabilities

Use Cookie for browser state representation and attributes. Use Signature or Webhook when bytes need authentication;
cookie serialization itself neither authenticates a user nor chooses session policy.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

Continue in the [numbered guide](https://github.com/okikio/utils/blob/main/docs/http/03-cookie.md) for composition,
ownership, and failure behavior.
