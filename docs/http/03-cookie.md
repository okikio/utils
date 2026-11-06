# Http: cookie

A browser remembers a named value when a server sends a `Set-Cookie` response header. On a later matching request,
the browser sends it in `Cookie`. This guide follows a display theme through that round trip. The value rule rejects
`blue`; it does not create a login session or make the browser's value trustworthy.

Reading and writing are separate: `get()` reads the incoming message, while `set()` appends to the outgoing headers.
The program constructs both messages locally so no browser or listener is needed.

## Run a complete task

Store a display preference and reject an unsupported value. This program supplies its own local input and uses public
workspace imports. After `mise run prepare -- --kind deps`, copy it to a `.ts` file in your project and run
`mise exec -- deno run example.ts`.

```ts runnable=complete-task.ts
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

Compare the output before changing the input. The remaining sections explain the options and limits; the
[package example](../../packages/http/cookie/README.md) also places this operation among adjacent capabilities.

## What is stored in the definition?

| Contract                                | Shape or return value                                             | Meaning                                                                                |
| --------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `CookieDefinition`                      | `{ kind: 'cookie', id, name, value, attributes, description }`    | Frozen name, Standard Schema value rule and browser attributes                         |
| `safeGet(incoming, Theme)`              | `Promise<{ success: true, value } \| { success: false, issues }>` | Missing cookies succeed with `value: undefined`; malformed values return schema issues |
| `get(incoming, Theme)`                  | `Promise<'light' \| 'dark' \| undefined>` for the example schema  | Same read; invalid values throw `TypeError`                                            |
| `set(headers, Theme, 'dark', options?)` | `void`                                                            | Appends an outgoing `Set-Cookie` field; mutates only the supplied `Headers`            |
| `delete(headers, Theme)`                | `void`                                                            | Appends an empty expired cookie; does not delete stored application data               |

Under the hood, reading parses the incoming Cookie header, selects the definition's name, decodes the text and invokes
the schema. Writing percent-encodes the supplied value and combines it with the declared attributes. Writing does not
run the value schema again. Keep runtime validation at the boundary where unknown tokens enter the application.

Definition construction rejects incompatible browser policies. For example, a `__Host-` cookie must be Secure, use Path
`/` and omit Domain. Keeping these attributes beside the name prevents sign-in and logout code from accidentally using
different cookie scopes. It does not make a token authentic: your session lookup still determines that. See the
[complete cookie contracts](../../packages/http/README.md) for expiry and other attributes.

## Build on the example

For sign-in, read the token in authentication code, look it up in your application's session store, and rotate it only
after that check succeeds. [Service middleware](../../packages/server/middleware/README.md) can make the checked actor
available to later code. Use `safeGet()` when invalid cookie input should follow an ordinary rejection branch instead of
throwing.

For a response that updates a session and a display preference, append both cookies and carry the resulting headers into
the [response](../../packages/http/response/README.md). Preserve separate `Set-Cookie` fields through the host or
[gateway](../../packages/server/gateway/README.md). Your application owns expiry, logout, rotation and session storage.

## Keep cookie parsing separate from session policy

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
	value: schema.string({ minLength: 1 }),
	attributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
});
```

Cookie definitions should describe application protocol behavior. They should not contain authentication logic, session
storage, or provider clients.
