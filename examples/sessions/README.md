# Reuse a browser login across actions

One action signs in; a later action needs that same browser's cookies. A resource session keeps the browser context
alive between those actions. A browser context is an isolated cookie jar inside one running browser. Each action can
open a short-lived page, while the shared login remains until the session closes.

`browser.ts` runs this complete flow with Chromium. It sets a real cookie locally so you need no external website,
account or credentials. It demonstrates retained browser state and cleanup in one process; it does not demonstrate
cross-machine routing or a real site's authentication protocol.

After the root checkout setup, install the matching Chromium build once, then run the program:

```sh
mise exec -- pnpm exec playwright install chromium
mise exec -- node examples/sessions/browser.ts
```

Expected output: `Ada`. The executable check is `node examples/sessions/check.browser.ts`. This browser example is checked
on Node; the session primitives themselves use the same TypeScript on Deno, Node and Bun. Installing a browser is an
explicit prerequisite, so the example has no automatic Deno or Bun check.

```text
sessions/
├── browser.ts       resource binding, two actions, and joined cleanup
├── check.browser.ts real-browser assertion
└── README.md
```

Read the [session guide](../../docs/workflows/18-sessions.md) for the purpose of each operation, instance configuration,
bounded defaults, distributed authority, pooled-host routing and owner-loss recovery.
