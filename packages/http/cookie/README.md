# `@okikio/http/cookie`

Declare and validate a cookie once instead of repeating unsafe parsing and security attributes.

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

## Build on the example

Use safeGet() for ordinary invalid-input branches and keep independent Set-Cookie fields. The application must still
authenticate the token, rotate credentials and decide session expiry.

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
