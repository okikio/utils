# Read an account page after an earlier sign-in

A browser program does not automatically have access to a person's account. A website often asks it to sign in, then
sends a cookie that the browser includes on later requests. Starting Chromium starts the browser; it does not create
that login. Starting a fresh isolated browser context for a later action also starts without the previous context's cookie.

This example performs two separate actions: sign in on one page, then read the account name on another page. A resource
session retains the same browser context between them. Each page closes when its action ends. The context keeps the
login cookie until the session closes. For a short script that does all its work in one function, an ordinary Playwright
context variable is sufficient; sessions help when separately invoked actions need to find and borrow the retained object.

The program starts its own local teaching website. Its account page returns `401` before sign-in. Clicking **Sign in as
Ada** submits a form; the website sets a cookie and redirects to the account page. The second action requests that page
again and reads `Ada` from its heading. It neither inserts nor copies a cookie. No external account or credentials are needed.

After the [root checkout setup](../../README.md#work-on-the-repository), install the matching Chromium build once:

```sh
mise exec -- pnpm exec playwright install chromium
mise exec -- node examples/sessions/browser.ts
mise exec -- node examples/sessions/check.browser.ts
```

The program prints `Ada`. The check asserts that result in actual Chromium. If the browser executable is missing, run
the install command above. This example is checked on Node; the session primitives themselves use the same TypeScript
on Deno, Node and Bun.

Keep these files together when copying the example:

```text
sessions/
├── browser.ts        retains one context across two actions and closes each page
├── website.ts        serves the sign-in form and cookie-protected account page
├── check.browser.ts  checks the result in a real browser
├── package.json      declares workspace dependencies
├── deno.jsonc        marks the private example workspace
└── README.md
```

`website.ts` uses a fixed demonstration cookie and no password. It is a repeatable teaching fixture, not a deployable
authentication service. The browser and server close when the program ends, including on failure. The example does not
save login state to disk, recover a crashed browser or route work between computers.

Read the [session guide](../../docs/workflows/18-sessions.md) for the browser/context/page model, the purpose of each
session operation, and the default limits. It also explains why later actions must go back to the same host and
what to do if that host stops.
