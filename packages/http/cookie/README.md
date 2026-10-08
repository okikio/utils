# `@okikio/http/cookie`

A browser sends cookies as text. Your sign-in code needs to read the right named value, reject an invalid value and send
updated cookies without erasing other cookie writes. This package keeps the cookie's name, value rule and security
attributes together in one definition. A definition is a reusable description; it does not store a session.

```text
Browser sends Cookie -> get/safeGet -> checked token -> application checks session
Application rotates token -> set -> independent Set-Cookie field -> browser
```

The first line reads the incoming token. The second writes instructions for the browser to update it. The application
still decides whether the token identifies a valid session. `secure`, `httpOnly` and `sameSite` describe browser
behavior; they do not replace authentication or access checks.

For shared terms such as `await` and `await using`, see
[the short glossary](../../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](../API.md#cookie).

## Run a complete example

```ts runnable
import * as cookie from '@okikio/http/cookie';
import { z } from 'zod';
const Session = cookie.define({
	id: 'session',
	name: '__Host-session',
	description: 'Opaque session token.',
	value: z.string().min(1),
	attributes: { secure: true, httpOnly: true, path: '/', sameSite: 'lax' },
});
console.log(await cookie.get(new Headers({ cookie: '__Host-session=token-1' }), Session));
const output = new Headers();
cookie.set(output, Session, 'token-2');
console.log(output.getSetCookie().length);
```

Expected output:

```text output
token-1
1
```

The demo defines `__Host-session` as a nonempty string and gives it the attributes used when writing it. `get()` reads
`token-1` from the incoming header and validates its shape. `set()` appends a separate outgoing cookie for `token-2`.
The output `1` counts the outgoing `Set-Cookie` fields; it does not count active sessions or prove that either token is
trusted. A missing cookie returns `undefined`, while `get()` rejects a value that fails the declared rule.

## Build on the example

For sign-in, read the token in authentication code, look it up in your application's session store, and rotate it only
after that check succeeds. [Service middleware](../../server/middleware/README.md) can make the checked actor available
to later code. Use `safeGet()` when invalid cookie input should follow an ordinary rejection branch instead of throwing.

For a response that updates a session and a display preference, append both cookies and carry the resulting headers into
the [response](../response/README.md). Preserve separate `Set-Cookie` fields through the host or
[gateway](../../server/gateway/README.md). Your application owns expiry, logout, rotation and session storage.

## Purpose

`@okikio/http/cookie` defines application-owned HTTP cookies and provides Fetch-native helpers to read, set, delete,
compose, and document them.

A cookie definition records the stable cookie name and its security attributes. Importing the definition does not read a
request or write a response.

## How it fits

This package belongs in `@okikio/http` because cookies are HTTP protocol data. `@okikio/server` can apply these
definitions while executing a request, but the cookie contract does not depend on Hono or service composition.

Provider-owned authentication cookies remain inside the provider adapter that owns them. A generic utility should not
redefine Clerk, Better Auth, or another provider's cookie semantics.

## Operations

`cookie.define()` creates one immutable cookie contract. Catalog operations compose and select reusable sets.

`cookie.get()` reads the declared cookie from a request. `cookie.set()` and `cookie.delete()` create response header
values from the same definition.

`cookie.document()` creates a JSON-safe view for generated references and service documentation.

```typescript
const WorkspaceCookie = cookie.define({
	id: 'workspace',
	name: 'test-workspace',
	description: 'Selected workspace identifier.',
	value: z.string().min(1),
	attributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
});
```

Cookie definitions should describe application protocol behavior. They should not contain authentication logic, session
storage, or provider clients.
